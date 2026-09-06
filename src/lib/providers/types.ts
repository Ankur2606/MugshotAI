/** One page the search backend believes contains the probe face. */
export type Candidate = {
  /** page the image was found on */
  url: string;
  /** direct URL of the image on that page */
  imageUrl: string;
  /** page title as reported by the provider */
  title: string;
  /** hostname, e.g. "instagram.com" */
  source: string;
  /** provider's own ranking confidence, basis points, if it reports one */
  providerScoreBp?: number;
  /** Which probe surfaced this candidate: "scene" | "face_0" | "osint", etc. */
  probeCategory?: string;
  probeLabel?: string;
};

export type ProbeBox = {
  id: string;
  label: string;
  box?: [number, number, number, number]; // [x, y, w, h] in image pixel space
  boxRaw?: [number, number, number, number]; // [x, y, w, h] normalized 0..1
};

export type SearchOutcome = {
  provider: string;
  candidates: Candidate[];
  /** provider-side query identifier, useful for auditing the search */
  queryRef?: string;
};

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  /** true when the required credentials are present */
  configured(): boolean;
  search(
    image: Uint8Array,
    mime: string,
    probes?: ProbeBox[],
  ): Promise<SearchOutcome>;
}

/** Hosts we treat as social platforms when ranking candidates. */
export const SOCIAL_HOSTS = [
  "instagram.com", "x.com", "twitter.com", "facebook.com", "linkedin.com",
  "tiktok.com", "youtube.com", "reddit.com", "threads.net", "threads.com",
  "pinterest.com", "flickr.com", "tumblr.com", "vk.com", "mastodon.social",
  "bsky.app", "github.com", "imdb.com",
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSocial(url: string): boolean {
  const h = hostOf(url);
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}
