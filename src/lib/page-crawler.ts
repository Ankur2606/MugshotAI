/**
 * Cyber Intelligence Page & Bio-Hub Crawler
 *
 * Discovers connected outbound identities published on a face-verified page,
 * and follows 1-hop into bio hubs (Linktree, Beacons, Carrd, Bento, Bio.link).
 *
 * Operates strictly off-chain for investigative telemetry and UI aesthetics.
 * Never alters the canonical evidence bundle or on-chain digest.
 */

export type DiscoveredProfile = {
  platform: "devfolio" | "github" | "linkedin" | "x" | "instagram" | "youtube" | "reddit" | "other";
  platformName: string;
  url: string;
  handle: string;
  source: "page" | "bio-hub";
  hubUrl?: string;
};

export type IntelReport = {
  targetUrl: string;
  hubFound: string | null;
  profiles: DiscoveredProfile[];
  scannedAt: string;
  elapsedMs: number;
};

const BIO_HUB_DOMAINS = [
  "linktr.ee",
  "beacons.ai",
  "carrd.co",
  "bio.link",
  "bento.me",
  "lnk.bio",
  "solo.to",
];

const NOISE_PATH_PATTERNS = [
  /\/intent\//i,
  /\/share/i,
  /\/sharer/i,
  /\/login/i,
  /\/signup/i,
  /\/oauth/i,
  /\/hashtag\//i,
  /\/watch/i,
  /\/embed\//i,
  /\/dialog\//i,
  /\/plugins\//i,
  /\/help/i,
  /\/privacy/i,
  /\/terms/i,
  /\/policies/i,
  /\.css$/i,
  /\.js$/i,
  /\.png$/i,
  /\.jpe?g$/i,
  /\.svg$/i,
];

const RESERVED_USERNAMES = new Set([
  "home", "explore", "about", "contact", "pricing", "support", "help", "legal",
  "privacy", "terms", "blog", "jobs", "careers", "login", "signup", "register",
  "admin", "developer", "api", "docs", "settings", "search", "notifications",
  "in", "posts", "feed", "news", "status", "share", "intent", "p", "reel",
]);

/** Matches raw URLs and href attributes in HTML */
const HREF_REGEX = /href=["'](https?:\/\/[^"'\s>]+)["']/gi;
const RAW_URL_REGEX = /https?:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s"'>]*)?/gi;

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.search = ""; // drop tracking query params like ?utm_source
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

function isNoise(url: string): boolean {
  return NOISE_PATH_PATTERNS.some((p) => p.test(url));
}

export function classifySocialUrl(urlStr: string): {
  platform: DiscoveredProfile["platform"];
  platformName: string;
  handle: string;
} | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);

    if (isNoise(urlStr)) return null;

    // Devfolio: devfolio.co/@username or devfolio.co/projects/...
    if (host === "devfolio.co" || host.endsWith(".devfolio.co")) {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase())) {
        return { platform: "devfolio", platformName: "Devfolio", handle: `@${handle}` };
      }
    }

    // GitHub: github.com/username
    if (host === "github.com") {
      const handle = parts[0] || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_-]{1,39}$/.test(handle)) {
        return { platform: "github", platformName: "GitHub", handle: `@${handle}` };
      }
    }

    // LinkedIn: linkedin.com/in/username
    if (host === "linkedin.com") {
      if (parts[0] === "in" && parts[1]) {
        const handle = parts[1];
        if (!RESERVED_USERNAMES.has(handle.toLowerCase())) {
          return { platform: "linkedin", platformName: "LinkedIn", handle: `in/${handle}` };
        }
      }
    }

    // X / Twitter: x.com/username or twitter.com/username
    if (host === "x.com" || host === "twitter.com") {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
        return { platform: "x", platformName: "X (Twitter)", handle: `@${handle}` };
      }
    }

    // Instagram: instagram.com/username
    if (host === "instagram.com") {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_.]+$/.test(handle)) {
        return { platform: "instagram", platformName: "Instagram", handle: `@${handle}` };
      }
    }

    // YouTube: youtube.com/@handle or youtube.com/channel/...
    if (host === "youtube.com" || host === "youtu.be") {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase())) {
        return { platform: "youtube", platformName: "YouTube", handle: `@${handle}` };
      }
    }

    // Reddit: reddit.com/user/handle
    if (host === "reddit.com") {
      if ((parts[0] === "user" || parts[0] === "u") && parts[1]) {
        return { platform: "reddit", platformName: "Reddit", handle: `u/${parts[1]}` };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function extractBioHubUrl(html: string): string | null {
  const found: string[] = [];

  for (const match of html.matchAll(HREF_REGEX)) {
    if (match[1]) found.push(match[1]);
  }
  for (const match of html.matchAll(RAW_URL_REGEX)) {
    found.push(match[0]);
  }

  for (const raw of found) {
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (BIO_HUB_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
        // Ensure it's a specific user hub, not just the homepage
        const path = u.pathname.replace(/\/+$/, "");
        if (path.length > 1 && !RESERVED_USERNAMES.has(path.replace(/^\//, "").toLowerCase())) {
          return normalizeUrl(raw);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parseLinksFromHtml(
  html: string,
  source: "page" | "bio-hub",
  hubUrl?: string
): DiscoveredProfile[] {
  const seenUrls = new Set<string>();
  const profiles: DiscoveredProfile[] = [];

  const candidates: string[] = [];
  for (const m of html.matchAll(HREF_REGEX)) {
    if (m[1]) candidates.push(m[1]);
  }
  for (const m of html.matchAll(RAW_URL_REGEX)) {
    candidates.push(m[0]);
  }

  for (const raw of candidates) {
    const norm = normalizeUrl(raw);
    if (seenUrls.has(norm)) continue;

    const classified = classifySocialUrl(norm);
    if (classified) {
      seenUrls.add(norm);
      profiles.push({
        platform: classified.platform,
        platformName: classified.platformName,
        url: norm,
        handle: classified.handle,
        source,
        hubUrl,
      });
    }
  }

  return profiles;
}

/** Fetch page HTML with timeout and desktop user-agent */
async function fetchHtml(targetUrl: string, timeoutMs = 6000): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(id);
  }
}

/**
 * Executes a full cyber intelligence sweep for a target URL:
 * 1. Crawls target page HTML for direct social links (Devfolio, GitHub, etc.)
 * 2. Detects bio hubs (Linktree, Beacons, Carrd)
 * 3. Crawls bio hub 1-hop and pulls underlying linked identities
 */
export async function crawlConnectedIdentities(targetUrl: string): Promise<IntelReport> {
  const start = Date.now();
  const directHtml = await fetchHtml(targetUrl, 6000);

  const seenUrls = new Set<string>();
  const profiles: DiscoveredProfile[] = [];

  // 1. Direct page profiles
  if (directHtml) {
    const directProfiles = parseLinksFromHtml(directHtml, "page");
    for (const p of directProfiles) {
      if (!seenUrls.has(p.url)) {
        seenUrls.add(p.url);
        profiles.push(p);
      }
    }
  }

  // 2. Check if the target page itself IS a bio hub
  let hubUrl: string | null = null;
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (BIO_HUB_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
      hubUrl = normalizeUrl(targetUrl);
    }
  } catch {}

  // 3. Or if direct HTML contains a link to a bio hub
  if (!hubUrl && directHtml) {
    hubUrl = extractBioHubUrl(directHtml);
  }

  // 4. Follow 1-hop into bio hub if discovered and not already crawled
  if (hubUrl && hubUrl !== normalizeUrl(targetUrl)) {
    const hubHtml = await fetchHtml(hubUrl, 6000);
    if (hubHtml) {
      const hubProfiles = parseLinksFromHtml(hubHtml, "bio-hub", hubUrl);
      for (const p of hubProfiles) {
        if (!seenUrls.has(p.url)) {
          seenUrls.add(p.url);
          profiles.push(p);
        }
      }
    }
  }

  return {
    targetUrl,
    hubFound: hubUrl,
    profiles,
    scannedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}
