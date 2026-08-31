import type { Candidate, SearchOutcome, SearchProvider } from "./types";
import { hostOf, isSocial } from "./types";

/**
 * Google Lens through SerpApi.
 *
 * Lens will not accept raw bytes, so this is a two-step call: POST the probe
 * to SerpApi's image endpoint to get an `image_id`, then run the Lens search
 * against that id. No third-party image host is involved.
 *
 * Lens matches on whole-image visual similarity, not on face embeddings, so
 * its candidates are treated as leads only. Every one of them is re-encoded
 * against the probe face downstream before anything is called a match.
 */
export class SerpApiLens implements SearchProvider {
  readonly id = "serpapi:google_lens";
  readonly label = "Google Lens (SerpApi)";

  private get key() {
    return process.env.SERPAPI_API_KEY || "";
  }

  configured() {
    return this.key.length > 0;
  }

  private async uploadImage(image: Uint8Array, mime: string): Promise<string> {
    // SerpApi caps the upload at 500 KB.
    if (image.byteLength > 500_000) {
      throw new Error(
        `Probe image is ${Math.round(image.byteLength / 1024)} KB; SerpApi accepts at most 500 KB. Re-capture at a lower resolution.`,
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

  private async lensQuery(
    imageId: string,
    type: string | null,
  ): Promise<
    Array<{ title?: string; link?: string; source?: string; thumbnail?: string; image?: string }>
  > {
    const params = new URLSearchParams({
      engine: "google_lens",
      image_id: imageId,
      api_key: this.key,
    });
    if (type) params.set("type", type);

    const res = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SerpApi Lens search failed (${res.status}): ${text.slice(0, 300)}`);
    }

    let json: {
      error?: string;
      visual_matches?: Array<{
        title?: string;
        link?: string;
        source?: string;
        thumbnail?: string;
        image?: string;
      }>;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`SerpApi Lens returned non-JSON: ${text.slice(0, 300)}`);
    }
    if (json.error) throw new Error(`SerpApi Lens: ${json.error}`);
    return json.visual_matches ?? [];
  }

  async search(image: Uint8Array, mime: string): Promise<SearchOutcome> {
    if (!this.configured()) throw new Error("SERPAPI_API_KEY is not set.");

    const imageId = await this.uploadImage(image, mime);

    // The default response type already carries visual_matches. If it comes
    // back empty we ask for that section explicitly once, since SerpApi has
    // shipped both shapes and an empty Adjudication station is worse than
    // spending a second search.
    let raw = await this.lensQuery(imageId, null);
    if (raw.length === 0) {
      raw = await this.lensQuery(imageId, "visual_matches");
    }
    const candidates: Candidate[] = raw
      .filter((m) => m.link && (m.image || m.thumbnail))
      .map((m) => ({
        url: m.link as string,
        imageUrl: (m.image || m.thumbnail) as string,
        title: m.title?.trim() || hostOf(m.link as string),
        source: m.source?.trim() || hostOf(m.link as string),
      }));

    // Social pages first; they are what the task asks us to surface. Order
    // within each group is left as Lens ranked it.
    candidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));

    return { provider: this.id, candidates, queryRef: imageId };
  }
}
