# Facechain

Scan a face, find where it appears on the public web, and seal the finding to a
blockchain as a tamper-evident record.

```
face scan  ─▶  web / social search  ─▶  re-encode & score  ─▶  keccak256  ─▶  on-chain anchor  ─▶  re-verify
```

**[SETUP.md](SETUP.md)** — get running in ten minutes ·
**[ARCHITECTURE.md](ARCHITECTURE.md)** — how it works and why

Built for HH Goa 2026 shortlisting task 3.

![Pipeline — animated](docs/pipeline.svg)

The diagram is plain SVG with SMIL timing — the amber pulse travelling the
pipeline is the probe moving between trust boundaries. The console itself:

![The console](docs/console.png)

---

## What it actually does

The pipeline runs as four stations on a single page.

**I — Specimen.** A face is captured from the webcam or an uploaded photo.
[`@vladmandic/human`](https://github.com/vladmandic/human) detects it and produces a
1024-dimension descriptor, plus anti-spoof and liveness scores. This all happens in the
browser; the model weights are served from `public/models`, so nothing is sent to a CDN
and no face data leaves the machine at this stage.

**II — Trace.** The captured JPEG goes to a live image-search backend (Google Lens via
SerpApi by default). Whatever pages it returns are treated as *leads*, not matches.

**III — Adjudication.** This is the step that makes the search defensible. Every
candidate image is fetched server-side, hashed, handed back to the browser, and run
through **the same encoder** that produced the probe descriptor. Cosine similarity
decides the outcome. Candidates that fail stay visible with their scores, so the
decision can be inspected rather than taken on faith.

**IV — Seal.** The accepted match is folded into a canonical evidence bundle. The
keccak256 digest of that bundle is written to an `EvidenceRegistry` contract. Re-verify
re-hashes the bundle and asks the chain whether it has seen that digest. Alter one
field first and it will not be found — that is the tamper-evidence, demonstrated rather
than asserted.

Only the digest, the similarity score, and the matched URL go on chain. The probe image
and the descriptor never do.

---

## Running it

Full instructions — installs, the SerpApi key, verification, Amoy, troubleshooting —
are in [SETUP.md](SETUP.md). Once installed and configured, it comes down to:

```bash
npm run chain:node      # Hardhat node on 127.0.0.1:8545, chain id 31337
npm run chain:deploy    # deploys EvidenceRegistry, writes its address into src/lib/contract/
npm run dev             # http://localhost:3000
```

---

## Which blockchain

**Polygon Amoy** (chain id 80002) for a real public record, and a **local Hardhat node**
(chain id 31337) as the default so the pipeline runs with zero external setup. Same
contract, same code path — one environment variable switches between them.

To use Amoy: fund a throwaway key from the [Polygon faucet](https://faucet.polygon.technology/),
then

```bash
# .env.local
CHAIN_TARGET=amoy
DEPLOYER_PRIVATE_KEY=0x...
```

```bash
npm run chain:deploy:amoy
```

Sealed transactions then link to `amoy.polygonscan.com`.

### The contract

[`chain/contracts/EvidenceRegistry.sol`](chain/contracts/EvidenceRegistry.sol) — about 70
lines. `anchor(bytes32 bundleHash, uint32 similarityBp, string matchUrl)` records a
digest and reverts if that exact digest is already present, so replaying an identical
bundle is visible rather than silent. `verify(bytes32)` returns whether a digest exists,
when it was anchored, and by whom.

### Why the bundle is canonicalized

The digest has to be reproducible on a different machine months later, so the bundle is
serialized with keys sorted at every depth and **contains no floating-point numbers** —
similarity is stored as an integer in basis points. A float that round-trips through
JSON on another runtime can serialize differently and would silently break
re-verification. See [`src/lib/canonical.ts`](src/lib/canonical.ts).

---

## Verifying it works

### Face engine, no API key required

```
http://localhost:3000/selftest
```

Runs four public-domain portraits (two of the same person) through the proxy and the
encoder, and checks that same-person pairs outscore every different-person pair.

Measured on this build:

| pair | expected | similarity |
|---|---|---|
| obama-a ↔ obama-b | same person | **57.71** |
| merkel ↔ watson | different | 44.88 |
| obama-a ↔ watson | different | 41.46 |
| obama-a ↔ merkel | different | 40.90 |
| obama-b ↔ watson | different | 38.91 |
| obama-b ↔ merkel | different | 30.66 |

The default accept threshold is **54**, which sits in the gap between those two groups.
It is adjustable from the console.

![Encoder self-test](docs/selftest.png)

### Chain half

With the node running and the contract deployed:

```bash
node scripts/verify-chain.mjs
```

Anchors a bundle, verifies it, verifies a bundle with one field altered, verifies the
same bundle with its keys reordered, and attempts a replay. Expected output:

```
1. ANCHOR                                       status 200
2. VERIFY (untouched)                           onChain: true
3. VERIFY (similarityBp 7314 -> 7313)           onChain: false
4. VERIFY (key order shuffled, same data)       digest identical to sealed: true
5. RE-ANCHOR same bundle                        status 409, refused
ALL CHAIN CHECKS PASSED
```

Step 4 is the one that matters most: it proves the canonicalization is order-independent,
so re-verification does not depend on how the JSON happened to be written.

---

## Layout

```
src/
  app/
    page.tsx                 the console (client-only)
    selftest/                encoder diagnostic
    api/
      search/                probe -> search backend -> candidate pages
      proxy/                 fetch a candidate image + hash it
      anchor/                hash the bundle, write the digest on chain
      verify/                re-hash and look the digest up
      status/                which halves of the pipeline are live
  lib/
    human-client.ts          the browser face engine, one shared instance
    canonical.ts             canonical JSON, keccak256, cosine similarity
    chain.ts                 viem clients, network selection
    providers/               search backends behind one interface
  components/                the four stations
chain/                       Hardhat project: contract, deploy script
public/models/               face model weights, served locally
```

### Swapping the search backend

`src/lib/providers/` holds one interface and two implementations. A second backend,
[FaceCheck.ID](https://facecheck.id/en/Face-Search/API), is included: it is a true
face-embedding search rather than whole-image similarity, so it finds social profiles
far more reliably. It is paid (credits, crypto only), which is why Lens is the default.

```bash
# .env.local
SEARCH_PROVIDER=facecheck
FACECHECK_API_TOKEN=...
```

Adding a third backend means implementing `search(image, mime) → Candidate[]` and
registering it in `providers/index.ts`.

---

## Known limitations

**Google Lens is not a face search.** It matches whole images, so its candidates are
lookalikes, stock photos, and pages that reuse the same picture. It reliably finds
well-indexed public figures and often finds nothing for a private individual. This is
the honest weak point of the free path, and it is exactly why the re-encoding step in
Station III exists — the search proposes, the encoder decides. FaceCheck.ID is wired in
for anyone willing to pay for real face search.

**Recognition accuracy.** The 1024-d `faceres` encoder is good, not state of the art.
Expect it to struggle with heavy occlusion, extreme pose, low light, and large age gaps.
The similarity threshold is a tunable judgement call, not a fact — which is why the
console exposes it and shows every rejected candidate's score.

**The chain proves integrity, not truth.** An anchored digest proves the bundle has not
changed since it was sealed. It does not prove the match was correct. Those are
different claims and the UI is careful not to conflate them.

**Server-side signing.** The app signs anchoring transactions with a key from
`.env.local` rather than a browser wallet. That is deliberate for a demo — one less
thing to fail on camera — but it means the "submitter" recorded on chain is the server,
not the operator. A production version would connect a wallet.

**Candidate image fetching.** Some hosts (Instagram in particular) block server-side
image fetches. Those candidates are marked skipped with the reason rather than silently
dropped.

**Anti-spoof is advisory.** The liveness and anti-spoof scores are shown because they
are useful signal, but nothing in the pipeline gates on them.

**Hardhat and Node 25.** Hardhat 2 prints an unsupported-version warning on Node 25. It
compiles and deploys correctly regardless.

---

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Motion ·
[@vladmandic/human](https://github.com/vladmandic/human) (TensorFlow.js) ·
viem · Hardhat · Solidity 0.8.24

## License

MIT
