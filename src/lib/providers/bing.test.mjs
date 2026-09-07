/**
 * Pins the SerpApi Bing response schema the provider parses.
 * Run: node src/lib/providers/bing.test.mjs
 *
 * bing.ts imports sharp and reads env, so it is not imported here. What this
 * guards is the shape assumption that actually cost time: Bing's `link` is a
 * bing.com redirect and `source` is the real page, which is the INVERSE of
 * Yandex. Get that backwards and the docket fills with bing.com addresses the
 * social crawler cannot follow. The fixture below is trimmed from a real
 * response (engine=bing_reverse_image).
 */
import assert from "node:assert/strict";

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Mirrors the candidate-building loop in bing.ts. */
function toCandidates(json) {
  const raw = [...(json.pages_with_this_image ?? []), ...(json.related_content ?? [])];
  const out = [];
  const seen = new Set();
  for (const m of raw) {
    const page = m.source;
    const img = m.original || m.cdn_original || m.thumbnail;
    if (!page || !img) continue;
    if (!/^https?:\/\//i.test(page)) continue;
    if (hostOf(page).endsWith("bing.com")) continue;
    if (seen.has(page)) continue;
    seen.add(page);
    out.push({ url: page, imageUrl: img, title: m.title?.trim() || hostOf(page), source: hostOf(page) });
  }
  return out;
}

const fixture = {
  pages_with_this_image: [
    {
      title: "Danny DeVito | Monmouth Timeline",
      link: "https://www.bing.com/images/search?view=detailv2&FORM=OIIRPO&id=43CFD8DC",
      thumbnail: "https://tse2.mm.bing.net/th/id/OIP.eCTFRN?r=0&pid=Api",
      source: "https://monmouthtimeline.org/timeline/danny-devito/",
      original: "https://monmouthtimeline.org/wp-content/uploads/1944/11/FREE-Devito.jpg",
    },
    {
      title: "Danny DeVito - IMDb",
      link: "https://www.bing.com/images/search?view=detailv2&id=0594",
      source: "https://www.imdb.com/name/nm0000362/",
      original: "https://m.media-amazon.com/images/M/devito.jpg",
    },
    // Duplicate source page — must collapse to one candidate.
    {
      title: "Danny DeVito - IMDb (dupe)",
      source: "https://www.imdb.com/name/nm0000362/",
      original: "https://m.media-amazon.com/images/M/other.jpg",
    },
    // No source page: only a bing redirect. Must be dropped, never passed on.
    {
      title: "orphan",
      link: "https://www.bing.com/images/search?view=detailv2&id=XYZ",
      thumbnail: "https://tse1.mm.bing.net/th/id/OIP.orphan?pid=Api",
    },
    // Source that is itself bing.com — dropped.
    {
      title: "self-referential",
      source: "https://www.bing.com/images/search?q=danny",
      original: "https://tse1.mm.bing.net/th/id/OIP.self?pid=Api",
    },
    // Has a source but no image of any kind — dropped.
    { title: "no image", source: "https://example.com/page" },
  ],
  related_content: [
    {
      title: "Danny DeVito | Fandom",
      link: "https://www.bing.com/images/search?view=detailv2&id=F1B6",
      source: "https://warnerbros.fandom.com/wiki/Danny_DeVito",
      cdn_original: "https://static.wikia.nocookie.net/devito.jpg",
    },
  ],
};

const got = toCandidates(fixture);

// The core inversion: real pages, never a bing.com redirect.
assert.equal(got.length, 3, "3 usable pages survive the filters");
assert.ok(
  got.every((c) => !c.url.includes("bing.com")),
  "no bing.com redirect may reach the docket",
);
assert.deepEqual(
  got.map((c) => c.source),
  ["monmouthtimeline.org", "imdb.com", "warnerbros.fandom.com"],
  "url comes from `source`, not `link`",
);

// Dedupe is by source page, not by image.
assert.equal(got.filter((c) => c.source === "imdb.com").length, 1, "duplicate source page collapses");

// cdn_original is an accepted image fallback.
assert.equal(got[2].imageUrl, "https://static.wikia.nocookie.net/devito.jpg");

// A row with no usable page or no image contributes nothing.
assert.ok(!got.some((c) => c.title === "orphan"), "redirect-only row dropped");
assert.ok(!got.some((c) => c.url === "https://example.com/page"), "image-less row dropped");

// Bing ships OFF. Its results are empty in-app because the probe URL we give
// it is not publicly fetchable, so the flag must default to disabled.
const configured = (env) => {
  if ((env.ENABLE_BING || "").toLowerCase() !== "true") return false;
  return (env.SERPAPI_API_KEY || "").length > 0;
};
assert.equal(configured({ SERPAPI_API_KEY: "k" }), false, "OFF by default: probe delivery is unsolved");
assert.equal(configured({ SERPAPI_API_KEY: "k", ENABLE_BING: "false" }), false, "explicit false stays off");
assert.equal(configured({ SERPAPI_API_KEY: "k", ENABLE_BING: "true" }), true, "opt-in turns it on");
assert.equal(configured({ SERPAPI_API_KEY: "k", ENABLE_BING: "TRUE" }), true, "case-insensitive");
assert.equal(configured({ ENABLE_BING: "true" }), false, "no key means not configured");

console.log("bing provider schema checks: OK");
console.log("bing feature-flag checks: OK");
