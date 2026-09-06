import { test, expect } from "@playwright/test";
import {
  classifySocialUrl,
  extractBioHubUrl,
  extractAuthorFromUrl,
  parseLinksFromHtml,
} from "../src/lib/page-crawler";

test.describe("Cyber Intelligence & Link-in-Bio Footprint Engine", () => {
  test("extractAuthorFromUrl extracts LinkedIn post authors from URLs", () => {
    const url1 =
      "https://www.linkedin.com/posts/art-commisso-36761a111_one-of-these-group-photos-is-a-composite-activity-7500923816609648640-kOZn";
    const author1 = extractAuthorFromUrl(url1);
    expect(author1).not.toBeNull();
    expect(author1?.handle).toBe("in/art-commisso-36761a111");
    expect(author1?.url).toBe("https://www.linkedin.com/in/art-commisso-36761a111");
    expect(author1?.source).toBe("author");

    const url2 =
      "https://www.linkedin.com/posts/chiragbachwani_galaxyai-flutter-activity-7351546305581604866-8c7K";
    const author2 = extractAuthorFromUrl(url2);
    expect(author2).not.toBeNull();
    expect(author2?.handle).toBe("in/chiragbachwani");
    expect(author2?.url).toBe("https://www.linkedin.com/in/chiragbachwani");
    expect(author2?.source).toBe("author");

    const xUrl = "https://x.com/satabora/status/1789012345678901234";
    const xAuthor = extractAuthorFromUrl(xUrl);
    expect(xAuthor).not.toBeNull();
    expect(xAuthor?.handle).toBe("@satabora");
    expect(xAuthor?.platform).toBe("x");
  });

  test("parseLinksFromHtml extracts commenters and tagged profiles including Bhavya Pratap Singh Tomar", () => {
    // Simulated LinkedIn post HTML containing comments and tagged entities
    const postHtml = `
      <div class="comments-container">
        <a href="/in/bhavya-pratap-singh-tomar" class="commenter-link">Bhavya Pratap Singh Tomar</a>
        <a href="https://in.linkedin.com/in/rahulrawatr">Rahul Rawat</a>
        <a href="/in/aditya-bhandari23">Aditya Bhandari</a>
        <a href="https://www.linkedin.com/in/stoppeddownstudio">Stopped Down Studio</a>
        <span data-urn="urn:li:fsd_profile:priyasha-khurana">Priyasha Khurana</span>
      </div>
    `;

    const profiles = parseLinksFromHtml(
      postHtml,
      "page",
      undefined,
      true, // isSocialPostPage
      "chiragbachwani" // authorHandle
    );

    const handles = profiles.map((p) => p.handle);
    expect(handles).toContain("in/bhavya-pratap-singh-tomar");
    expect(handles).toContain("in/rahulrawatr");
    expect(handles).toContain("in/aditya-bhandari23");
    expect(handles).toContain("in/stoppeddownstudio");
    expect(handles).toContain("in/priyasha-khurana");

    // Verify commenter role classification
    const bhavya = profiles.find((p) => p.handle === "in/bhavya-pratap-singh-tomar");
    expect(bhavya?.source).toBe("commenter");
    expect(bhavya?.roleLabel).toBe("Commenter / Tagged Subject");
  });

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

    // Regional LinkedIn
    const regLinkedin = classifySocialUrl("https://in.linkedin.com/in/bhavya-pratap-singh-tomar");
    expect(regLinkedin).not.toBeNull();
    expect(regLinkedin?.platform).toBe("linkedin");
    expect(regLinkedin?.handle).toBe("in/bhavya-pratap-singh-tomar");

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

  test("POST /api/intel returns author and commenters for LinkedIn posts", async ({
    request,
  }) => {
    const mockPostHtml = `
      <div class="feed-shared-update">
        <a href="/in/bhavya-pratap-singh-tomar">Bhavya Pratap Singh Tomar</a>
        <a href="/in/stoppeddownstudio">Studio</a>
      </div>
    `;

    const res = await request.post("/api/intel", {
      data: {
        url: "https://www.linkedin.com/posts/chiragbachwani_galaxyai-flutter-activity-7351546305581604866-8c7K",
        html: mockPostHtml,
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    const handles = data.profiles.map((p: { handle: string }) => p.handle);
    // Post author resolved directly from permalink
    expect(handles).toContain("in/chiragbachwani");
    // Commenter resolved from post thread
    expect(handles).toContain("in/bhavya-pratap-singh-tomar");
    expect(handles).toContain("in/stoppeddownstudio");

    const author = data.profiles.find((p: { handle: string }) => p.handle === "in/chiragbachwani");
    expect(author?.source).toBe("author");
  });

  test("POST /api/intel supports multi-category targets (Scene + Person 1 + Person 2)", async ({
    request,
  }) => {
    const res = await request.post("/api/intel", {
      data: {
        targets: [
          {
            url: "https://www.linkedin.com/posts/art-commisso-36761a111_one-of-these-group-photos-is-a-composite-activity-7500923816609648640-kOZn",
            category: "scene",
            label: "Scene Context",
            similarityBp: 8636,
          },
          {
            url: "https://www.linkedin.com/posts/chiragbachwani_galaxyai-flutter-activity-7351546305581604866-8c7K",
            category: "face_0",
            label: "Person 1",
            similarityBp: 9780,
          },
        ],
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.multi).toBe(true);
    expect(Array.isArray(data.reports)).toBeTruthy();
    expect(data.reports.length).toBe(2);

    // Target 1 should have resolved Art Commisso
    const report1Handles = data.reports[0].profiles.map((p: { handle: string }) => p.handle);
    expect(report1Handles).toContain("in/art-commisso-36761a111");

    // Target 2 should have resolved Chirag Bachwani
    const report2Handles = data.reports[1].profiles.map((p: { handle: string }) => p.handle);
    expect(report2Handles).toContain("in/chiragbachwani");
  });

  test("POST /api/intel validates missing target URL", async ({ request }) => {
    const res = await request.post("/api/intel", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});
