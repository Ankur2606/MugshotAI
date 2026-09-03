/**
 * End-to-end check of the chain half of the pipeline.
 *
 * Requires the app running on :3000, a Hardhat node on :8545, and
 * EvidenceRegistry deployed (npm run chain:node, then npm run chain:deploy).
 *
 *   node scripts/verify-chain.mjs
 *
 * Step 4 is the important one: the same data with its keys in a different
 * order must produce the same digest, or re-verification is not reproducible.
 */

const BASE = process.env.FACECHAIN_URL || "http://localhost:3000";

const nonce = Math.floor(Math.random() * 1e9).toString(16).padStart(8, "0");
const B = {
  v: 1,
  probeImageSha256: "0x" + nonce.repeat(8),
  probeDescriptorSha256: "0x" + "cd".repeat(32),
  matchUrl: "https://www.instagram.com/p/EXAMPLE/",
  matchSource: "instagram.com",
  matchTitle: "Example post",
  matchImageSha256: "0x" + "ef".repeat(32),
  similarityBp: 7314,
  encoder: "human/blazeface+facemesh+faceres",
  provider: "serpapi:google_lens",
  capturedAt: Math.floor(Date.now() / 1000),
};
const post = async (p, body) => {
  const r = await fetch(`${BASE}/api/${p}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

console.log("1. ANCHOR");
const a = await post("anchor", { bundle: B });
console.log("   status", a.status, "| digest", a.json.digest);
console.log("   tx", a.json.txHash, "| block", a.json.blockNumber, "| gas", a.json.gasUsed);
if (a.status !== 200) { console.log("   ERROR:", a.json.error); process.exitCode = 1; }

console.log("\n2. VERIFY (untouched bundle)");
const v1 = await post("verify", { bundle: B });
console.log("   onChain:", v1.json.onChain, "| digest matches:", v1.json.digest === a.json.digest);
console.log("   ", v1.json.verdict);

console.log("\n3. VERIFY (one field altered: similarityBp 7314 -> 7313)");
const v2 = await post("verify", { bundle: { ...B, similarityBp: 7313 } });
console.log("   onChain:", v2.json.onChain, "| digest", v2.json.digest);
console.log("   ", v2.json.verdict);

console.log("\n4. VERIFY (key order shuffled, same data)");
const shuffled = Object.fromEntries(Object.entries(B).reverse());
const v3 = await post("verify", { bundle: shuffled });
console.log("   onChain:", v3.json.onChain, "| digest identical to sealed:", v3.json.digest === a.json.digest);

console.log("\n5. RE-ANCHOR same bundle (replay must be refused)");
const a2 = await post("anchor", { bundle: B });
console.log("   status", a2.status, "|", a2.json.error);

const pass = a.status===200 && v1.json.onChain===true && v2.json.onChain===false && v3.json.onChain===true && a2.status===409;
console.log("\n" + (pass ? "ALL CHAIN CHECKS PASSED" : "SOME CHECKS FAILED"));
// exitCode rather than exit(): Node 25 on Windows trips a libuv assertion
// when exit() runs while fetch keep-alive handles are still closing.
process.exitCode = pass ? 0 : 1;
