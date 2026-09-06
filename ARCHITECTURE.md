# Facechain: Technical Architecture & System Design

> **Deep-Dive Technical Specification**  
> A detailed analysis of the trust boundaries, cryptographic mechanics, computer vision pipelines, and smart contract architecture powering Facechain. Built for **Hackers House Goa 2026 Shortlisting Task 3**.

---

## Table of Contents
1. [System Topology & The 3 Trust Boundaries](#1-system-topology--the-3-trust-boundaries)
2. [Data Flow Pipeline (Sequence Architecture)](#2-data-flow-pipeline-sequence-architecture)
3. [Station I — Specimen (Client-Side Biometrics)](#3-station-i--specimen-client-side-biometrics)
4. [Station II — Trace (Server-Side Provider Adapter)](#4-station-ii--trace-server-side-provider-adapter)
5. [Station III — Adjudication (Client-Side Re-Encoding & Scoring)](#5-station-iii--adjudication-client-side-re-encoding--scoring)
6. [Station IV — Seal & Verify (Smart Contract & Storage)](#6-station-iv--seal--verify-smart-contract--storage)
7. [The Canonical Evidence Bundle & Serialization](#7-the-canonical-evidence-bundle--serialization)
8. [Dual Verification Architecture (API vs Direct RPC)](#8-dual-verification-architecture-api-vs-direct-rpc)
9. [Security, Privacy & GDPR Model](#9-security-privacy--gdpr-model)
10. [Known Architectural Constraints](#10-known-architectural-constraints)

---

## 1. System Topology & The 3 Trust Boundaries

Facechain distributes compute across three isolated trust boundaries to balance privacy, security, and immutability:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ 1. CLIENT BROWSER (Zero-Trust Privacy Perimeter)                               │
│                                                                                │
│  • Local webcam capture / photo ingestion                                      │
│  • Local @vladmandic/human engine (WebGL / TFJS)                               │
│  • BlazeFace + FaceMesh (468 landmarks) + FaceRes (1024-d descriptor)          │
│  • Flip Test-Time Augmentation (TTA)                                           │
│  • Candidate face re-encoding & Cosine Similarity adjudication                 │
│  • Raw photos and biometric vectors NEVER leave this perimeter                 │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                         Downscaled Probe JPEG (HTTP POST)
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 2. NEXT.JS SERVER (Investigative & Proxy Boundary)                             │
│                                                                                │
│  • Keeps API keys (SerpApi / FaceCheck) confidential                           │
│  • /api/search: Queries Google Lens via SerpApi, filters social media hosts    │
│  • /api/proxy: Bypasses CDN CORS / anti-hotlink protections, streams bytes,    │
│    and calculates authoritative SHA-256 hash                                   │
│  • /api/anchor & /api/verify: Interfaces with Viem client & RPC                │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                      32-Byte Keccak-256 Digest (anchor tx)
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 3. BLOCKCHAIN LEDGER (Immutable Verification Anchor)                           │
│                                                                                │
│  • Solidity 0.8.24 Smart Contract (EvidenceRegistry.sol)                       │
│  • Deployed to Ethereum Sepolia, Polygon Amoy, or Local Hardhat               │
│  • Stores 32-byte digest, submitter, similarityBp, and block timestamp         │
│  • Replay refusal (revert AlreadyAnchored)                                     │
│  • Zero images or biometric vectors stored on-chain                            │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Pipeline (Sequence Architecture)

The following sequence illustrates the complete lifecycle from initial photon capture to on-chain sealing and re-verification:

```
Operator           Browser Client               Next.js Server            Search Engine            Blockchain
   │                     │                            │                         │                      │
   │ 1. Capture Face     │                            │                         │                      │
   ├────────────────────▶│                            │                         │                      │
   │                     │ 2. BlazeFace + Mesh        │                         │                      │
   │                     │    + FaceRes (1024-d)      │                         │                      │
   │                     │    + Flip TTA              │                         │                      │
   │                     │                            │                         │                      │
   │ 3. Click "Trace"    │                            │                         │                      │
   ├────────────────────▶│ 4. POST downscaled JPEG    │                         │                      │
   │                     ├───────────────────────────▶│ 5. Query Google Lens    │                      │
   │                     │                            ├────────────────────────▶│                      │
   │                     │                            │ 6. Candidate leads      │                      │
   │                     │                            │◀────────────────────────┤                      │
   │                     │ 7. Return 24 candidates    │                         │                      │
   │                     │◀───────────────────────────┤                         │                      │
   │                     │                            │                         │                      │
   │                     │ 8. Fetch candidate image   │                         │                      │
   │                     ├───────────────────────────▶│ 9. Fetch with UA/Referer│                      │
   │                     │                            ├───────────────┐         │                      │
   │                     │                            │ Compute SHA-256         │                      │
   │                     │                            │◀──────────────┘         │                      │
   │                     │ 10. Data URL + SHA-256     │                         │                      │
   │                     │◀───────────────────────────┤                         │                      │
   │                     │                            │                         │                      │
   │                     │ 11. Re-encode face (Same   │                         │                      │
   │                     │     Human instance)        │                         │                      │
   │                     │ 12. Cosine Similarity      │                         │                      │
   │                     │ 13. Quality gate check     │                         │                      │
   │                     │ 14. Assemble Canonical JSON│                         │                      │
   │                     │                            │                         │                      │
   │ 15. Click "Seal"    │                            │                         │                      │
   ├────────────────────▶│ 16. POST bundle            │                         │                      │
   │                     ├───────────────────────────▶│ 17. keccak256(canonical)                       │
   │                     │                            │ 18. anchor(digest, bp, url)                    │
   │                     │                            ├───────────────────────────────────────────────▶│
   │                     │                            │ 19. Tx mined in block (Anchored event)         │
   │                     │ 20. On-chain receipt       │◀───────────────────────────────────────────────┤
   │                     │◀───────────────────────────┤                         │                      │
   │                     │                            │                         │                      │
   │ 21. Re-Verify       │                            │                         │                      │
   ├────────────────────▶│ 22. POST checkBundle       │                         │                      │
   │                     ├───────────────────────────▶│ 23. verify(digest)      │                      │
   │                     │                            ├───────────────────────────────────────────────▶│
   │                     │ 24. INTACT / NOT ON CHAIN  │◀───────────────────────────────────────────────┤
   │◀────────────────────┼────────────────────────────┤                         │                      │
```

---

## 3. Station I — Specimen (Client-Side Biometrics)

Implemented in `src/components/Specimen.tsx` and `src/lib/human-client.ts`.

### 3.1 Local Weight Serving
Model weights (~13 MB) are served from `public/models/`. On first visit, the browser loads model shards via WebGL and permanently caches them in browser IndexedDB storage.
- **Zero Third-Party CDNs**: Neither Google Cloud nor external CDNs receive network requests when the model boots.
- **Lazy Singleton**: A single instance of `@vladmandic/human` is instantiated and shared across the entire user session, eliminating memory leaks.

### 3.2 Detection, Mesh & 1024-d Descriptor Pipeline
1. **BlazeFace Detector**: Configured with rotation compensation (`rotation: true`) and multi-person support (`maxDetected: 8`) — up to 8 faces detected and encoded per image.
2. **FaceMesh**: Evaluates 468 3D landmarks for real-time mesh rendering and calculates 3D iris orientation.
3. **FaceRes Feature Extractor**: Generates a **1024-dimensional normalized float embedding vector**.
4. **Anti-Spoof & Liveness**: Dual neural network heads produce confidence scores (`real: 0..1`, `live: 0..1`) to prevent static photograph replay attacks.
5. **Multi-Face UI**: `readAllFaces()` returns all detected faces sorted by confidence. The Specimen station shows "N Faces Discovered" with individual `Person 1 (92%)` / `Person 2 (87%)` selector buttons plus an "All Faces + Scene (Dual-Path)" option.

### 3.3 Flip Test-Time Augmentation (TTA)
In `readFaceStable()`:
$$\mathbf{e}_{\text{stable}} = \frac{\mathbf{e}_{\text{original}} + \mathbf{e}_{\text{mirrored}}}{2}$$
The frame is mirrored horizontally using an offscreen `<canvas>` context (`scale(-1, 1)`). Averaging the original descriptor with its mirror cancels out unilateral shadow gradients and head-tilt bias, generating a repeatable probe descriptor.

---

## 4. Station II — Trace (Server-Side Provider Adapter)

Implemented in `src/app/api/search/route.ts` and `src/lib/providers/`.

### 4.1 Extensible Provider Architecture
Search backends implement the `SearchProvider` interface (`types.ts`):

```typescript
export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  configured(): boolean;
  search(image: Uint8Array, mime: string, probes?: ProbeBox[]): Promise<SearchOutcome>;
}
```

`ProbeBox` carries `boxRaw` — the normalized (0..1) face bounding box from the neural detector. The aggregator uses `boxRaw` scaled by actual image dimensions to crop individual face regions via `sharp`, sending each person's face crop as a separate visual search query.

The registry in `index.ts` dynamically resolves the provider specified by `SEARCH_PROVIDER`:
- **`MultiEngineAggregator` (Default)**: Orchestrates all four search paths concurrently.
- **`SerpApiLens`**: Sends the probe image to `serpapi.com/image` to obtain an `image_id`, then queries Google Lens (`engine=google_lens`).
- **`SerpApiYandex`**: Queries Yandex Images reverse search via SerpApi.

### 4.2 Quad-Path Aggregator Architecture

`src/lib/providers/aggregator.ts` — `MultiEngineAggregator`:

**Path A — Scene Context (Priority 1)**
- Sends the full probe image to both Google Lens and Yandex Images
- Captures global scene, setting, background, and all persons collectively
- Returns `probeCategory: "scene"`

**Path B — Per-Person Neural Face Crops (Priority 2)**
- For each face detected by `readAllFaces()` (up to 8):
  - Extracts face crop using `boxRaw` normalized coordinates × image dimensions
  - Applies 15% natural padding (no hardcoded multipliers)
  - Sends crop to Yandex + Lens concurrently
  - Returns `probeCategory: "face_0"`, `"face_1"`, `"face_2"` etc.
- Operator sees filter tabs: `Person 1 | Person 2 | Person 3`

**E-Commerce & Apparel Noise Filtering**
- Proactively suppresses shopping / apparel catalogue results (Zara, ASOS, H&M, SHEIN, `/products/`, `/shop/`) that visual search engines typically return when focusing on clothing.
- Applied strictly to generic websites; social platform profiles and posts are always preserved.

**Assembly Order & Fair Group Representation**
```
Scene[:16] → Person 1[:5] → Person 2[:5] → Person 3[:5] → fill remaining slots
```
Total cap: 28 high-priority candidates dispatched to the client adjudication pool.

### 4.3 Social Media Host Prioritization
Candidates are parsed using `hostOf(url)` and matched against verified social networks:
`instagram.com`, `x.com`, `twitter.com`, `facebook.com`, `linkedin.com`, `tiktok.com`, `youtube.com`, `reddit.com`, `threads.net`, `pinterest.com`, `github.com`, etc.

Social hits are prioritized to the front of each candidate bucket before scoring.

---

## 5. Station III — Adjudication & Cyber Intelligence (Client-Side Re-Encoding & Scoring)

Implemented in `src/components/Docket.tsx`, `src/app/api/proxy/route.ts`, and `src/components/CyberIntelFootprint.tsx`.

### 5.1 Image Proxying & Authoritative Hashing
Browsers cannot directly load external CDN images into a `<canvas>` due to Cross-Origin Resource Sharing (CORS) security restrictions ("canvas taint").
`/api/proxy` addresses this:
1. **Two-Pass Fetch**: Requests the image with a Chrome User-Agent. If blocked (HTTP 403), it retries using the target image's origin as the `Referer` header.
2. **Authoritative Hash**: The server calculates `sha256Bytes(imageBuffer)` on the raw downloaded bytes before converting them to a Base64 data URL.
3. **Canvas Untainting**: Handing back a data URL allows the browser to draw the image onto a `<canvas>` and extract pixel tensors without browser security errors.

### 5.2 Quality Gating
Low-resolution crops drift toward the mean face of the training distribution, which artificially inflates cosine similarity and creates false positives.
`passesQualityGate()` enforces:
- `min(box.width, box.height) >= 48px`
- `detector.score >= 0.45`
Candidates failing these criteria are marked as skipped with clear diagnostic reasons.

### 5.3 Mathematical Cosine Similarity (Basis Points)
Cosine similarity between probe $\mathbf{u}$ and candidate $\mathbf{v}$:
$$\text{Sim}(\mathbf{u}, \mathbf{v}) = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}$$
$$\text{similarityBp} = \max\left(0, \min\left(10000, \text{round}\left(\text{Sim}(\mathbf{u}, \mathbf{v}) \times 10000\right)\right)\right)$$

Integer basis points eliminate floating-point non-determinism across devices.

### 5.4 Discovered Evidence 3D Carousel
An interactive horizontal carousel (`src/components/CandidateCarousel.tsx`) displays all adjudicated matches:
- **Fair Multi-Person Interleaving**: When viewing "All" candidates, the carousel algorithm ranks the #1 match of Scene Context, Person 1, Person 2, and Person 3 consecutively before displaying secondary results, guaranteeing balanced representation in group photos.
- **Visual Confidence Tiers**: Color-coded borders indicate whether candidate similarity surpasses the configured operator threshold dial (`thresholdBp`).

### 5.5 Cyber Intelligence // Deep Identity & 1-Hop Bio-Hub Radar
Implemented in `src/components/CyberIntelFootprint.tsx`, `src/app/api/intel/route.ts`, and `src/lib/page-crawler.ts`:
- **Dual-Algorithm Identity Extraction**:
  - *Algo 1 (Social Posts)*: Parses post permalinks to identify the publisher (`/posts/{author-slug}_...`), normalizes subdomains (`ca.linkedin.com` $\rightarrow$ canonical `www.linkedin.com`), and scans DOM/hydration data for commenters and tagged subjects (`bhavya-pratap-singh-tomar`, `jason-costa-6bab0590`, `natasha-giuffre`).
  - *Algo 2 (Direct Profiles & Media)*: Directly resolves profile subjects (`Henry Knight`, `Jason Costa`) and clean video sources. Queries YouTube oEmbed to resolve video titles and official creator channels (`@USCMooreSchool`), while suppressing internal asset traffic (`/s/...`, `/opensearch`, `/ads`).
- **Recursive 1-Hop Bio-Hub Traversal**: Automatically follows Linktree, Beacons, Bento, and Devfolio links 1 hop deep, parsing underlying portfolios to build a unified cross-platform identity map.
- **Group Photo Multi-Person Sweeping**: Automatically queries the top candidate for every detected person category in parallel, providing tabbed views for `Scene Context`, `Person 1`, `Person 2`, and `Person 3`.
- **Strict Cryptographic Perimeter**: Intelligence leads remain strictly off-chain as UI telemetry; the immutable on-chain evidence bundle and Keccak-256 seal remain solely derived from the verified face match.

---

## 6. Station IV — Seal & Verify (Smart Contract & Storage)

Implemented in `chain/contracts/EvidenceRegistry.sol`, `src/lib/chain.ts`, and `src/app/api/anchor/route.ts`.

### 6.1 Smart Contract Mechanics
`EvidenceRegistry.sol` is a minimalist (~70 lines), gas-optimized Solidity 0.8.24 contract:

```solidity
contract EvidenceRegistry {
    struct Record {
        uint64 timestamp;    // block.timestamp
        address submitter;   // msg.sender
        uint32 similarityBp; // 0..10000
    }

    mapping(bytes32 => Record) private _records;
    bytes32[] private _digests;

    event Anchored(
        bytes32 indexed bundleHash,
        address indexed submitter,
        uint64 timestamp,
        uint32 similarityBp,
        string matchUrl
    );

    error AlreadyAnchored(bytes32 bundleHash);
    error SimilarityOutOfRange(uint32 similarityBp);

    function anchor(bytes32 bundleHash, uint32 similarityBp, string calldata matchUrl) external {
        if (_records[bundleHash].timestamp != 0) revert AlreadyAnchored(bundleHash);
        if (similarityBp > 10000) revert SimilarityOutOfRange(similarityBp);

        _records[bundleHash] = Record({
            timestamp: uint64(block.timestamp),
            submitter: msg.sender,
            similarityBp: similarityBp
        });
        _digests.push(bundleHash);

        emit Anchored(bundleHash, msg.sender, uint64(block.timestamp), similarityBp, matchUrl);
    }

    function verify(bytes32 bundleHash)
        external
        view
        returns (bool exists, uint64 timestamp, address submitter, uint32 similarityBp)
    {
        Record memory r = _records[bundleHash];
        return (r.timestamp != 0, r.timestamp, r.submitter, r.similarityBp);
    }
}
```

- **Replay Protection**: Reverts with `AlreadyAnchored` if the hash is already mapped.
- **Append-Only Enumeration**: `_digests[]` maintains a full historical catalog queryable via `total()` and `digestAt(index)`.
- **Event Auditing**: Emits `Anchored` indexed by `bundleHash` and `submitter` for fast off-chain indexers and subgraphs.

---

## 7. The Canonical Evidence Bundle & Serialization

The bundle format in `src/lib/canonical.ts`:

| Field | Type | Description |
|---|:---:|---|
| `v` | `1` | Bundle schema version |
| `probeImageSha256` | `string` | Hex SHA-256 of the captured probe JPEG bytes |
| `probeDescriptorSha256` | `string` | SHA-256 of the fixed-point quantized probe embedding vector |
| `matchUrl` | `string` | Discovered social media / web URL |
| `matchSource` | `string` | Host domain (e.g. `instagram.com`) |
| `matchTitle` | `string` | Web page title reported by search provider |
| `matchImageSha256` | `string` | Authoritative SHA-256 of candidate image bytes |
| `similarityBp` | `number` | Integer similarity score in basis points (0–10000) |
| `encoder` | `string` | Model identifier tag (`human/blazeface+facemesh+faceres`) |
| `provider` | `string` | Backend provider identifier (e.g. `serpapi:google_lens`) |

### Deterministic Serialization (`canonicalJson`)
```typescript
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
```
Keys are sorted lexicographically at all depths, and all optional whitespace is stripped. Two different runtimes (Node.js, Go, Python, Rust) evaluating the same bundle will produce byte-identical strings, yielding the exact same Keccak-256 hash.

---

## 8. Dual Verification Architecture (API vs Direct RPC)

Facechain provides two independent methods to verify records:

### Method A: Browser & Next.js API (`/api/verify`)
- Client sends the JSON bundle to `/api/verify`.
- Server canonicalizes the bundle, re-derives `keccak256(canonicalJson(bundle))`, queries the contract via Viem, and returns structured validation status.
- Includes the interactive **"Alter the bundle first"** toggle for live demonstrations.

### Method B: Direct On-Chain RPC Script (`scripts/verify-direct-chain.mjs`)
- Completely independent of the Next.js server.
- Connects directly to the network's JSON-RPC endpoint via Viem.
- Reads contract deployment addresses from `deployments.json`.
- Queries `total()`, inspects the latest digest via `digestAt()`, and queries `verify()`.
- Runs a live tamper test against `0x000...` to demonstrate contract rejection.

---

## 9. Security, Privacy & GDPR Model

1. **Biometric Data Sovereignty**: Raw photographs and vector embeddings are never written to the server or the blockchain.
2. **GDPR Article 17 ("Right to be Forgotten")**: Because the blockchain holds only a 32-byte one-way Keccak-256 cryptographic digest, no Personally Identifiable Information (PII) is permanently stamped onto the public ledger. If off-chain records are deleted, the on-chain hash reveals nothing about the subject.
3. **No Centralized Biometric Database**: Face vectors exist only in volatile client WebGL GPU memory for the duration of the browser tab.

---

## 10. Known Architectural Constraints

- **Image Matching vs Face Matching**: Google Lens matches entire images (background, clothing, pose). Station III (Adjudication) is specifically designed to eliminate this flaw by re-encoding faces biometrically.
- **Server-Side Signing**: For demo stability and screen recording simplicity, the deployment uses a server-held private key in `.env.local`. A production enterprise iteration would attach an in-browser Web3 provider (e.g. MetaMask / WalletConnect).
- **Network-Level Hotlink Blocks**: Highly restricted hosts (such as private Instagram accounts) block server proxy fetches. These are gracefully marked as skipped rather than crashing the pipeline.
