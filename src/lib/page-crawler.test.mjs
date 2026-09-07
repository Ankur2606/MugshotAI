// Runnable check for BUG D: only a bare github.com/<handle> account page is a person.
// Run: node --experimental-strip-types src/lib/page-crawler.test.mjs
import assert from "node:assert/strict";
import { githubProfileFrom, classifySocialUrl } from "./page-crawler.ts";

const gh = (s) => githubProfileFrom(new URL(s));

// Accept: bare account pages.
assert.equal(gh("https://github.com/torvalds"), "torvalds");
assert.equal(gh("https://www.github.com/Ankur2606/"), "Ankur2606");
assert.equal(gh("https://github.com/a-b-c"), "a-b-c");

// Reject: repo / deep paths — the noise the owner flagged.
assert.equal(gh("https://github.com/tensorflow/tfjs"), null);
assert.equal(gh("https://github.com/vladmandic/human"), null);
assert.equal(gh("https://github.com/some-org/some-repo/blob/main/README.md"), null);
assert.equal(gh("https://github.com/facebook/react/issues/123"), null);

// Reject: non-profile hosts, reserved words, malformed handles.
assert.equal(gh("https://gist.github.com/someone/abc123"), null);
assert.equal(gh("https://raw.githubusercontent.com/org/repo/main/x.js"), null);
assert.equal(gh("https://someuser.github.io/portfolio"), null);
assert.equal(gh("https://github.com/topics/machine-learning"), null);
assert.equal(gh("https://github.com/orgs"), null);
assert.equal(gh("https://github.com/features"), null);
assert.equal(gh("https://github.com/-leading"), null);
assert.equal(gh("https://github.com/trailing-"), null);
assert.equal(gh("https://github.com/under_score"), null); // GitHub allows no underscores
assert.equal(gh("https://github.com/" + "a".repeat(40)), null);

// classifySocialUrl routes through the same helper.
assert.equal(classifySocialUrl("https://github.com/tensorflow/tfjs"), null);
assert.equal(classifySocialUrl("https://github.com/torvalds").handle, "@torvalds");

// Same bug class on the other platforms: a content URL must not have its
// first path segment reported as somebody's account.
const cls = (u) => classifySocialUrl(u);

// Instagram: profile yes, post/reel/explore no.
assert.equal(cls("https://www.instagram.com/nasa").handle, "@nasa");
assert.equal(cls("https://www.instagram.com/p/CxYzAbC123"), null);
assert.equal(cls("https://www.instagram.com/reel/CxYzAbC123"), null);
assert.equal(cls("https://www.instagram.com/explore/tags/sunset"), null);
assert.equal(cls("https://www.instagram.com/" + "a".repeat(31)), null);

// X: profile and status (the author) yes, everything else no.
assert.equal(cls("https://x.com/jack").handle, "@jack");
assert.equal(cls("https://x.com/jack/status/20").handle, "@jack");
assert.equal(cls("https://x.com/i/flow/login"), null);
assert.equal(cls("https://x.com/hashtag/foo"), null);

console.log("page-crawler github profile checks: OK");
console.log("page-crawler instagram/x depth checks: OK");
