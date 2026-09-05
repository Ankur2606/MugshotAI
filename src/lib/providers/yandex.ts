import type { Candidate, SearchOutcome, SearchProvider } from "./types";
import { hostOf, isSocial } from "./types";

/**
 * Yandex Images reverse search through SerpApi.
 *
 * Yandex is widely considered in the OSINT community as state-of-the-art
 * for facial resemblance, avatar discovery, and social media presence
 * across varied angles, lighting, and resolutions.
 *
 * Uses the exact same SERPAPI_API_KEY as Google Lens.
 */
export class SerpApiYandex implements SearchProvider {
  readonly id = "serpapi:yandex_images";
  readonly label = "Yandex Images (SerpApi)";

  private get key() {
    return process.env.SERPAPI_API_KEY || "";
  }

  configured() {
    return this.key.length > 0;
  }

  private async uploadImage(image: Uint8Array, mime: string): Promise<string> {
    if (image.byteLength > 500_000) {
      throw new Error(
        `Probe image is ${Math.round(image.byteLength / 1024)} KB; SerpApi accepts at most 500 KB.`,
      );
    }
    const form = new FormData();
    form.append("image", new Blob([image as BlobPart], { type: mime }), "probe.jpg");
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
      engine: "yandex_images",
      url: `https://serpapi.com/searches/${imageId}/image`,
      api_key: this.key,
    });

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SerpApi Yandex search failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let json: {
      error?: string;
      image_results?: Array<{
        title?: string;
        link?: string;
        source?: string;
        thumbnail?: string;
        original?: string;
        image?: string;
      }>;
      similar_images?: Array<{
        title?: string;
        link?: string;
        source?: string;
        thumbnail?: string;
        original?: string;
        image?: string;
      }>;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`SerpApi Yandex returned non-JSON: ${text.slice(0, 300)}`);
    }

    if (json.error) throw new Error(`SerpApi Yandex: ${json.error}`);

    const raw = json.image_results ?? json.similar_images ?? [];
    const candidates: Candidate[] = raw
      .filter((m) => m.link && (m.original || m.image || m.thumbnail))
      .map((m) => {
        const link = m.link as string;
        const img = (m.original || m.image || m.thumbnail) as string;
        return {
          url: link,
          imageUrl: img,
          title: m.title?.trim() || hostOf(link),
          source: m.source?.trim() || hostOf(link),
        };
      });

    candidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));

    return { provider: this.id, candidates, queryRef: imageId };
  }
}
