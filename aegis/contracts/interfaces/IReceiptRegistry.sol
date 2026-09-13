// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiptRegistry {
    /// @notice 最近一张【交易】收据的锚定高度是否仍在新鲜窗口内（防重放）
    function isTradeFresh(uint256 agentId) external view returns (bool);

    /// @notice 距最近一次【任意】收据提交是否在容忍窗口内（死手开关）
    function isAlive(uint256 agentId, uint256 maxStaleness) external view returns (bool);

    /// @notice 最近一张交易收据绑定的执行哈希（PACE 执行-字节绑定）
    function latestExecutionHash(uint256 agentId) external view returns (bytes32);

    /// @notice 当前哈希链头（最近一张收据的 digest；challenger 互证以它为 requestHash）
    function lastReceiptHash(uint256 agentId) external view returns (bytes32);

    /// @notice 决策原文绑定：receiptDigest => keccak(abi.encode(command, marketData, target, amount, data))
    ///         （未绑定时为 0 —— challenger 对未绑定原文的收据 fail-closed 拒绝）
    function transcriptHash(bytes32 receiptDigest) external view returns (bytes32);
}
