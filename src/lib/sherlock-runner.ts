/**
 * Sherlock Runner — Environment-aware adapter.
 *
 * - On Vercel / any non-Windows env: uses the pure TypeScript Sherlock engine
 *   (sherlock-engine.ts) — zero Python dependency, works everywhere.
 * - Locally on Windows (dev): can optionally use the Python CLI for speed,
 *   but falls back to the TS engine if the .exe is not found.
 *
 * Consumers (aggregator.ts, /api/sherlock) always import from here.
 */

export type SherlockResult = {
  platform: string;
  url: string;
};

/**
 * Run Sherlock for a username. Returns found platform profiles.
 * Always uses the pure TypeScript engine (Vercel-compatible).
 */
export async function runSherlock(username: string): Promise<SherlockResult[]> {
  // Always use the pure TS engine — works locally, on Vercel, on any platform.
  // The TS engine reads the same sherlock-sites.json (414 sites) that the
  // Python package ships, using the Web Fetch API with 30-way concurrency.
  const { sherlockSearch } = await import("./sherlock-engine");
  return sherlockSearch(username, {
    maxResults: 60,
    skipNsfw: true,
    timeoutMs: 7000,
  });
}
