/**
 * Cyber Intelligence Page & Bio-Hub Crawler
 *
 * Discovers connected outbound identities published on face-verified pages,
 * resolves post authors and profile subjects, extracts commenters and tagged profiles,
 * cleans video sources (YouTube), and follows 1-hop into bio hubs (Linktree, Beacons, Carrd).
 *
 * Operates strictly off-chain for investigative telemetry and UI aesthetics.
 * Never alters the canonical evidence bundle or on-chain digest.
 */

export type DiscoveredProfile = {
  platform: "devfolio" | "github" | "linkedin" | "x" | "instagram" | "youtube" | "reddit" | "other";
  platformName: string;
  url: string;
  handle: string;
  source: "author" | "subject" | "commenter" | "page" | "bio-hub";
  roleLabel: string;
  hubUrl?: string;
  category?: string;
  categoryLabel?: string;
};

export type TargetSpecimen = {
  url: string;
  category?: string;
  label?: string;
  title?: string;
  similarityBp?: number;
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
  /\.ico$/i,
  /\.wasm$/i,
  /\/favicon/i,
  /\/generate_204/i,
  /\/error_204/i,
  /\/csi_204/i,
  /\/ptracking/i,
  /\/howyoutubeworks/i,
  /\/opensearch/i,
  /\/oembed/i,
  /\/creators/i,
  /\/ads(?:\/|$)/i,
  /\/s\/desktop\//i,
  /\/_\/ytmainappweb/i,
];

const RESERVED_USERNAMES = new Set([
  "home", "explore", "about", "contact", "pricing", "support", "help", "legal",
  "privacy", "terms", "blog", "jobs", "careers", "login", "signup", "register",
  "admin", "developer", "api", "docs", "settings", "search", "notifications",
  "in", "posts", "feed", "news", "status", "share", "intent", "p", "reel",
  "company", "school", "learning", "pub", "pulse", "tos"
  // YouTube specific junk words
  "s", "desktop", "canvas", "webgl", "webgl2", "lite", "advanced", "wasm",
  "opensearch", "oembed", "ads", "creators", "howyoutubeworks", "error_204",
  "csi_204", "ptracking", "generate_204", "t", "trends", "feed", "results",
  "playlist", "embed", "shared", "live", "premium", "music", "kids", "intl",
  // GitHub global navigation paths, not user profiles.
  "features", "security", "why-github", "marketplace", "enterprise", "team",
  "solutions", "resources", "customer-stories", "orgs", "trust-center",
  "topics", "trending", "collections", "open-source", "partners",
  "mcp", "copilot",
  // Devfolio navigation paths, not profile handles.
  "projects", "hackathons", "community", "about", "guide",
]);

/**
 * Normalizes all LinkedIn URLs to canonical format: https://www.linkedin.com/in/{slug}
 * Strips regional subdomains (uk., in., ca., de., fr., etc.) and tracking query params
 */
export function normalizeCanonicalUrl(raw: string): string {
  try {
    const trimmed = raw.trim();
    const linkedinMatch = trimmed.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
    if (linkedinMatch && linkedinMatch[1]) {
      return `https://www.linkedin.com/in/${linkedinMatch[1]}`;
    }

    const u = new URL(trimmed);
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

/**
 * Synchronously extracts author or primary subject profile from URL (LinkedIn, X, GitHub)
 */
export function extractAuthorFromUrl(targetUrl: string): DiscoveredProfile | null {
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    // 1. LinkedIn post author or direct profile
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      const postMatch = u.pathname.match(/\/posts\/([a-zA-Z0-9\-_%]+?)(?:_[^/]*|-activity-\d+)?(?:\/|$)/i);
      if (postMatch && postMatch[1]) {
        const slug = postMatch[1];
        if (!RESERVED_USERNAMES.has(slug.toLowerCase())) {
          return {
            platform: "linkedin",
            platformName: "LinkedIn",
            url: `https://www.linkedin.com/in/${slug}`,
            handle: `in/${slug}`,
            source: "author",
            roleLabel: "Post Author / Publisher",
          };
        }
      }
      const profMatch = u.pathname.match(/\/in\/([a-zA-Z0-9\-_%]+)/i);
      if (profMatch && profMatch[1]) {
        const slug = profMatch[1];
        if (!RESERVED_USERNAMES.has(slug.toLowerCase())) {
          return {
            platform: "linkedin",
            platformName: "LinkedIn",
            url: `https://www.linkedin.com/in/${slug}`,
            handle: `in/${slug}`,
            source: "subject",
            roleLabel: "Target Profile Subject",
          };
        }
      }
    }

    // 2. X / Twitter author or profile
    if (host === "x.com" || host === "twitter.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        const handle = parts[0];
        if (!RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
          const isPost = parts.includes("status");
          return {
            platform: "x",
            platformName: "X (Twitter)",
            url: `https://x.com/${handle}`,
            handle: `@${handle}`,
            source: isPost ? "author" : "subject",
            roleLabel: isPost ? "Post Author" : "Target Profile Subject",
          };
        }
      }
    }

    // 3. GitHub owner or profile
    if (host === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0 && !RESERVED_USERNAMES.has(parts[0].toLowerCase())) {
        return {
          platform: "github",
          platformName: "GitHub",
          url: `https://github.com/${parts[0]}`,
          handle: `@${parts[0]}`,
          source: parts.length > 1 ? "author" : "subject",
          roleLabel: parts.length > 1 ? "Repository Owner" : "Target Profile Subject",
        };
      }
    }
  } catch { }
  return null;
}

/**
 * Extracts target identity directly from the permalink URL:
 * - LinkedIn Post -> Post Author (/posts/{slug} -> in/{slug})
 * - LinkedIn Profile -> Target Profile Subject (/in/{slug} -> in/{slug})
 * - X / Twitter Post or Profile -> Post Author / Profile Subject
 * - GitHub -> Owner
 * - YouTube Video -> Video Source + Channel
 */
export async function extractPrimarySubjectFromUrl(targetUrl: string): Promise<DiscoveredProfile[]> {
  const discovered: DiscoveredProfile[] = [];

  try {
    const u = new URL(targetUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    // 1. LinkedIn
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      // Case A: Post -> extract post author
      const postMatch = u.pathname.match(/\/posts\/([a-zA-Z0-9\-_%]+?)(?:_[^/]*|-activity-\d+)?(?:\/|$)/i);
      if (postMatch && postMatch[1]) {
        const slug = postMatch[1];
        if (!RESERVED_USERNAMES.has(slug.toLowerCase())) {
          discovered.push({
            platform: "linkedin",
            platformName: "LinkedIn",
            url: `https://www.linkedin.com/in/${slug}`,
            handle: `in/${slug}`,
            source: "author",
            roleLabel: "Post Author / Publisher",
          });
          return discovered;
        }
      }

      // Case B: Profile directly -> target subject profile
      const profMatch = u.pathname.match(/\/in\/([a-zA-Z0-9\-_%]+)/i);
      if (profMatch && profMatch[1]) {
        const slug = profMatch[1];
        if (!RESERVED_USERNAMES.has(slug.toLowerCase())) {
          discovered.push({
            platform: "linkedin",
            platformName: "LinkedIn",
            url: `https://www.linkedin.com/in/${slug}`,
            handle: `in/${slug}`,
            source: "subject",
            roleLabel: "Target Profile Subject",
          });
          return discovered;
        }
      }
    }

    // 2. YouTube Video: query oEmbed API to get official video title and creator channel
    if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
      const vParam = u.searchParams.get("v");
      const isWatch = u.pathname.startsWith("/watch") && vParam;
      const isShort = host === "youtu.be" && u.pathname.length > 1;

      if (isWatch || isShort) {
        const vidId = vParam || u.pathname.replace(/^\//, "");
        const cleanVidUrl = `https://www.youtube.com/watch?v=${vidId}`;

        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanVidUrl)}&format=json`,
            { signal: AbortSignal.timeout(4000) }
          );
          if (oembedRes.ok) {
            const data = await oembedRes.json();
            const channelHandle = data.author_url ? data.author_url.split("/").pop() : `@${data.author_name}`;

            // Video item
            discovered.push({
              platform: "youtube",
              platformName: "YouTube Video",
              url: cleanVidUrl,
              handle: data.title ? `${data.title.slice(0, 42)}…` : `watch?v=${vidId}`,
              source: "subject",
              roleLabel: "Video Source Match",
            });

            // Channel creator item
            if (data.author_url) {
              discovered.push({
                platform: "youtube",
                platformName: "YouTube Channel",
                url: data.author_url,
                handle: channelHandle.startsWith("@") ? channelHandle : `@${channelHandle}`,
                source: "author",
                roleLabel: "Video Channel / Publisher",
              });
            }

            return discovered;
          }
        } catch { }

        // Fallback for video
        discovered.push({
          platform: "youtube",
          platformName: "YouTube Video",
          url: cleanVidUrl,
          handle: `watch?v=${vidId}`,
          source: "subject",
          roleLabel: "Video Source Match",
        });
        return discovered;
      }

      // Direct YouTube Channel URL
      if (u.pathname.startsWith("/@")) {
        const handle = u.pathname.split("/")[1];
        discovered.push({
          platform: "youtube",
          platformName: "YouTube Channel",
          url: `https://www.youtube.com/${handle}`,
          handle,
          source: "subject",
          roleLabel: "Channel / Creator",
        });
        return discovered;
      }
    }

    // 3. X / Twitter
    if (host === "x.com" || host === "twitter.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        const handle = parts[0];
        if (!RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
          const isPost = parts.includes("status");
          discovered.push({
            platform: "x",
            platformName: "X (Twitter)",
            url: `https://x.com/${handle}`,
            handle: `@${handle}`,
            source: isPost ? "author" : "subject",
            roleLabel: isPost ? "Post Author" : "Target Profile Subject",
          });
          return discovered;
        }
      }
    }

    // 4. GitHub
    if (host === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0 && !RESERVED_USERNAMES.has(parts[0].toLowerCase())) {
        discovered.push({
          platform: "github",
          platformName: "GitHub",
          url: `https://github.com/${parts[0]}`,
          handle: `@${parts[0]}`,
          source: parts.length > 1 ? "author" : "subject",
          roleLabel: parts.length > 1 ? "Repository Owner" : "Target Profile Subject",
        });
        return discovered;
      }
    }
  } catch { }

  return discovered;
}

export function classifySocialUrl(urlStr: string): {
  platform: DiscoveredProfile["platform"];
  platformName: string;
  handle: string;
  canonicalUrl: string;
} | null {
  try {
    if (isNoise(urlStr)) return null;

    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);

    // Devfolio profile or project. Project pages are useful associated links,
    // but must retain their real URL rather than becoming "@projects".
    if (host === "devfolio.co" || host.endsWith(".devfolio.co")) {
      if (parts[0]?.toLowerCase() === "projects" && parts[1]) {
        return {
          platform: "devfolio",
          platformName: "Devfolio",
          handle: parts[1],
          canonicalUrl: `https://devfolio.co/projects/${parts[1]}`,
        };
      }
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase())) {
        return {
          platform: "devfolio",
          platformName: "Devfolio",
          handle: `@${handle}`,
          canonicalUrl: `https://devfolio.co/@${handle}`,
        };
      }
    }

    // GitHub: github.com/username
    if (host === "github.com") {
      const handle = parts[0] || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_-]{1,39}$/.test(handle)) {
        return {
          platform: "github",
          platformName: "GitHub",
          handle: `@${handle}`,
          canonicalUrl: `https://github.com/${handle}`,
        };
      }
    }

    // LinkedIn: linkedin.com/in/username or any regional in.linkedin.com / ca.linkedin.com / uk.linkedin.com
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      if (parts[0] === "in" && parts[1]) {
        const handle = parts[1];
        if (!RESERVED_USERNAMES.has(handle.toLowerCase())) {
          return {
            platform: "linkedin",
            platformName: "LinkedIn",
            handle: `in/${handle}`,
            canonicalUrl: `https://www.linkedin.com/in/${handle}`,
          };
        }
      }
    }

    // X / Twitter: x.com/username or twitter.com/username
    if (host === "x.com" || host === "twitter.com") {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
        return {
          platform: "x",
          platformName: "X (Twitter)",
          handle: `@${handle}`,
          canonicalUrl: `https://x.com/${handle}`,
        };
      }
    }

    // Instagram: instagram.com/username
    if (host === "instagram.com") {
      const handle = parts[0]?.replace(/^@/, "") || "";
      if (handle && !RESERVED_USERNAMES.has(handle.toLowerCase()) && /^[a-zA-Z0-9_.]+$/.test(handle)) {
        return {
          platform: "instagram",
          platformName: "Instagram",
          handle: `@${handle}`,
          canonicalUrl: `https://www.instagram.com/${handle}`,
        };
      }
    }

    // YouTube: ONLY valid creator channels or video URLs
    if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
      // Channel with @handle
      if (parts[0]?.startsWith("@")) {
        const handle = parts[0];
        return {
          platform: "youtube",
          platformName: "YouTube Channel",
          handle,
          canonicalUrl: `https://www.youtube.com/${handle}`,
        };
      }
      // Channel by ID or custom name
      if ((parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") && parts[1]) {
        return {
          platform: "youtube",
          platformName: "YouTube Channel",
          handle: `@${parts[1]}`,
          canonicalUrl: `https://www.youtube.com/${parts[0]}/${parts[1]}`,
        };
      }
      // Video link
      const vParam = u.searchParams.get("v");
      if ((parts[0] === "watch" && vParam) || (host === "youtu.be" && parts[0] && parts[0].length >= 10)) {
        const vidId = vParam || parts[0];
        return {
          platform: "youtube",
          platformName: "YouTube Video",
          handle: `watch?v=${vidId}`,
          canonicalUrl: `https://www.youtube.com/watch?v=${vidId}`,
        };
      }
    }

    // Reddit: reddit.com/user/handle
    if (host === "reddit.com") {
      if ((parts[0] === "user" || parts[0] === "u") && parts[1]) {
        return {
          platform: "reddit",
          platformName: "Reddit",
          handle: `u/${parts[1]}`,
          canonicalUrl: `https://www.reddit.com/user/${parts[1]}`,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function extractBioHubUrl(html: string): string | null {
  const HREF_REGEX = /href=["'](https?:\/\/[^"'\s>]+)["']/gi;
  const RAW_URL_REGEX = /https?:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s"'>]*)?/gi;

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
        const path = u.pathname.replace(/\/+$/, "");
        if (path.length > 1 && !RESERVED_USERNAMES.has(path.replace(/^\//, "").toLowerCase())) {
          return normalizeCanonicalUrl(raw);
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
  hubUrl?: string,
  isSocialPostPage = false,
  authorHandle?: string
): DiscoveredProfile[] {
  const seenUrls = new Set<string>();
  const profiles: DiscoveredProfile[] = [];

  const candidates: string[] = [];

  // 1. Standard absolute hrefs
  const HREF_REGEX = /href=["'](https?:\/\/[^"'\s>]+)["']/gi;
  for (const m of html.matchAll(HREF_REGEX)) {
    if (m[1]) candidates.push(m[1]);
  }

  // 2. Relative LinkedIn hrefs like href="/in/bhavya-pratap-singh-tomar"
  const REL_HREF_REGEX = /href=["'](\/(?:in|mwlite\/in)\/[a-zA-Z0-9\-_%]+(?:\?[^"'\s>]*)?)["']/gi;
  for (const m of html.matchAll(REL_HREF_REGEX)) {
    if (m[1]) {
      candidates.push(`https://www.linkedin.com${m[1]}`);
    }
  }

  // 3. Raw URLs in page scripts / JSON-LD / text
  const RAW_URL_REGEX = /https?:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s"'>]*)?/gi;
  for (const m of html.matchAll(RAW_URL_REGEX)) {
    candidates.push(m[0]);
  }

  // 4. LinkedIn Urns like urn:li:fsd_profile:bhavya-pratap-singh-tomar
  const LINKEDIN_URN_REGEX = /urn:li:fsd_profile:([a-zA-Z0-9\-_%]+)/gi;
  for (const m of html.matchAll(LINKEDIN_URN_REGEX)) {
    if (m[1] && !RESERVED_USERNAMES.has(m[1].toLowerCase())) {
      candidates.push(`https://www.linkedin.com/in/${m[1]}`);
    }
  }

  // 5. JSON-escaped or encoded LinkedIn profile URLs like \/in\/bhavya-pratap-singh-tomar
  const ESCAPED_LINKEDIN_REGEX = /(?:\\\/in\\\/|&quot;\/in\/|&apos;\/in\/|"\/in\/|'\/in\/)([a-zA-Z0-9\-_%]+)/gi;
  for (const m of html.matchAll(ESCAPED_LINKEDIN_REGEX)) {
    if (m[1] && !RESERVED_USERNAMES.has(m[1].toLowerCase())) {
      candidates.push(`https://www.linkedin.com/in/${m[1]}`);
    }
  }

  for (const raw of candidates) {
    const classified = classifySocialUrl(raw);
    if (!classified) continue;

    const norm = classified.canonicalUrl.toLowerCase();
    if (seenUrls.has(norm)) continue;
    seenUrls.add(norm);

    let profileSource: DiscoveredProfile["source"] = source;
    let roleLabel = source === "bio-hub" ? "via Bio-Hub (Linktree)" : "Page Outbound Claim";

    if (isSocialPostPage) {
      if (authorHandle && classified.handle.toLowerCase().includes(authorHandle.toLowerCase())) {
        profileSource = "author";
        roleLabel = "Post Author / Publisher";
      } else if (classified.platform === "linkedin") {
        profileSource = "commenter";
        roleLabel = "Commenter / Tagged Subject";
      }
    }

    profiles.push({
      platform: classified.platform,
      platformName: classified.platformName,
      url: classified.canonicalUrl,
      handle: classified.handle,
      source: profileSource,
      roleLabel,
      hubUrl,
    });
  }

  return profiles;
}

/** Fetch page HTML with timeout and desktop user-agent */
async function fetchHtml(targetUrl: string, timeoutMs = 7000): Promise<string> {
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

const nameSearchCache = new Map<string, Promise<DiscoveredProfile[]>>();

function displayNameFromTarget(title: string | undefined, targetUrl: string): string | null {
  const fromTitle = title?.match(/\(([^)]+)\)/)?.[1] || title?.split(/\s+[|·-]\s+/)[0];
  const fromUrl = (() => {
    try {
      const u = new URL(targetUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0] === "in" ? parts[1] : parts[0];
    } catch {
      return undefined;
    }
  })();
  const value = (fromTitle || fromUrl || "").replace(/[._-]+/g, " ").trim();
  if (!value || value.split(/\s+/).length < 2) return null;
  return value;
}

async function searchNamedProfiles(
  title: string | undefined,
  targetUrl: string,
  category?: string,
  categoryLabel?: string,
): Promise<DiscoveredProfile[]> {
  const name = displayNameFromTarget(title, targetUrl);
  const key = name?.toLowerCase();
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!key || !name || !apiKey) return [];
  const cached = nameSearchCache.get(key);
  if (cached) {
    return (await cached).map((profile) => ({ ...profile, category, categoryLabel }));
  }

  const request = (async () => {
    const params = new URLSearchParams({
      engine: "google",
      q: `"${name}" site:devfolio.co`,
      api_key: apiKey,
      num: "20",
      hl: "en",
    });
    try {
      const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
      };
      const normalizedName = name.toLowerCase().replace(/\s+/g, " ");
      const profiles: DiscoveredProfile[] = [];
      const seen = new Set<string>();
      for (const result of json.organic_results ?? []) {
        if (!result.link) continue;
        const evidence = `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase().replace(/\s+/g, " ");
        if (!evidence.includes(normalizedName)) continue;
        const classified = classifySocialUrl(result.link);
        if (!classified || seen.has(classified.canonicalUrl)) continue;
        seen.add(classified.canonicalUrl);
        profiles.push({
          platform: classified.platform,
          platformName: classified.platformName,
          url: classified.canonicalUrl,
          handle: classified.handle,
          source: "page",
          roleLabel: "Exact-name search lead",
        });
      }
      return profiles;
    } catch {
      return [];
    }
  })();
  nameSearchCache.set(key, request);
  return (await request).map((profile) => ({ ...profile, category, categoryLabel }));
}

/**
 * Executes a full cyber intelligence sweep for a target URL:
 * 1. Resolves post authors / primary subject profiles directly from URL
 * 2. Crawls target page HTML for direct social links, commenters, and tagged profiles
 * 3. Detects bio hubs (Linktree, Beacons, Carrd)
 * 4. Crawls bio hub 1-hop and pulls underlying linked identities
 */
export async function crawlConnectedIdentities(
  targetUrl: string,
  category?: string,
  categoryLabel?: string,
  title?: string,
): Promise<IntelReport> {
  const start = Date.now();
  const seenUrls = new Set<string>();
  const profiles: DiscoveredProfile[] = [];

  // 1. Primary subjects & post author directly from target URL
  const directSubjects = await extractPrimarySubjectFromUrl(targetUrl);
  for (const s of directSubjects) {
    seenUrls.add(s.url.toLowerCase());
    profiles.push({
      ...s,
      category,
      categoryLabel,
    });
  }

  // If the target is YouTube, extractPrimarySubjectFromUrl already fetched the clean video and channel
  // We do NOT fetch raw YouTube HTML to avoid thousands of internal asset script paths!
  const isYouTube = targetUrl.includes("youtube.com") || targetUrl.includes("youtu.be");
  if (isYouTube) {
    return {
      targetUrl,
      hubFound: null,
      profiles,
      scannedAt: new Date().toISOString(),
      elapsedMs: Date.now() - start,
    };
  }

  const isSocialPost = targetUrl.includes("linkedin.com/posts") ||
    targetUrl.includes("x.com/") ||
    targetUrl.includes("twitter.com/") ||
    targetUrl.includes("instagram.com/p/");

  const authorHandle = directSubjects.find((s) => s.source === "author")?.handle.replace(/^in\/|^@/, "");

  // 2. Direct page profiles & commenters
  const directHtml = await fetchHtml(targetUrl, 7000);
  if (directHtml) {
    const directProfiles = parseLinksFromHtml(
      directHtml,
      "page",
      undefined,
      isSocialPost,
      authorHandle
    );
    for (const p of directProfiles) {
      const norm = p.url.toLowerCase();
      if (!seenUrls.has(norm)) {
        seenUrls.add(norm);
        profiles.push({
          ...p,
          category,
          categoryLabel,
        });
      }
    }
  }

  // 3. Check if target URL itself is a bio hub
  let hubUrl: string | null = null;
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (BIO_HUB_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
      hubUrl = normalizeCanonicalUrl(targetUrl);
    }
  } catch { }

  // 4. Or if direct HTML contains a link to a bio hub
  if (!hubUrl && directHtml) {
    hubUrl = extractBioHubUrl(directHtml);
  }

  // 5. Follow 1-hop into bio hub if discovered and not already crawled
  if (hubUrl && hubUrl.toLowerCase() !== normalizeCanonicalUrl(targetUrl).toLowerCase()) {
    const hubHtml = await fetchHtml(hubUrl, 7000);
    if (hubHtml) {
      const hubProfiles = parseLinksFromHtml(hubHtml, "bio-hub", hubUrl);
      for (const p of hubProfiles) {
        const norm = p.url.toLowerCase();
        if (!seenUrls.has(norm)) {
          seenUrls.add(norm);
          profiles.push({
            ...p,
            category,
            categoryLabel,
          });
        }
      }
    }
  }

  // A verified Lens page often has no outbound links. Use the displayed name
  // as a constrained discovery query so Devfolio projects and public profiles
  // are found, while requiring the exact name to appear in the result evidence.
  const namedProfiles = await searchNamedProfiles(title, targetUrl, category, categoryLabel);
  for (const profile of namedProfiles) {
    const norm = profile.url.toLowerCase();
    if (!seenUrls.has(norm)) {
      seenUrls.add(norm);
      profiles.push(profile);
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

/**
 * Concurrently crawls the top candidate target for each detected person / category
 */
export async function crawlMultiCategoryIdentities(
  targets: TargetSpecimen[]
): Promise<IntelReport[]> {
  const tasks = targets.map((t) =>
    crawlConnectedIdentities(t.url, t.category, t.label, t.title)
  );
  const settled = await Promise.allSettled(tasks);
  const reports: IntelReport[] = [];

  for (const res of settled) {
    if (res.status === "fulfilled") {
      reports.push(res.value);
    }
  }

  return reports;
}
