import { test, expect } from "@playwright/test";
import {
  classifySocialUrl,
  extractBioHubUrl,
  parseLinksFromHtml,
} from "../src/lib/page-crawler";

test.describe("Cyber Intelligence & Link-in-Bio Footprint Engine", () => {
  test("classifySocialUrl extracts handles for Devfolio, X, Instagram, LinkedIn, GitHub", () => {
    // Devfolio
    const devfolio = classifySocialUrl("https://devfolio.co/@vaibhav_hacks");
    expect(devfolio).not.toBeNull();
    expect(devfolio?.platform).toBe("devfolio");
    expect(devfolio?.handle).toBe("@vaibhav_hacks");

    // LinkedIn
    const linkedin = classifySocialUrl("https://www.linkedin.com/in/vaibhav-shivhare-web3");
    expect(linkedin).not.toBeNull();
    expect(linkedin?.platform).toBe("linkedin");
    expect(linkedin?.handle).toBe("in/vaibhav-shivhare-web3");

    // X / Twitter
    const x = classifySocialUrl("https://x.com/vaibhav_builds");
    expect(x).not.toBeNull();
    expect(x?.platform).toBe("x");
    expect(x?.handle).toBe("@vaibhav_builds");

    // Instagram
    const insta = classifySocialUrl("https://instagram.com/vaibhav_clicks");
    expect(insta).not.toBeNull();
    expect(insta?.platform).toBe("instagram");
    expect(insta?.handle).toBe("@vaibhav_clicks");

    // GitHub
    const github = classifySocialUrl("https://github.com/vaibhav-dev");
    expect(github).not.toBeNull();
    expect(github?.platform).toBe("github");
    expect(github?.handle).toBe("@vaibhav-dev");

    // Filter noise/share URLs
    const shareDialog = classifySocialUrl("https://twitter.com/intent/tweet?text=hello");
    expect(shareDialog).toBeNull();
  });

  test("extractBioHubUrl detects Linktree, Beacons, and Bento hubs", () => {
    const htmlWithLinktree = `
      <div>
        <p>Check my socials:</p>
        <a href="https://linktr.ee/vaibhav_hub?utm_source=portfolio">My Linktree</a>
      </div>
    `;
    const hub = extractBioHubUrl(htmlWithLinktree);
    expect(hub).toBe("https://linktr.ee/vaibhav_hub");

    const htmlWithBeacons = `<a href="https://beacons.ai/anirban">Beacons</a>`;
    expect(extractBioHubUrl(htmlWithBeacons)).toBe("https://beacons.ai/anirban");
  });

  test("parseLinksFromHtml extracts full set of social accounts", () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <a href="https://devfolio.co/@vaibhav_lead">Devfolio Profile</a>
          <a href="https://www.linkedin.com/in/vaibhav-lead">LinkedIn</a>
          <a href="https://x.com/vaibhav_lead">Twitter / X</a>
          <a href="https://instagram.com/vaibhav_lead">Instagram</a>
          <a href="https://github.com/vaibhav-lead">GitHub</a>
          <a href="https://youtube.com/@vaibhav_talks">YouTube</a>
          <a href="https://reddit.com/user/vaibhav_mod">Reddit</a>
          <!-- Noise links that should be discarded -->
          <a href="https://twitter.com/intent/tweet">Share</a>
          <a href="https://linkedin.com/help">Help</a>
        </body>
      </html>
    `;

    const profiles = parseLinksFromHtml(sampleHtml, "page");
    const platforms = profiles.map((p) => p.platform);

    expect(platforms).toContain("devfolio");
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("x");
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("github");
    expect(platforms).toContain("youtube");
    expect(platforms).toContain("reddit");
    expect(profiles.length).toBe(7);
  });

  test("POST /api/intel returns discovered social profiles and bio hub via API", async ({
    request,
  }) => {
    const mockHtml = `
      <div class="profile-card">
        <h1>Vaibhav Shivhare</h1>
        <a href="https://linktr.ee/vaibhav_demo">Linktree Hub</a>
        <a href="https://devfolio.co/@vaibhav_dev">Devfolio</a>
        <a href="https://www.linkedin.com/in/vaibhav-demo">LinkedIn</a>
        <a href="https://x.com/vaibhav_demo">X</a>
        <a href="https://instagram.com/vaibhav_demo">Instagram</a>
        <a href="https://github.com/vaibhav-demo">GitHub</a>
      </div>
    `;

    const res = await request.post("/api/intel", {
      data: {
        url: "https://portfolio.demo.local/vaibhav",
        html: mockHtml,
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.targetUrl).toBe("https://portfolio.demo.local/vaibhav");
    expect(data.hubFound).toBe("https://linktr.ee/vaibhav_demo");
    expect(Array.isArray(data.profiles)).toBeTruthy();

    const platforms = data.profiles.map((p: { platform: string }) => p.platform);
    expect(platforms).toContain("devfolio");
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("x");
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("github");
  });

  test("POST /api/intel validates missing target URL", async ({ request }) => {
    const res = await request.post("/api/intel", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("UI renders CyberIntelFootprint component with radar telemetry badge", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000");

    // Check page title and station console exist
    await expect(page).toHaveTitle(/Facechain/i);
    const consoleHeader = page.locator("text=Facechain");
    await expect(consoleHeader.first()).toBeVisible();

    // Verify API endpoint works live through page fetch
    const evalResult = await page.evaluate(async () => {
      const res = await fetch("/api/intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/test",
          html: `<a href="https://devfolio.co/@eva">Devfolio</a><a href="https://x.com/eva">X</a><a href="https://instagram.com/eva">Insta</a><a href="https://www.linkedin.com/in/eva">LinkedIn</a><a href="https://linktr.ee/eva">Linktree</a>`,
        }),
      });
      return await res.json();
    });

    expect(evalResult.hubFound).toBe("https://linktr.ee/eva");
    expect(evalResult.profiles.length).toBeGreaterThanOrEqual(4);
    const platforms = evalResult.profiles.map((p: { platform: string }) => p.platform);
    expect(platforms).toContain("devfolio");
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("x");
    expect(platforms).toContain("instagram");
  });
});
