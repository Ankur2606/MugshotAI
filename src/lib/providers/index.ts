import type { SearchProvider } from "./types";
import { SerpApiLens } from "./serpapi";
import { SerpApiYandex } from "./yandex";
import { MultiEngineAggregator } from "./aggregator";
import { FaceCheckId } from "./facecheck";

const REGISTRY: SearchProvider[] = [
  new MultiEngineAggregator(),
  new SerpApiLens(),
  new SerpApiYandex(),
  new FaceCheckId(),
];

/**
 * Picks the backend named by SEARCH_PROVIDER, otherwise the first one holding
 * credentials (defaulting to MultiEngineAggregator when SERPAPI_API_KEY is present).
 * Returns null when nothing is configured.
 */
export function activeProvider(): SearchProvider | null {
  const want = process.env.SEARCH_PROVIDER;
  if (want) {
    if (want === "serpapi" || want === "multi" || want === "aggregator") {
      const multi = REGISTRY.find((p) => p.id.includes("lens_yandex") || p.id.includes("aggregator"));
      if (multi && multi.configured()) return multi;
    }
    const named = REGISTRY.find(
      (p) =>
        p.id === want ||
        p.id.split(":")[0] === want ||
        p.id.split(":")[1] === want ||
        (want === "lens" && p.id.includes("lens")) ||
        (want === "yandex" && p.id.includes("yandex")),
    );
    if (named) return named;
  }
  return REGISTRY.find((p) => p.configured()) ?? null;
}

export function providerStatus() {
  return REGISTRY.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.configured(),
  }));
}

export type { SearchProvider };

