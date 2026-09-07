import type { Candidate, SearchOutcome, SearchProvider } from "./types";
import { hostOf, isSocial } from "./types";
import sharp from "sharp";

/**
 * Bing Visual Search reverse image lookup through SerpApi.
 *
 * Bing keeps its own crawl, so it surfaces pages Google Lens and Yandex never
 * return — which is the whole point of running it. It is scene-and-duplicate
 * matching like the others, not face identity, so it widens recall rather
 * than improving precision.
 *
 * Uses the same SERPAPI_API_KEY as Lens and Yandex; no extra credentials.
 */
export class SerpApiBing implements SearchProvider {
  readonly id = "serpapi:bing_reverse_image";
  readonly label = "Bing Visual Search (SerpApi)";

  private get key() {
    return process.env.SERPAPI_API_KEY || "";
  }

  configured() {
    return this.key.length > 0;
  }

  /**
   * SerpApi hosts the probe and hands back an id; the engine then fetches it
   * by URL. Same two-step the Yandex provider uses, and the same 500 KB
   * ceiling applies, so oversized frames are downscaled first.
   */
  private async uploadImage(image: Uint8Array, mime: string): Promise<string> {
    let payload = image;
    let payloadMime = mime;
    if (payload.byteLength > 480_000) {
      try {
        const compressed = await sharp(image)
          .resize({ width: 1024, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        payload = new Uint8Array(compressed);
        payloadMime = "image/jpeg";
      } catch {}
    }

    const form = new FormData();
    form.append("image", new Blob([payload as BlobPart], { type: payloadMime }), "probe.jpg");
    form.append("api_key", this.key);

    const res = await fetch("https://serpapi.com/image", { method: "POST", body: form });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SerpApi image upload failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let json: { image_id?: string; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`SerpApi image upload returned non-JSON: ${text.slice(0, 300)}`);
    }
    if (json.error) throw new Error(`SerpApi image upload: ${json.error}`);
    if (!json.image_id) throw new Error("SerpApi image upload returned no image_id.");
    return json.image_id;
  }

  async search(image: Uint8Array, mime: string): Promise<SearchOutcome> {
    if (!this.configured()) throw new Error("SERPAPI_API_KEY is not set.");

    const imageId = await this.uploadImage(image, mime);

    const params = new URLSearchParams({
      engine: "bing_reverse_image",
      image_url: `https://serpapi.com/searches/${imageId}/image`,
      api_key: this.key,
    });

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SerpApi Bing search failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let json: {
      error?: string;
      pages_with_this_image?: BingResult[];
      related_content?: BingResult[];
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`SerpApi Bing returned non-JSON: ${text.slice(0, 300)}`);
    }

    if (json.error) throw new Error(`SerpApi Bing: ${json.error}`);

    /**
     * Pages that actually embed the image are the ones worth attributing;
     * related_content is looser and follows.
     *
     * Note the field mapping, which is the inverse of Yandex: Bing's `link`
     * is a bing.com/images/search redirect, and `source` holds the real page
     * URL. Taking `link` here would fill the docket with bing.com addresses
     * that no crawler downstream can do anything with.
     */
    const raw = [
      ...(json.pages_with_this_image ?? []),
      ...(json.related_content ?? []),
    ];

    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    for (const m of raw) {
      const page = m.source;
      const img = m.original || m.cdn_original || m.thumbnail;
      // A bing.com redirect is not a source page; drop anything that lacks a
      // real one rather than passing the redirect on.
      if (!page || !img) continue;
      if (!/^https?:\/\//i.test(page)) continue;
      if (hostOf(page).endsWith("bing.com")) continue;
      if (seen.has(page)) continue;
      seen.add(page);

      candidates.push({
        url: page,
        imageUrl: img,
        title: m.title?.trim() || hostOf(page),
        source: hostOf(page),
      });
    }

    candidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));

    return { provider: this.id, candidates, queryRef: imageId };
  }
}

type BingResult = {
  title?: string;
  /** A bing.com/images/search redirect, NOT the source page. */
  link?: string;
  /** The real page URL that embeds the image. */
  source?: string;
  thumbnail?: string;
  original?: string;
  cdn_original?: string;
};
