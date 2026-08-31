import type { Candidate, SearchOutcome, SearchProvider } from "./types";
import { hostOf, isSocial } from "./types";

/**
 * FaceCheck.ID — an actual face-embedding search over indexed public pages,
 * so its hit rate on social profiles is far better than whole-image search.
 * It is paid (credits), which is why Lens is the default. Set
 * FACECHECK_API_TOKEN and SEARCH_PROVIDER=facecheck to use it.
 *
 * FACECHECK_DEMO=true runs their no-credit demo mode, which searches only a
 * small slice of the index. Useful for wiring checks, not for a real result.
 */
export class FaceCheckId implements SearchProvider {
  readonly id = "facecheck.id";
  readonly label = "FaceCheck.ID face search";

  private get token() {
    return process.env.FACECHECK_API_TOKEN || "";
  }

  configured() {
    return this.token.length > 0;
  }

  async search(image: Uint8Array, mime: string): Promise<SearchOutcome> {
    if (!this.configured()) throw new Error("FACECHECK_API_TOKEN is not set.");
    const demo = process.env.FACECHECK_DEMO === "true";
    const headers = { Authorization: this.token, Accept: "application/json" };

    const form = new FormData();
    form.append("images", new Blob([image as BlobPart], { type: mime }), "probe.jpg");
    const up = await fetch("https://facecheck.id/api/upload_pic", {
      method: "POST",
      headers,
      body: form,
    });
    const upJson = (await up.json()) as {
      error?: string;
      id_search?: string;
      message?: string;
    };
    if (upJson.error) {
      throw new Error(`FaceCheck upload: ${upJson.error} ${upJson.message ?? ""}`);
    }
    if (!upJson.id_search) throw new Error("FaceCheck upload returned no id_search.");

    // The search runs async on their side; poll until `output` appears.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const res = await fetch("https://facecheck.id/api/search", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          id_search: upJson.id_search,
          with_progress: true,
          status_only: false,
          demo,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        output?: { items?: Array<{ score?: number; url?: string; base64?: string }> };
      };
      if (json.error) {
        throw new Error(`FaceCheck search: ${json.error} ${json.message ?? ""}`);
      }

      if (json.output?.items) {
        const candidates: Candidate[] = json.output.items
          .filter((i) => i.url)
          .map((i) => ({
            url: i.url as string,
            // FaceCheck returns the matched crop inline as a data URL.
            imageUrl: i.base64 || "",
            title: hostOf(i.url as string),
            source: hostOf(i.url as string),
            providerScoreBp:
              typeof i.score === "number" ? Math.round(i.score * 100) : undefined,
          }));
        candidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));
        return { provider: this.id, candidates, queryRef: upJson.id_search };
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error("FaceCheck search timed out after 120s.");
  }
}
