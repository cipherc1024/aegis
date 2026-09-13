// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AegisVault} from "./AegisVault.sol";

interface IValidationRegistry {
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate);
}

/// @title AegisVaultQuorum
/// @notice proposer/challenger 互证版金库：执行前要求最新收据 digest 已被
///         challenger 通过 ValidationRegistry 背书（response ≥ MIN_RESPONSE）。
///         requestHash 约定 = 收据 digest（哈希链上每张收据唯一）。
contract AegisVaultQuorum is AegisVault {
    IValidationRegistry public immutable validationRegistry;
    uint8 public constant MIN_RESPONSE = 100;

    constructor(
        address _registry,
        uint256 _agentId,
        address _tee,
        address _owner,
        address _validationRegistry
    ) AegisVault(_registry, _agentId, _tee, _owner) {
        require(_validationRegistry != address(0), "Zero validation");
        validationRegistry = IValidationRegistry(_validationRegistry);
    }

    /// @dev challenger quorum：最新收据必须已通过独立 challenger 的验证
    function _preExecutionHook(bytes32) internal view override {
        bytes32 receiptDigest = registry.lastReceiptHash(agentId);
        (, , uint8 response, , , ) = validationRegistry.getValidationStatus(receiptDigest);
        require(response >= MIN_RESPONSE, "No challenger quorum");
    }
}
