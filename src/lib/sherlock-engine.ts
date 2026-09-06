/**
 * Pure TypeScript Sherlock Engine
 *
 * A faithful reimplementation of the Sherlock OSINT tool (sherlock-project/sherlock)
 * using the same site definitions (sherlock-sites.json — 414 platforms) but running
 * entirely via the Web Fetch API. No Python, no child processes, works on Vercel.
 *
 * Architecture mirrors sherlock/notify.py + sherlock/result.py:
 * - status_code: profile exists if HTTP response is NOT 404/error
 * - message:     profile exists if response body does NOT contain errorMsg
 * - response_url: profile exists if the final URL matches urlProbe (no redirect to 404)
 *
 * Concurrency: fires all sites in parallel batches of BATCH_SIZE to avoid
 * overwhelming the event loop or Vercel's network limits.
 */

import SITES_RAW from "./sherlock-sites.json";

// ─── Types from Sherlock data.json schema ────────────────────────────────────

type SiteEntry = {
  url: string;                            // Profile URL pattern — {} = username
  urlMain?: string;                       // Homepage (not used for probing)
  urlProbe?: string;                      // Optional separate probe URL
  errorType: "status_code" | "message" | "response_url";
  errorMsg?: string | string[];           // Text indicating NOT FOUND (errorType=message)
  errorUrl?: string;                      // Redirect destination when NOT FOUND (errorType=response_url)
  regexCheck?: string;                    // Username must match this regex
  isNSFW?: boolean;
  request_method?: "GET" | "POST" | "HEAD";
  request_payload?: Record<string, string>;
  headers?: Record<string, string>;
  username_claimed?: string;              // Example username for validation
};

type SitesData = {
  $schema?: string;
  [siteName: string]: SiteEntry | string | undefined;
};

export type SherlockResult = {
  platform: string;
  url: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 40;         // Concurrent requests per batch
const TIMEOUT_MS = 4000;       // Per-site timeout (4s keeps us inside the 12s aggregator budget)
const MAX_RESULTS = 30;        // Stop after this many found — covers all useful social platforms

// Social/profile-focused platforms most useful for biometric OSINT
// These get priority — we probe them first and can stop early once MAX_RESULTS hit
const PRIORITY_SITES = new Set([
  "Instagram", "X", "Twitter", "LinkedIn", "YouTube", "TikTok", "Facebook",
  "Pinterest", "Reddit", "Snapchat", "GitHub", "Flickr", "Tumblr",
  "Gravatar", "Behance", "500px", "Dribbble", "Vimeo", "Twitch",
  "Bluesky", "About.me", "DeviantArt", "Mastodon", "Keybase",
  "SoundCloud", "Spotify", "Steam", "Telegram", "VK",
]);

// Platforms that frequently false-positive or require auth — skip these
const SKIP_SITES = new Set([
  "Facebook", // Requires login to view profiles
  "Snapchat", // Requires app
]);

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Pure TypeScript Sherlock: probe 400+ platforms for a username.
 * Returns found profile URLs. Safe for Vercel serverless functions.
 */
export async function sherlockSearch(
  username: string,
  options: { maxResults?: number; skipNsfw?: boolean; timeoutMs?: number } = {}
): Promise<SherlockResult[]> {
  const {
    maxResults = MAX_RESULTS,
    skipNsfw = true,
    timeoutMs = TIMEOUT_MS,
  } = options;

  const sites = SITES_RAW as SitesData;
  const allSiteNames = Object.keys(sites).filter((k) => k !== "$schema");

  // Sort: priority sites first
  const sorted = [
    ...allSiteNames.filter((n) => PRIORITY_SITES.has(n)),
    ...allSiteNames.filter((n) => !PRIORITY_SITES.has(n)),
  ];

  const found: SherlockResult[] = [];

  // Process in batches
  for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
    if (found.length >= maxResults) break;

    const batch = sorted.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((siteName) =>
        probeSite(siteName, sites[siteName] as SiteEntry, username, { skipNsfw, timeoutMs })
      )
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value) {
        found.push(r.value);
        if (found.length >= maxResults) break;
      }
    }
  }

  return found;
}

// ─── Per-site Prober ─────────────────────────────────────────────────────────

async function probeSite(
  siteName: string,
  site: SiteEntry,
  username: string,
  opts: { skipNsfw: boolean; timeoutMs: number }
): Promise<SherlockResult | null> {
  try {
    // Skip NSFW sites if requested
    if (opts.skipNsfw && site.isNSFW) return null;

    // Skip explicitly blocked sites
    if (SKIP_SITES.has(siteName)) return null;

    // Validate username against site-specific regex
    if (site.regexCheck) {
      try {
        if (!new RegExp(site.regexCheck).test(username)) return null;
      } catch {
        // Invalid regex in data — skip the check
      }
    }

    // Build the profile URL
    const profileUrl = site.url.replace("{}", encodeURIComponent(username));
    const probeUrl = site.urlProbe
      ? site.urlProbe.replace("{}", encodeURIComponent(username))
      : profileUrl;

    const method = (site.request_method ?? "GET").toUpperCase() as "GET" | "HEAD" | "POST";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    let response: Response;
    try {
      response = await fetch(probeUrl, {
        method,
        redirect: site.errorType === "response_url" ? "manual" : "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...site.headers,
        },
        body: method === "POST" && site.request_payload
          ? JSON.stringify(site.request_payload)
          : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // ── Evaluate result based on errorType ──────────────────────────────────

    if (site.errorType === "status_code") {
      // Account EXISTS if status is 2xx (not a 404/40x/50x)
      if (response.ok) {
        return { platform: siteName, url: profileUrl };
      }
      return null;
    }

    if (site.errorType === "message") {
      // Account EXISTS if the body does NOT contain the error message(s)
      const body = await response.text().catch(() => "");
      const errorMsgs = Array.isArray(site.errorMsg)
        ? site.errorMsg
        : site.errorMsg
        ? [site.errorMsg]
        : [];
      const isNotFound = errorMsgs.some((msg) => body.includes(msg));
      if (!isNotFound && response.ok) {
        return { platform: siteName, url: profileUrl };
      }
      return null;
    }

    if (site.errorType === "response_url") {
      // Account EXISTS if response did NOT redirect to errorUrl
      // In manual redirect mode, the Location header tells us where it went
      const location = response.headers.get("location") ?? "";
      const errorUrl = site.errorUrl ?? "";
      if (errorUrl && location.includes(errorUrl)) return null;
      // If no redirect (status 2xx or 3xx without errorUrl location), assume found
      if (response.status < 400) {
        return { platform: siteName, url: profileUrl };
      }
      return null;
    }

    return null;
  } catch {
    // Timeout, network error, CORS (server-side fetch won't have CORS issues),
    // or any other error — treat as not found
    return null;
  }
}
