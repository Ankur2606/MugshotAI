// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvidenceRegistry
/// @notice Tamper-evident anchor for face-match evidence bundles.
///         Only the keccak256 digest of a canonical JSON bundle is stored on
///         chain. The bundle itself stays off chain; anyone holding it can
///         recompute the digest and call `verify` to prove it is unaltered.
contract EvidenceRegistry {
    struct Record {
        uint64 timestamp;   // block time of the anchoring tx
        address submitter;  // account that anchored it
        uint32 similarityBp; // face similarity in basis points (0..10000)
    }

    /// @dev bundleHash => record. timestamp == 0 means "never anchored".
    mapping(bytes32 => Record) private _records;

    /// @dev append-only log of every digest anchored, for enumeration.
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

    /// @notice Record a bundle digest. Reverts if this exact digest is already
    ///         on chain, which makes replay of an identical bundle visible.
    /// @param bundleHash keccak256 of the canonical evidence JSON
    /// @param similarityBp face similarity, in basis points
    /// @param matchUrl the matched post URL, emitted for human inspection
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

    /// @notice Check a digest against the chain.
    /// @return exists       true if this exact digest was anchored
    /// @return timestamp    block time of the anchoring tx (0 if absent)
    /// @return submitter    account that anchored it (zero address if absent)
    /// @return similarityBp similarity recorded at anchor time
    function verify(bytes32 bundleHash)
        external
        view
        returns (bool exists, uint64 timestamp, address submitter, uint32 similarityBp)
    {
        Record memory r = _records[bundleHash];
        return (r.timestamp != 0, r.timestamp, r.submitter, r.similarityBp);
    }

    function total() external view returns (uint256) {
        return _digests.length;
    }

    function digestAt(uint256 index) external view returns (bytes32) {
        return _digests[index];
    }
}
