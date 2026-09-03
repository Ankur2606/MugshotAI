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

## 6. Ethereum Sepolia Testnet (Public Chain Anchor)

For a public, tamper-evident Ethereum record with live block explorer verification on [sepolia.etherscan.io](https://sepolia.etherscan.io/).

### A. Get a Free Throwaway Testnet Account
1. Open your browser wallet (e.g. MetaMask, Rabby, or Coinbase Wallet).
2. Create a new account dedicated solely for testnets (e.g. "Dev Testnet").
3. Export its private key (in MetaMask: Account Details → Show Private Key). **Never use an account holding real funds.**

### B. Fund with Free SepoliaETH
Sepolia is 100% free. Fund your address using any of these public faucets (0.01 - 0.05 SepoliaETH is more than enough for hundreds of anchors):
- **Google Cloud Web3 Faucet** (no login or fast with Google account): https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- **Sepolia PoW Faucet** (instant mining in browser): https://sepolia-faucet.pk910.de/
- **Alchemy Sepolia Faucet**: https://www.alchemy.com/faucets/ethereum-sepolia
- **Chainlink Sepolia Faucet**: https://faucets.chain.link/sepolia

### C. Configure `.env.local`
```bash
CHAIN_TARGET=sepolia
DEPLOYER_PRIVATE_KEY=0xYOUR_THROWAWAY_PRIVATE_KEY
# SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com  # optional, public default works out of the box
```

### D. Deploy EvidenceRegistry to Sepolia
```bash
npm run chain:deploy:sepolia
```
This deploys `EvidenceRegistry.sol` to Sepolia and automatically records the deployed contract address into `src/lib/contract/deployments.json`.

### E. Run the App
```bash
npm run dev
```
Open http://localhost:3000. The bench-status card will display **Ethereum Sepolia (Chain 11155111)**. When a match is found and sealed in Station IV, the transaction receipt provides a direct link to view the transaction and contract on **Sepolia Etherscan**!

---

## 7. Optional: Polygon Amoy Testnet

For Polygon Amoy (Chain ID 80002):
1. Fund a throwaway address from https://faucet.polygon.technology/ (0.2 POL).
2. Set in `.env.local`:
   ```bash
   CHAIN_TARGET=amoy
   DEPLOYER_PRIVATE_KEY=0x...
   ```
3. Deploy:
   ```bash
   npm run chain:deploy:amoy
   ```

---

## 8. Direct CLI On-Chain Verification

To verify contract state and evidence digests on-chain directly via JSON-RPC (without running the browser or Next.js):

```bash
npm run verify:direct
```
Or specify a specific target:
```bash
CHAIN_TARGET=sepolia npm run verify:direct
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `chain:node` fails, port 8545 already in use | Another node is running. Stop it (or find the process holding 8545) and start again. |
| Seal station says "No registry deployed" | The contract is not deployed to the active target. Run `npm run chain:deploy` (or `npm run chain:deploy:sepolia` for Sepolia). |
| `chain:deploy:sepolia` fails with insufficient funds | The account has 0 SepoliaETH. Request free funds from [Google Cloud Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de/). |
| Trace station says search is not configured | `SERPAPI_API_KEY` is missing from `.env.local`, or the dev server was not restarted after adding it. |
| SerpApi returns "Invalid API key" | The key was copied wrong or from the wrong page. Re-copy it from https://serpapi.com/manage-api-key. |
| Probe image rejected as over 500 KB | Recapture. The app downscales captures itself; only very large uploads hit this limit. |
| Camera not working | The browser blocked webcam permission — allow it in the address bar, or use photo upload instead. |
| Models load slowly on first visit | About 13 MB of weights come from localhost on the first load. They are cached after that. |

## 8. Recording the demo

A flow that shows every claim the app makes: face scan → trace → adjudication → seal → re-verify (found) → flip the tamper toggle → re-verify fails. Use a photo of a well-indexed public figure so Google Lens returns a reliable hit. Add `?gate=6000` to the URL if you want the intro gate on screen long enough to see.
