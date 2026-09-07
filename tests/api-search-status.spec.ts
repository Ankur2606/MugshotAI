import { test, expect } from "@playwright/test";

test.describe("Search & Status APIs", () => {
  test("GET /api/status returns search provider registry with MultiEngineAggregator", async ({
    request,
  }) => {
    const res = await request.get("/api/status");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();

    expect(json.search).toBeDefined();
    expect(Array.isArray(json.search.providers)).toBeTruthy();

    const providerIds = json.search.providers.map((p: { id: string }) => p.id);
    expect(providerIds).toContain("aggregator:lens_multiface");
    expect(providerIds).toContain("serpapi:google_lens");
    expect(providerIds).toContain("facecheck.id");

    if (json.search.active) {
      expect(json.search.active.id).toBe("aggregator:lens_multiface");
      expect(json.search.active.label).toContain("Multi-Engine");
    }
  });

  test("POST /api/search rejects request without multipart image", async ({ request }) => {
    const res = await request.post("/api/search", {
      data: { invalid: "data" },
      headers: { "Content-Type": "application/json" },
    });
    // Should return 400 bad request
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
