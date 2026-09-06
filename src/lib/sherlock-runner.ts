/**
 * Sherlock Runner — thin adapter over the pure TypeScript Sherlock engine.
 *
 * Uses sherlock-engine.ts (414 platforms, same data.json as the Python package)
 * via Web Fetch API — zero Python, zero child processes, works on Vercel.
 *
 * Consumers (aggregator.ts, /api/sherlock) always import from here.
 */

import { sherlockSearch } from "./sherlock-engine";

export type SherlockResult = {
  platform: string;
  url: string;
};

/**
 * Run Sherlock for a username. Returns found platform profiles.
 * Always uses the pure TypeScript engine — Vercel-compatible.
 */
export async function runSherlock(username: string): Promise<SherlockResult[]> {
  return sherlockSearch(username, {
    maxResults: 30,
    skipNsfw: true,
    timeoutMs: 4000,
  });
}
