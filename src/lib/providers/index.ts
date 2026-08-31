import type { SearchProvider } from "./types";
import { SerpApiLens } from "./serpapi";
import { FaceCheckId } from "./facecheck";

const REGISTRY: SearchProvider[] = [new SerpApiLens(), new FaceCheckId()];

/**
 * Picks the backend named by SEARCH_PROVIDER, otherwise the first one holding
 * credentials. Returns null when nothing is configured, so the API can say so
 * plainly rather than invent results.
 */
export function activeProvider(): SearchProvider | null {
  const want = process.env.SEARCH_PROVIDER;
  if (want) {
    const named = REGISTRY.find(
      (p) => p.id === want || p.id.split(":")[0] === want,
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
