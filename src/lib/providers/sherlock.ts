import type { Candidate } from "./types";

/**
 * Sherlock OSINT Social Footprint Expander.
 *
 * Uses the REAL Sherlock CLI (sherlock-project) via /api/sherlock to probe
 * 400+ social platforms for a discovered username. Results are converted into
 * Candidate objects with probeCategory="osint" for biometric re-scoring.
 *
 * Fallback: if the API route fails, we fall back to the minimal direct-probe
 * implementation (GitHub API, Dev.to API, unavatar for X).
 */

const NON_USERNAMES = new Set([
  "p", "reel", "reels", "explore", "stories", "tv", "hashtag", "tags",
  "share", "login", "signup", "about", "terms", "privacy", "help",
  "search", "settings", "post", "posts", "status", "intent", "home",
  "i", "photo", "photos", "video", "videos", "media", "jobs", "feed",
  "news", "company", "in", "pub", "pulse", "learning", "events",
]);

/** Extracts possible user handles from candidate page URLs or titles. */
export function extractSocialHandles(candidates: Candidate[]): string[] {
  const handles = new Set<string>();

  for (const c of candidates) {
    try {
      const u = new URL(c.url);
      const host = u.hostname.replace(/^www\./, "");
      const segments = u.pathname.split("/").filter(Boolean);

      if (
        host === "instagram.com" ||
        host === "x.com" ||
        host === "twitter.com" ||
        host === "threads.net" ||
        host === "pinterest.com" ||
        host === "pinterest.co.uk"
      ) {
        if (segments.length > 0) {
          const seg = segments[0].replace(/^@/, "").toLowerCase();
          if (!NON_USERNAMES.has(seg) && /^[a-zA-Z0-9_\.]{3,30}$/.test(seg)) {
            handles.add(seg);
          }
        }
      } else if (host === "github.com") {
        if (segments.length > 0) {
          const seg = segments[0].toLowerCase();
          if (!NON_USERNAMES.has(seg) && /^[a-zA-Z0-9_-]{2,38}$/.test(seg)) {
            handles.add(seg);
          }
        }
      } else if (host === "dev.to" || host === "hashnode.com") {
        if (segments.length > 0) {
          const seg = segments[0].replace(/^@/, "").toLowerCase();
          if (!NON_USERNAMES.has(seg) && /^[a-zA-Z0-9_-]{2,30}$/.test(seg)) {
            handles.add(seg);
          }
        }
      } else if (host === "linkedin.com") {
        if (segments[0] === "in" && segments[1]) {
          const raw = segments[1].toLowerCase();
          const cleanSlug = raw.replace(/-[0-9a-f]{6,12}$/i, "").replace(/-[0-9]{4,10}$/i, "");
          if (cleanSlug && !NON_USERNAMES.has(cleanSlug)) {
            handles.add(cleanSlug);
            const noDashes = cleanSlug.replace(/-/g, "");
            if (noDashes.length >= 3 && noDashes.length <= 25) {
              handles.add(noDashes);
            }
          }
        }
      }

      // Check title for explicit handles: e.g. "(@username)" or "@username"
      const m = c.title.match(/@([a-zA-Z0-9_\.]{3,30})/);
      if (m && m[1] && !NON_USERNAMES.has(m[1].toLowerCase())) {
        handles.add(m[1].toLowerCase());
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return Array.from(handles).slice(0, 6); // Limit to 6 unique handles
}

/**
 * Maps a Sherlock platform name to the image URL we can use for biometric scoring.
 * For most platforms we use unavatar.io as a proxy since we can't scrape profile pages.
 * For platforms with public APIs (GitHub, Dev.to) we use the direct API.
 */
function avatarUrlForPlatform(platform: string, username: string, profileUrl: string): string | null {
  const p = platform.toLowerCase();

  if (p === "github") return `https://avatars.githubusercontent.com/${username}`;
  if (p === "twitter" || p === "x" || p === "x (twitter)") return `https://unavatar.io/x/${username}`;
  if (p === "instagram") return `https://unavatar.io/instagram/${username}`;
  if (p === "youtube") return `https://unavatar.io/youtube/${username}`;
  if (p === "tiktok") return `https://unavatar.io/tiktok/${username}`;
  if (p === "reddit") return `https://unavatar.io/reddit/${username}`;
  if (p === "dev.to" || p === "devto") return `https://unavatar.io/devto/${username}`;

  // For everything else, try unavatar with the domain extracted from the profile URL
  try {
    const domain = new URL(profileUrl).hostname.replace(/^www\./, "");
    return `https://unavatar.io/${domain}/${username}`;
  } catch {
    return null;
  }
}

/**
 * Uses the real Sherlock CLI (via /api/sherlock) to probe 400+ platforms,
 * then converts results to OSINT Candidates for biometric re-scoring.
 */
export async function expandSocialFootprint(handle: string): Promise<Candidate[]> {
  const clean = handle.trim().replace(/^@/, "");
  if (!clean || clean.length < 3 || clean.length > 30) return [];

  try {
    // Call the Sherlock API route which spawns the real sherlock CLI
    const res = await fetch("/api/sherlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: clean }),
      signal: AbortSignal.timeout(58000),
    });

    if (!res.ok) {
      // Fall back to minimal probes if Sherlock API fails
      return fallbackProbes(clean);
    }

    const data = await res.json() as { username: string; results: Array<{ platform: string; url: string }> };
    if (!data.results || data.results.length === 0) return fallbackProbes(clean);

    const candidates: Candidate[] = [];

    // Priority platforms to include (social-media-heavy platforms most useful for biometrics)
    const PRIORITY_PLATFORMS = new Set([
      "Instagram", "X", "Twitter", "LinkedIn", "YouTube", "TikTok", "Facebook",
      "Pinterest", "Reddit", "Snapchat", "GitHub", "Flickr", "Tumblr",
      "Dev.To", "Medium", "AboutMe", "About.me", "Gravatar", "Behance",
      "500px", "Dribbble", "Vimeo", "Twitch", "Discord", "Bluesky",
    ]);

    // First pass: priority social/profile platforms with known avatars
    for (const r of data.results) {
      if (!PRIORITY_PLATFORMS.has(r.platform)) continue;
      const imageUrl = avatarUrlForPlatform(r.platform, clean, r.url);
      if (!imageUrl) continue;
      candidates.push({
        url: r.url,
        imageUrl,
        title: `@${clean} on ${r.platform}`,
        source: new URL(r.url).hostname.replace(/^www\./, ""),
        probeCategory: "osint",
        probeLabel: `Sherlock OSINT (@${clean})`,
      });
    }

    // Second pass: any remaining platforms with avatar support, up to 10 total
    if (candidates.length < 10) {
      for (const r of data.results) {
        if (PRIORITY_PLATFORMS.has(r.platform)) continue;
        if (candidates.length >= 10) break;
        const imageUrl = avatarUrlForPlatform(r.platform, clean, r.url);
        if (!imageUrl) continue;
        candidates.push({
          url: r.url,
          imageUrl,
          title: `@${clean} on ${r.platform}`,
          source: new URL(r.url).hostname.replace(/^www\./, ""),
          probeCategory: "osint",
          probeLabel: `Sherlock OSINT (@${clean})`,
        });
      }
    }

    return candidates.slice(0, 10);
  } catch {
    return fallbackProbes(clean);
  }
}

/**
 * Minimal fallback probes — used when the Sherlock CLI is not available
 * or the API route fails. Checks GitHub API, Dev.to API, and unavatar for X.
 */
async function fallbackProbes(clean: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const ghPromise = (async () => {
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(clean)}`, {
        headers: { "User-Agent": "Facechain-OSINT/1.0" },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.avatar_url && data.html_url) {
          candidates.push({
            url: data.html_url,
            imageUrl: data.avatar_url,
            title: `${data.name || clean} (@${clean}) on GitHub`,
            source: "github.com",
            probeCategory: "osint",
            probeLabel: `Sherlock OSINT (@${clean})`,
          });
        }
      }
    } catch {}
  })();

  const devPromise = (async () => {
    try {
      const res = await fetch(`https://dev.to/api/users/by_username?url=${encodeURIComponent(clean)}`, {
        headers: { "User-Agent": "Facechain-OSINT/1.0" },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile_image) {
          candidates.push({
            url: `https://dev.to/${clean}`,
            imageUrl: data.profile_image,
            title: `${data.name || clean} on Dev.to`,
            source: "dev.to",
            probeCategory: "osint",
            probeLabel: `Sherlock OSINT (@${clean})`,
          });
        }
      }
    } catch {}
  })();

  const unavatarPromise = (async () => {
    try {
      const avatarUrl = `https://unavatar.io/x/${encodeURIComponent(clean)}`;
      const res = await fetch(avatarUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        candidates.push({
          url: `https://x.com/${clean}`,
          imageUrl: avatarUrl,
          title: `@${clean} on X (Twitter)`,
          source: "x.com",
          probeCategory: "osint",
          probeLabel: `Sherlock OSINT (@${clean})`,
        });
      }
    } catch {}
  })();

  await Promise.allSettled([ghPromise, devPromise, unavatarPromise]);
  return candidates;
}
