require("@nomicfoundation/hardhat-toolbox-viem");
require("dotenv").config({ path: "../.env.local" });

const rawKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const normalizedKey = rawKey ? (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) : undefined;
const isValidKey = normalizedKey && /^0x[0-9a-fA-F]{64}$/.test(normalizedKey);
const accounts = isValidKey ? [normalizedKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
  networks: {
    // `npx hardhat node` listens here. Chain id 31337.
    localhost: { url: "http://127.0.0.1:8545" },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts,
    },
  },
};
