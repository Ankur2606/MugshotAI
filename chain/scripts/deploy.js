// Deploys EvidenceRegistry and writes the address + ABI where the Next app reads it.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  const registry = await hre.viem.deployContract("EvidenceRegistry");
  const address = registry.address;

  const artifact = await hre.artifacts.readArtifact("EvidenceRegistry");
  const outDir = path.resolve(__dirname, "../../src/lib/contract");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, "EvidenceRegistry.json"),
    JSON.stringify({ abi: artifact.abi }, null, 2)
  );

  const deploymentsPath = path.join(outDir, "deployments.json");
  const deployments = fs.existsSync(deploymentsPath)
    ? JSON.parse(fs.readFileSync(deploymentsPath, "utf8"))
    : {};
  deployments[net] = { address, deployedAt: new Date().toISOString() };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  console.log(`EvidenceRegistry deployed to ${address} on ${net}`);
  console.log(`Wrote ABI + address to src/lib/contract/`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
