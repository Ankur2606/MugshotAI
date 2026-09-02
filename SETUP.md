# Setup

Built for HH Goa 2026 shortlisting task 3. Follow this page top to bottom and you end with the full pipeline running on localhost against a local Hardhat chain, and optionally anchoring to Polygon Amoy.

## 1. Prerequisites

- Node 20 or newer. Developed on Node 25; Hardhat 2 prints an unsupported-version warning on 25, which is harmless.
- npm (ships with Node).
- A Chromium-based browser or Firefox. A webcam is optional — photo upload works.
- git.

Windows, macOS, and Linux all work. Developed on Windows 11.

## 2. Clone and install

There are two `package.json` files and both need an install. Skipping the second one is the most common setup mistake.

```bash
git clone <your-repo-url>
cd facechain
npm install

cd chain
npm install
cd ..
```

## 3. The one required key — SerpApi (Google Lens)

1. Sign up at https://serpapi.com/users/sign_up. The free plan gives 250 searches/month and asks for no card.
2. After signup, your key is at https://serpapi.com/manage-api-key.
3. Copy the env template and add the key:

```bash
cp .env.example .env.local
```

(On Windows without a POSIX shell: `copy .env.example .env.local`.)

In `.env.local`, put the key in `SERPAPI_API_KEY` and leave `SEARCH_PROVIDER=serpapi`.

Next.js reads environment variables at boot, so restart the dev server after any `.env.local` change.

**Optional alternative — FaceCheck.ID.** A true face search rather than whole-image matching, so it finds social profiles far more reliably. It is paid (credits, purchased with crypto). Get a token at https://facecheck.id/en/Face-Search/API, then set `FACECHECK_API_TOKEN` and `SEARCH_PROVIDER=facecheck`. Setting `FACECHECK_DEMO=true` wires it up without spending credits, but the demo searches only a small slice of the index.

## 4. Start everything

Three terminals (or run the first in the background):

```bash
npm run chain:node       # Hardhat node on 127.0.0.1:8545, chain id 31337 — leave running
```

```bash
npm run chain:deploy     # deploys EvidenceRegistry, writes its address into src/lib/contract/deployments.json
```

```bash
npm run dev              # then open http://localhost:3000
```

The bench-status card at the top right shows the search backend, the chain, and the registry going green.

Note: the loading gate holds while about 13 MB of face models initialize on first load. Adding `?gate=6000` to the URL holds the gate longer, which is useful when screen-recording.

## 5. Verify before trusting it

**Encoder self-test, no API key needed.** Open:

```
http://localhost:3000/selftest
```

Expect PASS, with the same-person pair scoring 57.71 against a best different-person score of 44.88.

**Chain checks.** With the node running and the contract deployed:

```bash
node scripts/verify-chain.mjs
```

(or `npm run verify:chain` — same thing). It runs five checks: anchor, verify untouched, verify with one field altered, verify with keys reordered, and a replay attempt. Expect `ALL CHAIN CHECKS PASSED`.

## 6. Optional: Polygon Amoy

For a public testnet record instead of the local node.

1. Create a throwaway wallet key — never use a real one. In MetaMask: create a new account and export its private key.
2. Fund it at https://faucet.polygon.technology/. 0.2 POL is plenty. Alternatives: https://www.alchemy.com/faucets/polygon-amoy and https://faucet.quicknode.com/polygon/amoy.
3. In `.env.local`:

```bash
CHAIN_TARGET=amoy
DEPLOYER_PRIVATE_KEY=0x...
# AMOY_RPC_URL=...        # optional, defaults to the public Polygon RPC
```

4. Deploy and restart:

```bash
npm run chain:deploy:amoy
```

Restart the dev server. Sealed transactions then link to https://amoy.polygonscan.com.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `chain:node` fails, port 8545 already in use | Another node is running. Stop it (or find the process holding 8545) and start again. |
| Seal station says "No registry deployed" | The contract is not on the running node. Run `npm run chain:deploy` while `chain:node` is up. |
| Trace station says search is not configured | `SERPAPI_API_KEY` is missing from `.env.local`, or the dev server was not restarted after adding it. |
| SerpApi returns "Invalid API key" | The key was copied wrong or from the wrong page. Re-copy it from https://serpapi.com/manage-api-key. |
| Probe image rejected as over 500 KB | Recapture. The app downscales captures itself; only very large uploads hit this limit. |
| Camera not working | The browser blocked webcam permission — allow it in the address bar, or use photo upload instead. |
| `chain:deploy:amoy` fails with insufficient funds | The throwaway key has no POL. Fund it from https://faucet.polygon.technology/. |
| Models load slowly on first visit | About 13 MB of weights come from localhost on the first load. They are cached after that. |

## 8. Recording the demo

A flow that shows every claim the app makes: face scan → trace → adjudication → seal → re-verify (found) → flip the tamper toggle → re-verify fails. Use a photo of a well-indexed public figure so Google Lens returns a reliable hit. Add `?gate=6000` to the URL if you want the intro gate on screen long enough to see.
