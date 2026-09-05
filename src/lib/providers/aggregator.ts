import type { Candidate, SearchOutcome, SearchProvider } from "./types";
import { SerpApiLens } from "./serpapi";
import { SerpApiYandex } from "./yandex";
import { isSocial } from "./types";

/**
 * MultiEngineAggregator: Parallel reverse search querying both Google Lens
 * and Yandex Images via SerpApi.
 *
 * Benefits:
 * 1. Zero latency penalty: Executes both queries concurrently using
 *    Promise.allSettled(), taking max(T_lens, T_yandex) (~1.2s - 1.8s).
 * 2. Superior coverage: Combines Google's web index with Yandex's
 *    specialized facial resemblance algorithms.
 * 3. Fault-tolerant: If one engine encounters a transient failure, the other
 *    engine's leads are still delivered to Station III.
 */
export class MultiEngineAggregator implements SearchProvider {
  readonly id = "aggregator:lens_yandex";
  readonly label = "Multi-Engine (Google Lens + Yandex)";

  private lens = new SerpApiLens();
  private yandex = new SerpApiYandex();

  configured(): boolean {
    return this.lens.configured() || this.yandex.configured();
  }

  async search(image: Uint8Array, mime: string): Promise<SearchOutcome> {
    const [lensRes, yandexRes] = await Promise.allSettled([
      this.lens.search(image, mime),
      this.yandex.search(image, mime),
    ]);

    const candidates: Candidate[] = [];
    const seenUrls = new Set<string>();

    const addCandidates = (list: Candidate[]) => {
      for (const c of list) {
        if (!seenUrls.has(c.url)) {
          seenUrls.add(c.url);
          candidates.push(c);
        }
      }
    };

    let lensSuccess = false;
    let yandexSuccess = false;
    const errors: string[] = [];

    if (lensRes.status === "fulfilled") {
      lensSuccess = true;
      addCandidates(lensRes.value.candidates);
    } else {
      errors.push(`Google Lens: ${lensRes.reason?.message ?? lensRes.reason}`);
    }

    if (yandexRes.status === "fulfilled") {
      yandexSuccess = true;
      addCandidates(yandexRes.value.candidates);
    } else {
      errors.push(`Yandex: ${yandexRes.reason?.message ?? yandexRes.reason}`);
    }

    if (!lensSuccess && !yandexSuccess) {
      throw new Error(`All search engines failed: ${errors.join(" | ")}`);
    }

    // Prioritize social profiles to the front
    candidates.sort((a, b) => Number(isSocial(b.url)) - Number(isSocial(a.url)));

    return {
      provider: this.id,
      candidates,
      queryRef: `multi:${lensSuccess ? "lens" : ""}+${yandexSuccess ? "yandex" : ""}`,
    };
  }
}
