# Facechain: Video Demo Script & Walkthrough Guide

A complete, director-ready screen recording script and walkthrough for **HH Goa 2026 Shortlisting Task 3: Face Identification & Blockchain Verification**.

---

## Recording Overview & Specifications

- **Target Duration**: 2 minutes 45 seconds (crisp, high-impact, zero fluff).
- **Target Platform**: YouTube (Unlisted), Loom, or Google Drive link.
- **Required Resolution**: 1080p (1920x1080) at 60 FPS or 30 FPS.
- **Audio**: Clear microphone voiceover.
- **Pre-Recording Setup**:
  1. Terminal 1: Next.js dev server (`npm run dev`) on `http://localhost:3000`.
  2. Terminal 2: Ready for running CLI verification (`npm run verify:direct`).
  3. Browser Window: Maximized at `http://localhost:3000`.
  4. Test Specimen: Have a clear portrait photo ready (e.g. `barack_obama.jpg`, `elon_musk.jpg`, or a tested high-profile public figure that Google Lens reliably indexes).

---

## Timed Scene-by-Scene Script

### Scene 1: Introduction & Task 3 Overview
- **Timestamp**: `0:00 - 0:25` (25 seconds)
- **Visual / Screen Action**:
  - Start on the Facechain web console at `http://localhost:3000`.
  - Mouse hovers over the header: **"Facechain // Cryptographic Face Trace & Registry"**.
  - Point out the active status card in the top right showing:
    - Search Backend: `Google Lens (SerpApi)` (Active, green pulse).
    - Network: `Ethereum Sepolia (Chain 11155111)` or `Hardhat Local (Chain 31337)`.
    - Registry: Deployed contract address with live block number ticking.
- **Spoken Voiceover**:
  > *"Hello! This is Facechain, built for HH Goa 2026 Shortlisting Task 3. Our goal is to build an end-to-end pipeline that takes a face scan as input, searches the live web and social media for matching content, and anchors the discovered evidence onto a blockchain as an immutable, tamper-evident record.*
  >
  > *Facechain runs as four stations on a single console. Notice that our face engine runs 100% in the browser with local model weights, our search backend is connected, and our smart contract is live on-chain. Let's run the pipeline end-to-end."*

---

### Scene 2: Station I — Specimen Capture & Local ML Encoding
- **Timestamp**: `0:25 - 0:50` (25 seconds)
- **Visual / Screen Action**:
  - Scroll to **Station I: Specimen**.
  - Show the live webcam or click **"Upload photo"** and select the test portrait.
  - The detector instantly renders a bounding box and the 468-point 3D FaceMesh overlay.
  - The telemetry panel updates with:
    - Detector Confidence: `0.99`
    - Embedding Dimension: `1024-d unit vector`
    - Liveness / Real: `0.94`
    - Flip TTA (Test-Time Augmentation): Active
- **Spoken Voiceover**:
  > *"In Station I, the specimen face is captured. Powered by client-side WebGL and TensorFlow.js, BlazeFace detects the face, FaceMesh tracks 468 three-dimensional facial landmarks, and the FaceRes neural network extracts a 1024-dimensional deep embedding vector.*
  >
  > *To ensure maximum stability, we apply Flip Test-Time Augmentation—averaging the descriptor with its mirrored counterpart to eliminate lighting and pose asymmetry. Crucially, all 13 megabytes of model weights run locally in the browser: zero biometric data or photographs leave the client machine at this stage."*

---

### Scene 3: Station II — Trace & Live Social Web Search
- **Timestamp**: `0:50 - 1:15` (25 seconds)
- **Visual / Screen Action**:
  - Scroll to **Station II: Trace**.
  - Click the **"Run trace"** button.
  - Show the spinner and elapsed timer (`Tracing...`).
  - Candidates populate in the grid below with thumbnails, source hostnames (e.g. `instagram.com`, `x.com`, `wikipedia.org`), and status chips.
  - Point to the counter: `24/24 examined · 18 carried a face`.
  - Point to the **Threshold Dial** set at `54.00%`.
- **Spoken Voiceover**:
  > *"Now we initiate Station II: Trace. The downscaled probe JPEG is dispatched to our live search backend—Google Lens via SerpApi. The search engine crawls the open web and returns candidate pages where this face appears, prioritizing social media platforms like Instagram, X, LinkedIn, and Reddit.*
  >
  > *However, search engines only propose leads—they do not adjudicate identity. In the background, each candidate image is fetched through our server proxy, stripped of CORS restrictions, securely hashed with SHA-256, and sent back to the browser for biometric verification."*

---

### Scene 4: Station III — Adjudication & In-Browser Biometric Scoring
- **Timestamp**: `1:15 - 1:40` (25 seconds)
- **Visual / Screen Action**:
  - Scroll down to **Station III: Adjudication**.
  - Show the **"Match of Record"** card on the left:
    - Matched Title (e.g. public figure Instagram post or profile page).
    - Source URL.
    - Similarity Score highlighted in gold (e.g. `78.42%`).
    - Candidates scored vs rejected count.
  - Expand the disclosure toggle: **"canonical bundle — the exact bytes that get hashed"**.
  - Show the formatted JSON with sorted keys, zero floating-point numbers, and integer basis points.
- **Spoken Voiceover**:
  > *"Station III is what makes Facechain scientifically defensible: Adjudication. The candidate face is re-encoded right here in the browser using the exact same neural network instance that encoded our probe. This ensures both vectors share an identical mathematical coordinate space.*
  >
  > *We enforce strict quality gating: low-resolution crops under 48 pixels are refused to avoid false positives. Then, cosine similarity is computed in Basis Points. Here, our top match clears our calibrated 54% threshold with an outstanding 78.42% similarity!*
  >
  > *This accepted match is serialized into an idempotent Canonical Evidence Bundle. Notice that all keys are alphabetically sorted and floating points are converted to integers, ensuring 100% deterministic reproducibility across platforms."*

---

### Scene 5: Station IV — Blockchain Sealing (Ethereum Sepolia / Hardhat)
- **Timestamp**: `1:40 - 2:05` (25 seconds)
- **Visual / Screen Action**:
  - Scroll to **Station IV: Seal**.
  - Point out the 32-byte Keccak-256 bundle digest.
  - Click the **"Seal to chain"** button.
  - Show the transaction receipt animating in with:
    - Sealed Digest ID (Keccak-256)
    - Transaction Hash (`0x...`)
    - Contract Address
    - Block Number (`#6123456`)
    - Timestamp
  - Click the link: **"Open on Etherscan (Sepolia) ↗"** (or point out the explorer URL).
- **Spoken Voiceover**:
  > *"Now for Station IV: Sealing to the blockchain. We do NOT store heavy images or sensitive biometric embeddings on-chain—doing so would cost thousands of dollars in gas and violate GDPR privacy regulations. Instead, we take the Keccak-256 cryptographic digest of our canonical bundle and commit it to our EvidenceRegistry smart contract.*
  >
  > *I'll click 'Seal to chain'. The transaction is mined, emitting an Anchored event. We receive an immutable on-chain receipt with the transaction hash, block number, and gas used, linked directly to the public block explorer."*

---

### Scene 6: Re-Verification & Live Tamper Demonstration
- **Timestamp**: `2:05 - 2:30` (25 seconds)
- **Visual / Screen Action**:
  - Scroll to the **Re-verification** section in Station IV.
  - Click **"Re-verify against chain"** (with checkbox unchecked).
  - The verification card turns **EMERALD GREEN**: **"INTACT — Digest found on chain. The bundle is byte-for-byte what was sealed."**
  - Now, check the box: **"Alter the bundle first"**.
  - Point out the second hash strip changing: `similarityBp` was tweaked by just 1 basis point (0.01%), causing the Keccak-256 digest to completely diverge.
  - Click **"Re-verify against chain"**.
  - The verification card turns **CRIMSON RED**: **"NOT ON CHAIN — No such digest on chain. This bundle was never sealed, or it has been altered since."**
- **Spoken Voiceover**:
  > *"Now let's prove tamper evidence. In the re-verification module, we hand the bundle back and ask the smart contract if it recognizes this digest. Clicking 'Re-verify' immediately returns INTACT in green—proving byte-for-byte fidelity.*
  >
  > *Now, watch this: I check 'Alter the bundle first'. This alters the similarity score by just a single basis point—from 7842 to 7841. Because of the cryptographic avalanche effect, the Keccak-256 digest changes completely. When we query the contract now... REJECTED in crimson! The blockchain proves beyond any doubt that the record has been tampered with."*

---

### Scene 7: Direct CLI On-Chain RPC Verification & Self-Test Diagnostic
- **Timestamp**: `2:30 - 2:50` (20 seconds)
- **Visual / Screen Action**:
  - Switch briefly to Terminal 2.
  - Run: `npm run verify:direct` (or `CHAIN_TARGET=sepolia npm run verify:direct`).
  - Show the CLI tool connecting directly to the network's JSON-RPC endpoint via Viem, printing the block number, total anchored records, querying `verify()`, and testing tamper detection.
  - Briefly switch to `http://localhost:3000/selftest` showing the 4 public-domain portrait test matrix with all PASS marks.
- **Spoken Voiceover**:
  > *"To demonstrate that verification is completely independent of the frontend, we built a standalone CLI tool that connects directly to the blockchain RPC via Viem. Running 'npm run verify:direct' reads contract storage, validates the latest anchored digest, and verifies tamper detection at the protocol level.*
  >
  > *We also provide an offline /selftest suite that validates the face encoder against baseline public-domain portraits without needing any external API keys."*

---

### Scene 8: Conclusion & Wrap-Up
- **Timestamp**: `2:50 - 3:00` (10 seconds)
- **Visual / Screen Action**:
  - Switch back to the Facechain main console.
  - Show the entire pipeline green and sealed.
  - End on a high note.
- **Spoken Voiceover**:
  > *"From privacy-first on-device face encoding, to live web tracing, in-browser adjudication, and tamper-evident blockchain sealing with verified cryptographic re-verification: the pipeline is 100% complete and fully operational.*
  >
  > *Thank you, and see you at Hackers House Goa 2026!"*

---

## Pre-Recording Checklist

Before you hit "Record", complete this 2-minute checklist:

- [ ] **SerpApi Key Active**: Verify `SERPAPI_API_KEY` is configured in `.env.local`.
- [ ] **Contract Deployed**:
  - For local demo: `npm run chain:node` is running in Terminal A, and `npm run chain:deploy` was run.
  - For public Sepolia demo: `npm run chain:deploy:sepolia` was run and `CHAIN_TARGET=sepolia` is in `.env.local`.
- [ ] **Bench Status Green**: Check the top-right card of http://localhost:3000:
  - Search: Green checkmark (`Google Lens (SerpApi)`).
  - Chain: Green checkmark (`Ethereum Sepolia` or `Hardhat Local`).
  - Registry: Contract address visible.
- [ ] **Test Specimen Image Prepared**: Have a high-quality JPG ready in your downloads folder.
- [ ] **Browser Zoom**: Set browser zoom to 100% or 90% so all four stations fit comfortably during scrolling.
- [ ] **Audio Check**: Do a 5-second mic test to ensure no background fan or echo noise.
