import type { Candidate, ProbeBox, SearchOutcome, SearchProvider } from "./types";
import { SerpApiLens } from "./serpapi";
import { isSocial } from "./types";
import sharp from "sharp";

/**
 * MultiEngineAggregator: High-Speed Multi-Probe Visual Search Pipeline.
 *
 * Implements coarse-to-fine multi-probe retrieval:
 * 1. Targeted Biometric Face Crops: For each detected person (or explicitly selected person),
 *    queries Google Lens with clean, padded portrait crops for high-precision facial/profile discovery.
 * 2. Global Scene Context Path: Queries Google Lens with the full specimen to find group context,
 *    composite sources, articles, and situational matches.
 */
export class MultiEngineAggregator implements SearchProvider {
  readonly id = "aggregator:lens_yandex";
  readonly label = "Multi-Engine (Lens + Multi-Face)";

  private lens = new SerpApiLens();

  configured(): boolean {
    return this.lens.configured();
  }

  async search(
    image: Uint8Array,
    mime: string,
    probes?: ProbeBox[],
  ): Promise<SearchOutcome> {
    // 1. Prepare SOTA Neural Face Crops for each detected person (up to 4 people)
    const faceCrops: Array<{ id: string; label: string; isPrimary?: boolean; image: Uint8Array }> = [];
    const activeProbes = (probes && probes.length > 0) ? probes.slice(0, 4) : [];

    if (activeProbes.length > 0) {
      try {
        const meta = await sharp(image).metadata();
        const imgW = meta.width ?? 0;
        const imgH = meta.height ?? 0;

        if (imgW > 0 && imgH > 0) {
          for (const p of activeProbes) {
            let fx = 0, fy = 0, fw = 0, fh = 0;

            if (p.boxRaw && p.boxRaw.length === 4) {
              // Normalized 0..1 coordinates from neural detector: [x, y, w, h]
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

            // Natural portrait padding around face box: generous headroom for hair and neck
            const padX = Math.round(fw * 0.25);
            const padTop = Math.round(fh * 0.35);
            const padBottom = Math.round(fh * 0.25);
            const left = Math.max(0, Math.round(fx - padX));
            const top = Math.max(0, Math.round(fy - padTop));
            const right = Math.min(imgW, Math.round(fx + fw + padX));
            const bottom = Math.min(imgH, Math.round(fy + fh + padBottom));
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
                isPrimary: Boolean(p.isPrimary),
                image: new Uint8Array(buf),
              });
            }
          }
        }
      } catch (err) {
        console.warn("[aggregator] Face cropping error:", err);
      }
    }

    // 2. Dispatch queries: Person Face Crops + Global Scene Context in parallel
    const queries: Array<Promise<{ source: "lens"; category: string; label: string; isScene: boolean; outcome: SearchOutcome }>> = [];

    // Global Scene queries: full contextual scene + all persons
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

    // Individual Face queries for detected persons
    for (const fc of faceCrops) {
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
      } else {
        console.warn("[aggregator] Search query rejected:", res.reason);
      }
    }

    if (!anySuccess && queries.length > 0) {
      throw new Error("All visual search engine requests failed or timed out.");
    }

    // Sort buckets with social media profiles (Instagram, LinkedIn, X, GitHub) first
    sceneCandidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));
    for (const list of faceCandidatesMap.values()) {
      list.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));
    }

    // 3. Balanced Assembly:
    const finalCandidates: Candidate[] = [];
    const addedUrls = new Set<string>();

    const pushUnique = (c: Candidate) => {
      if (!addedUrls.has(c.url) && finalCandidates.length < 28) {
        addedUrls.add(c.url);
        finalCandidates.push(c);
      }
    };

    // 3. Assembly: Scene Context as PRIMARY priority, Person-wise as SECONDARY
    const primaryCrop = faceCrops.find((fc) => fc.isPrimary) || (faceCrops.length === 1 ? faceCrops[0] : null);

    if (primaryCrop && faceCandidatesMap.has(primaryCrop.id)) {
      // Single-Person / Focused Mode:
      // Priority 1: Scene Context (top 16 leads)
      // Priority 2 (Secondary): Targeted Person Face Crop (top 12 leads)
      const primaryList = faceCandidatesMap.get(primaryCrop.id)!;
      sceneCandidates.slice(0, 16).forEach(pushUnique);
      primaryList.slice(0, 12).forEach(pushUnique);

      // Fill remaining slots
      sceneCandidates.forEach(pushUnique);
      primaryList.forEach(pushUnique);
    } else {
      // Dual-Path / Multi-Face Mode:
      // Priority 1: Scene Context (top 16 leads)
      // Priority 2 (Secondary): Each detected person (fair quota across persons)
      sceneCandidates.slice(0, 16).forEach(pushUnique);
      for (const list of faceCandidatesMap.values()) {
        list.slice(0, 5).forEach(pushUnique);
      }

      // Fill remaining slots
      sceneCandidates.forEach(pushUnique);
      for (const list of faceCandidatesMap.values()) {
        list.forEach(pushUnique);
      }
    }

    return {
      provider: this.id,
      candidates: finalCandidates.slice(0, 28),
      queryRef: `dual-path:${Date.now()}`,
    };
  }
}
