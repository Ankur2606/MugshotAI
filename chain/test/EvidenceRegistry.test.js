const { expect } = require("chai");
const hre = require("hardhat");
const { keccak256, toHex } = require("viem");

describe("EvidenceRegistry", function () {
  async function deployFixture() {
    const [owner, otherAccount] = await hre.viem.getWalletClients();
    const registry = await hre.viem.deployContract("EvidenceRegistry");
    const publicClient = await hre.viem.getPublicClient();

    return { registry, publicClient, owner, otherAccount };
  }

  it("should deploy with zero total records", async function () {
    const { registry } = await deployFixture();
    const total = await registry.read.total();
    expect(total).to.equal(0n);
  });

  it("should anchor a new evidence digest and emit Anchored event", async function () {
    const { registry, publicClient, owner } = await deployFixture();

    const testBundle = { v: 1, matchUrl: "https://example.com/post/1", score: 8500 };
    const digest = keccak256(toHex(JSON.stringify(testBundle)));
    const similarityBp = 8500;
    const matchUrl = "https://example.com/post/1";

    const hash = await registry.write.anchor([digest, similarityBp, matchUrl]);
    await publicClient.waitForTransactionReceipt({ hash });

    const [exists, timestamp, submitter, storedSim] = await registry.read.verify([digest]);
    expect(exists).to.be.true;
    expect(Number(timestamp)).to.be.greaterThan(0);
    expect(submitter.toLowerCase()).to.equal(owner.account.address.toLowerCase());
    expect(storedSim).to.equal(similarityBp);

    const total = await registry.read.total();
    expect(total).to.equal(1n);

    const firstDigest = await registry.read.digestAt([0n]);
    expect(firstDigest).to.equal(digest);
  });

  it("should return exists = false for unanchored digest", async function () {
    const { registry } = await deployFixture();

    const fakeDigest = keccak256(toHex("unanchored-test-bundle"));
    const [exists, timestamp, submitter, storedSim] = await registry.read.verify([fakeDigest]);

    expect(exists).to.be.false;
    expect(timestamp).to.equal(0n);
    expect(submitter).to.equal("0x0000000000000000000000000000000000000000");
    expect(storedSim).to.equal(0);
  });

  it("should revert if anchoring the same digest twice (replay protection)", async function () {
    const { registry } = await deployFixture();

    const digest = keccak256(toHex("duplicate-protection-test"));
    await registry.write.anchor([digest, 9000, "https://example.com/post/2"]);

    await expect(
      registry.write.anchor([digest, 9000, "https://example.com/post/2"])
    ).to.be.rejectedWith("AlreadyAnchored");
  });

  it("should revert if similarityBp exceeds 10000", async function () {
    const { registry } = await deployFixture();

    const digest = keccak256(toHex("out-of-range-test"));
    await expect(
      registry.write.anchor([digest, 10001, "https://example.com/post/3"])
    ).to.be.rejectedWith("SimilarityOutOfRange");
  });
});
