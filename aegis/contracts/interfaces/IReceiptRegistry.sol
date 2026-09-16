// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiptRegistry {
    /// @dev 与 ReceiptRegistry.Receipt 字段顺序严格一致（ABI 解码依赖顺序）
    struct Receipt {
        bytes32 digest;
        bytes32 pdrHash;
        bytes32 guardrailHash;
        bytes32 executionHash;
        uint256 blockHeight;
        bytes32 blockHash;
        uint256 submitBlock;
        bytes32 nonce;
        bytes32 quoteHash;
        bool isHeartbeat;
        uint256 timestamp;
    }

    /// @notice 最近一张【交易】收据的锚定高度是否仍在新鲜窗口内（防重放）
    function isTradeFresh(uint256 agentId) external view returns (bool);

    /// @notice 距最近一次【任意】收据提交是否在容忍窗口内（死手开关）
    function isAlive(uint256 agentId, uint256 maxStaleness) external view returns (bool);

    /// @notice 最近一张交易收据绑定的执行哈希（PACE 执行-字节绑定）
    function latestExecutionHash(uint256 agentId) external view returns (bytes32);

    /// @notice 最近一张【任意】收据（含心跳）；isHeartbeat 供调用方区分心跳与交易
    function latestReceipt(uint256 agentId) external view returns (Receipt memory);

    /// @notice 最近一张【交易】收据（心跳不写此槽）；交易槽才是 quorum 与 PACE 的判定源
    function lastTradeReceipt(uint256 agentId) external view returns (Receipt memory);

    /// @notice 当前哈希链头（最近一张收据的 digest；challenger 互证以它为 requestHash）
    function lastReceiptHash(uint256 agentId) external view returns (bytes32);

    /// @notice 决策原文绑定：receiptDigest => keccak(abi.encode(command, marketData, target, amount, data))
    ///         （未绑定时为 0 —— challenger 对未绑定原文的收据 fail-closed 拒绝）
    function transcriptHash(bytes32 receiptDigest) external view returns (bytes32);
}
