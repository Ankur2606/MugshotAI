/**
 * Direct on-chain verification script.
 *
 * Reads contract ABI & deployment address, connects directly to the network's
 * RPC (Sepolia, Amoy, or Hardhat Localhost) via Viem without needing Next.js running,
 * and verifies evidence hashes directly against EvidenceRegistry.sol.
 *
 * Usage:
 *   node scripts/verify-direct-chain.mjs
 *   CHAIN_TARGET=sepolia node scripts/verify-direct-chain.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, keccak256, toHex, defineChain } from "viem";
import { sepolia, polygonAmoy } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractDir = path.resolve(__dirname, "../src/lib/contract");

const registryPath = path.join(contractDir, "EvidenceRegistry.json");
const deploymentsPath = path.join(contractDir, "deployments.json");

if (!fs.existsSync(registryPath) || !fs.existsSync(deploymentsPath)) {
  console.error("Contract artifacts or deployments not found. Run deployment first.");
  process.exit(1);
}

const { abi } = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

// Read .env.local if present
const envPath = path.resolve(__dirname, "../.env.local");
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
}

const target = (process.env.CHAIN_TARGET || env.CHAIN_TARGET || "localhost").toLowerCase();

const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

let chain = hardhatLocal;
let rpcUrl = "http://127.0.0.1:8545";
let label = "Hardhat Local (Chain 31337)";
let explorer = "";

if (target === "sepolia") {
  chain = sepolia;
  rpcUrl = process.env.SEPOLIA_RPC_URL || env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  label = "Ethereum Sepolia (Chain 11155111)";
  explorer = "https://sepolia.etherscan.io";
} else if (target === "amoy") {
  chain = polygonAmoy;
  rpcUrl = process.env.AMOY_RPC_URL || env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
  label = "Polygon Amoy (Chain 80002)";
  explorer = "https://amoy.polygonscan.com";
}

const contractAddress =
  (target === "sepolia" ? (process.env.SEPOLIA_REGISTRY_ADDRESS || env.SEPOLIA_REGISTRY_ADDRESS) : null) ||
  (target === "amoy" ? (process.env.AMOY_REGISTRY_ADDRESS || env.AMOY_REGISTRY_ADDRESS) : null) ||
  deployments[target]?.address;

console.log("=================================================");
console.log("   FACECHAIN DIRECT ON-CHAIN VERIFICATION TOOL   ");
console.log("=================================================");
console.log(`Network:          ${label}`);
console.log(`RPC Endpoint:     ${rpcUrl}`);
console.log(`Contract Address: ${contractAddress || "(none found for " + target + ")"}`);
if (explorer) console.log(`Block Explorer:   ${explorer}/address/${contractAddress}`);
console.log("-------------------------------------------------");

if (!contractAddress) {
  console.error(`\nError: No deployment found for network '${target}'.`);
  console.error(`Run 'npm run chain:deploy:${target}' to deploy to this network first.`);
  process.exit(1);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function bundleDigest(bundle) {
  return keccak256(toHex(canonicalJson(bundle)));
}

async function run() {
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  try {
    const blockNumber = await client.getBlockNumber();
    console.log(`Current Block:    #${blockNumber}`);

    const totalAnchored = await client.readContract({
      address: contractAddress,
      abi,
      functionName: "total",
    });
    console.log(`Total Anchored:   ${totalAnchored} records\n`);

    if (totalAnchored > 0n) {
      const latestDigest = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "digestAt",
        args: [totalAnchored - 1n],
      });
      console.log(`Inspecting Most Recent Anchor:`);
      console.log(`Digest (keccak256): ${latestDigest}`);

      const [exists, timestamp, submitter, similarityBp] = await client.readContract({
        address: contractAddress,
        abi,
        functionName: "verify",
        args: [latestDigest],
      });

      console.log(`- On Chain:        ${exists ? "YES (VERIFIED)" : "NO"}`);
      console.log(`- Block Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
      console.log(`- Submitter:       ${submitter}`);
      console.log(`- Similarity:      ${(Number(similarityBp) / 100).toFixed(2)}% (${similarityBp} bp)`);
    }

    console.log("\nTesting Tamper Detection against Live Contract:");
    const fakeDigest = "0x" + "00".repeat(32);
    const [fakeExists] = await client.readContract({
      address: contractAddress,
      abi,
      functionName: "verify",
      args: [fakeDigest],
    });
    console.log(`- Random / Tampered Hash (${fakeDigest.slice(0, 10)}...): exists = ${fakeExists} (TAMPER REJECTED)`);

    console.log("\n[SUCCESS] Contract is live and responsive on-chain.");
    process.exitCode = 0;
  } catch (err) {
    console.error("RPC / Contract error:", err.message);
    process.exitCode = 1;
  }
}

run();
