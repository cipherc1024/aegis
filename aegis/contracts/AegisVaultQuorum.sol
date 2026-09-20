// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AegisVault} from "./AegisVault.sol";
import {IReceiptRegistry} from "./interfaces/IReceiptRegistry.sol";

interface IValidationRegistry {
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate);
}

/// @title AegisVaultQuorum
/// @notice proposer/challenger 互证版金库：执行前要求最新**交易**收据 digest 已被
///         **已授权的** challenger 通过 ValidationRegistry 背书（response ≥ MIN_RESPONSE）。
///         requestHash 约定 = 收据 digest（哈希链上每张收据唯一）。
///
///         为什么必须校验 validator 身份：ValidationRegistry 是无需许可的 ERC-8004 注册表，
///         任何人都能以任意 validatorAddress 发起 validationRequest 并自己回 100——
///         只读 response 数值等于把 quorum 交给任何人。此处把「谁算 challenger」
///         变成 owner 维护的白名单，`_preExecutionHook` 同时校验地址与分值。
///
///         为什么读交易收据而非链头 lastReceiptHash：心跳收据只写链头槽、
///         不写交易槽（ReceiptRegistry._submit 对 isHeartbeat 跳过 lastTradeReceipt），
///         而 challenger 对心跳不背书（无 transcript 绑定）——若钩子读链头
///         lastReceiptHash，心跳之后的每次 executeTrade 都会 revert
///         "No challenger quorum"（fail-closed，资金安全但交易全线作废）。
///         钩子改读 registry.lastTradeReceipt()：心跳顶掉链头也不影响交易槽，
///         交易窗口按「最近一张交易收据」判定，与 isTradeFresh / latestExecutionHash
///         同源，心跳不再使交易作废。
contract AegisVaultQuorum is AegisVault {
    IValidationRegistry public immutable validationRegistry;
    uint8 public constant MIN_RESPONSE = 100;

    /// @notice 被授权参与 quorum 的 challenger 地址
    mapping(address => bool) public isTrustedValidator;
    /// @notice 当前授权 challenger 数量（置 0 则任何 executeTrade 都 revert，即 fail-closed）
    uint256 public trustedValidatorCount;

    event ValidatorTrustUpdated(address indexed validator, bool trusted);

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

    /// @notice owner 授权/撤销一个 challenger。撤销后其历史背书立即不再放行执行。
    function setTrustedValidator(address validator, bool trusted) external onlyOwner {
        require(validator != address(0), "Zero validator");
        require(isTrustedValidator[validator] != trusted, "No change");
        isTrustedValidator[validator] = trusted;
        trustedValidatorCount = trusted ? trustedValidatorCount + 1 : trustedValidatorCount - 1;
        emit ValidatorTrustUpdated(validator, trusted);
    }

    /// @dev challenger quorum：最新**交易**收据必须已被**授权** challenger 背书。
    ///      地址与分值都校验——单查分值可被任意地址自证绕过。
    ///
    ///      读交易槽而非链头：心跳只写链头、不写交易槽，且 challenger 不背书心跳，
    ///      故读链头会让心跳之后的交易全部 revert。此处的 digest 与
    ///      isTradeFresh / latestExecutionHash 同源（都取自 lastTradeReceipt）。
    ///      lastTradeReceipt 是 registry 的既有 public getter（自 v2 起在线），
    ///      v5 起 registry 可由 owner 经 setReceiptRegistry 更换——更换后本钩子
    ///      自动改读新表，无需重部署金库（资金、白名单、限额、余额历史全部保留）。
    function _preExecutionHook(bytes32) internal view override {
        bytes32 digest = registry.lastTradeReceipt(agentId).digest;
        (address validator, , uint8 response, , , ) = validationRegistry.getValidationStatus(digest);
        require(isTrustedValidator[validator], "Untrusted challenger");
        require(response >= MIN_RESPONSE, "No challenger quorum");
    }
}
