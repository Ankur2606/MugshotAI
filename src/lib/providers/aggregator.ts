import type { Candidate, ProbeBox, SearchOutcome, SearchProvider } from "./types";
import { SerpApiLens } from "./serpapi";
import { SerpApiYandex } from "./yandex";
import { isSocial } from "./types";
import { extractSocialHandles } from "./sherlock";
import { runSherlock } from "../sherlock-runner";
import sharp from "sharp";

/**
 * MultiEngineAggregator: SOTA Multi-Engine Visual & OSINT Search Pipeline.
 *
 * Implements research-backed coarse-to-fine multi-probe retrieval:
 * 1. Global Scene Context Path: Queries Google Lens and Yandex with the full specimen / user crop.
 * 2. SOTA Face Crops Path: For each person detected by the neural face detector (Person 1, Person 2, Person 3),
 *    extracts their clean facial crop (with 15% natural padding, strictly avoiding clothing/torso confusion)
 *    and queries visual engines with low priority compared to scene context.
 * 3. Sherlock OSINT Expansion Path: Discovered social handles are probed across public platforms
 *    (GitHub, Dev.to, X) to pull public profile avatars for biometric verification.
 */
export class MultiEngineAggregator implements SearchProvider {
  readonly id = "aggregator:lens_yandex";
  readonly label = "SOTA Multi-Engine (Lens + Yandex + Multi-Face + OSINT)";

  private lens = new SerpApiLens();
  private yandex = new SerpApiYandex();

  configured(): boolean {
    return this.lens.configured() || this.yandex.configured();
  }

  async search(
    image: Uint8Array,
    mime: string,
    probes?: ProbeBox[],
  ): Promise<SearchOutcome> {
    // 1. Prepare SOTA Neural Face Crops for each detected person
    const faceCrops: Array<{ id: string; label: string; image: Uint8Array }> = [];
    if (probes && probes.length > 0) {
      try {
        const meta = await sharp(image).metadata();
        const imgW = meta.width ?? 0;
        const imgH = meta.height ?? 0;

        if (imgW > 0 && imgH > 0) {
          for (const p of probes) {
            let fx = 0, fy = 0, fw = 0, fh = 0;

            if (p.boxRaw && p.boxRaw.length === 4) {
              // Normalized 0..1 coordinates from neural detector
              fx = p.boxRaw[0] * imgW;
              fy = p.boxRaw[1] * imgH;
              fw = p.boxRaw[2] * imgW;
              fh = p.boxRaw[3] * imgH;
            } else if (p.box && p.box.length === 4) {
              const [bx, by, bw, bh] = p.box;
              if (bx <= 1.05 && by <= 1.05 && bw <= 1.05 && bh <= 1.05) {
                fx = bx * imgW;
                fy = by * imgH;
                fw = bw * imgW;
                fh = bh * imgH;
              } else {
                const scaleX = (bx + bw > imgW) ? imgW / Math.max(bx + bw, 1) : 1;
                const scaleY = (by + bh > imgH) ? imgH / Math.max(by + bh, 1) : 1;
                const scale = Math.min(scaleX, scaleY, 1);
                fx = bx * scale;
                fy = by * scale;
                fw = bw * scale;
                fh = bh * scale;
              }
            } else {
              continue;
            }

            // Natural 15% padding around the exact face box detected by the SOTA model.
            // Strictly bounds the head and chin without extending down into shirts/clothes.
            const padX = Math.round(fw * 0.15);
            const padY = Math.round(fh * 0.15);
            const left = Math.max(0, Math.round(fx - padX));
            const top = Math.max(0, Math.round(fy - padY));
            const right = Math.min(imgW, Math.round(fx + fw + padX));
            const bottom = Math.min(imgH, Math.round(fy + fh + padY));
            const width = right - left;
            const height = bottom - top;

            if (width >= 40 && height >= 40) {
              const buf = await sharp(image)
                .extract({ left, top, width, height })
                .jpeg({ quality: 90 })
                .toBuffer();
              faceCrops.push({
                id: p.id,
                label: p.label,
                image: new Uint8Array(buf),
              });
            }
          }
        }
      } catch {
        // if cropping fails, proceed with whole image
      }
    }

    // 2. Dispatch queries: Global Scene Context + Each Detected Person's Face Crop
    const queries: Array<Promise<{ source: "lens" | "yandex"; category: string; label: string; isScene: boolean; outcome: SearchOutcome }>> = [];

    // Global Scene queries (Priority 1: full contextual scene + all persons)
    if (this.lens.configured()) {
      queries.push(
        this.lens.search(image, mime).then((outcome) => ({
          source: "lens",
          category: "scene",
          label: "Scene Context",
          isScene: true,
          outcome,
        })),
      );
    }
    if (this.yandex.configured()) {
      queries.push(
        this.yandex.search(image, mime).then((outcome) => ({
          source: "yandex",
          category: "scene",
          label: "Scene Context",
          isScene: true,
          outcome,
        })),
      );
    }

    // Individual Face queries for each detected person (Priority 2: targeted biometric search)
    for (const fc of faceCrops) {
      if (this.yandex.configured()) {
        queries.push(
          this.yandex.search(fc.image, "image/jpeg").then((outcome) => ({
            source: "yandex",
            category: fc.id,
            label: fc.label,
            isScene: false,
            outcome,
          })),
        );
      }
      if (this.lens.configured()) {
        queries.push(
          this.lens.search(fc.image, "image/jpeg").then((outcome) => ({
            source: "lens",
            category: fc.id,
            label: fc.label,
            isScene: false,
            outcome,
          })),
        );
      }
    }

    const settled = await Promise.allSettled(queries);
    let anySuccess = false;

    // Filter out obvious e-commerce / clothing shopping products unless on social platforms
    const isECommerceProduct = (c: Candidate): boolean => {
      if (isSocial(c.url)) return false;
      const text = `${c.title} ${c.url}`.toLowerCase();
      return (
        /\b(shirt|dress|jacket|hoodie|clothing|pants|t-shirt|trousers|sweater|blazer|coat|apparel|weekday|zara|h&m|asos|shein)\b/.test(
          text,
        ) ||
        /\/products\//.test(text) ||
        /\/product\//.test(text) ||
        /\/shop\//.test(text)
      );
    };

    const sceneCandidates: Candidate[] = [];
    const faceCandidatesMap = new Map<string, Candidate[]>();
    const seenUrls = new Set<string>();

    for (const res of settled) {
      if (res.status === "fulfilled") {
        anySuccess = true;
        const { outcome, category, label, isScene } = res.value;

        for (const c of outcome.candidates) {
          if (!c.url || !c.imageUrl) continue;
          if (seenUrls.has(c.url)) continue;
          if (isECommerceProduct(c)) continue; // Filter out shopping clothing items

          seenUrls.add(c.url);
          const candidate: Candidate = {
            ...c,
            probeCategory: category,
            probeLabel: label,
          };

          if (isScene) {
            sceneCandidates.push(candidate);
          } else {
            if (!faceCandidatesMap.has(category)) {
              faceCandidatesMap.set(category, []);
            }
            faceCandidatesMap.get(category)!.push(candidate);
          }
        }
      }
    }

    if (!anySuccess && queries.length > 0) {
      throw new Error("All visual search engine requests failed or timed out.");
    }

    // 3. Path C: Sherlock OSINT Social Footprint Expansion (400+ platforms, TS engine)
    // Hard-capped at SHERLOCK_BUDGET_MS so it NEVER delays the main response beyond budget.
    // Visual search results are always returned even if Sherlock times out.
    const SHERLOCK_BUDGET_MS = 12_000; // 12s max — leaves room in Vercel's 60s limit
    const osintCandidates: Candidate[] = [];
    const allVisualCandidates: Candidate[] = [...sceneCandidates];
    for (const list of faceCandidatesMap.values()) {
      allVisualCandidates.push(...list);
    }
    const handles = extractSocialHandles(allVisualCandidates);

    if (handles.length > 0) {
      // Priority social platforms for biometric avatar scoring
      const PRIORITY_PLATFORMS = new Set([
        "Instagram", "X", "Twitter", "LinkedIn", "YouTube", "TikTok", "Facebook",
        "Pinterest", "Reddit", "Snapchat", "GitHub", "Flickr", "Tumblr",
        "Dev.To", "Medium", "Gravatar", "Behance", "500px", "Dribbble",
        "Vimeo", "Twitch", "Bluesky", "About.me",
      ]);

      // Race Sherlock against a hard timeout — whichever finishes first wins.
      // This means total search time = max(visual_search, sherlock) capped at budget.
      const sherlockWithTimeout = Promise.allSettled(
        handles.map((h) => runSherlock(h).then((results) => ({ handle: h, results }))),
      );
      const timeoutGuard = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SHERLOCK_BUDGET_MS)
      );

      const winner = await Promise.race([sherlockWithTimeout, timeoutGuard]);

      if (winner !== null) {
        // Sherlock finished within budget — process its results
        for (const res of winner) {
          if (res.status !== "fulfilled") continue;
          const { handle, results } = res.value;
          const sorted = [
            ...results.filter((r) => PRIORITY_PLATFORMS.has(r.platform)),
            ...results.filter((r) => !PRIORITY_PLATFORMS.has(r.platform)),
          ];
          let added = 0;
          for (const r of sorted) {
            if (added >= 8) break;
            const imageUrl = sherlockAvatarUrl(r.platform, handle, r.url);
            if (!imageUrl) continue;
            if (seenUrls.has(r.url)) continue;
            seenUrls.add(r.url);
            let source = "";
            try { source = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
            osintCandidates.push({
              url: r.url,
              imageUrl,
              title: `@${handle} on ${r.platform}`,
              source,
              probeCategory: "osint",
              probeLabel: `Sherlock OSINT (@${handle})`,
            });
            added++;
          }
        }
      }
      // If winner === null: Sherlock timed out — we return visual results only, no OSINT
    }

    // Sort buckets with social media profiles (Instagram, LinkedIn, X, GitHub) first
    sceneCandidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));
    for (const list of faceCandidatesMap.values()) {
      list.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));
    }
    osintCandidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));

    // 4. Balanced Assembly in User-Specified Priority Order:
    // Priority 1: Scene Context (top 10-12 leads)
    // Priority 2: Each Person's Face Crop (top 3-4 leads per detected face: Person 1, Person 2, Person 3)
    // Priority 3: Sherlock OSINT (top 3-4 leads)
    const finalCandidates: Candidate[] = [];
    const addedUrls = new Set<string>();

    const pushUnique = (c: Candidate) => {
      if (!addedUrls.has(c.url) && finalCandidates.length < 28) {
        addedUrls.add(c.url);
        finalCandidates.push(c);
      }
    };

    // 1. Scene Context FIRST
    sceneCandidates.slice(0, 12).forEach(pushUnique);

    // 2. Each Person's Face Crop SECOND (fair quota for each person detected)
    for (const list of faceCandidatesMap.values()) {
      list.slice(0, 4).forEach(pushUnique);
    }

    // 3. Sherlock OSINT THIRD
    osintCandidates.slice(0, 4).forEach(pushUnique);

    // Fill remaining slots if any category was short
    sceneCandidates.forEach(pushUnique);
    for (const list of faceCandidatesMap.values()) {
      list.forEach(pushUnique);
    }
    osintCandidates.forEach(pushUnique);

    return {
      provider: this.id,
      candidates: finalCandidates.slice(0, 28),
      queryRef: `dual-path:${Date.now()}`,
    };
  }
}

/**
 * Maps a Sherlock platform name + username to a direct avatar image URL
 * suitable for biometric face encoding.
 */
function sherlockAvatarUrl(platform: string, username: string, profileUrl: string): string | null {
  const p = platform.toLowerCase().replace(/[\s.]/g, "");

  if (p === "github") return `https://avatars.githubusercontent.com/${username}`;
  if (p === "x" || p === "twitter") return `https://unavatar.io/x/${username}`;
  if (p === "instagram") return `https://unavatar.io/instagram/${username}`;
  if (p === "youtube") return `https://unavatar.io/youtube/${username}`;
  if (p === "tiktok") return `https://unavatar.io/tiktok/${username}`;
  if (p === "reddit") return `https://unavatar.io/reddit/${username}`;
  if (p === "devto" || p === "devto") return `https://unavatar.io/devto/${username}`;
  if (p === "gravatar") return `https://unavatar.io/gravatar/${username}`;
  if (p === "bluesky") return `https://unavatar.io/bluesky/${username}`;

  // For remaining platforms: use unavatar with the domain if it's a supported one
  try {
    const domain = new URL(profileUrl).hostname.replace(/^www\./, "");
    // unavatar supports many domains natively
    return `https://unavatar.io/${domain}/${username}`;
  } catch {
    return null;
  }
}
