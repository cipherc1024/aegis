// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CommittedOracle} from "./CommittedOracle.sol";

interface IWMON {
    function deposit() external payable;
}

/// @title AtomicExecutor（M2：原子输入–执行绑定）
/// @notice 在同一笔交易内「读共识提交的输入 + 执行」：calldata 里没有行情参数槽——
///         expectedStateHash 只是一致性断言（输入在中途被更新则 revert），真正的输入
///         （price）由本合约在执行当下从 CommittedOracle 存储读入。于是 R1 攻击面
///         （向决策/执行喂假行情）在此 regime 下没有进入点：
///           - 原文声明的 inputRoot ≠ oracle stateHash → challenger 拒绝（链下拦截）；
///           - 执行时输入已变 → revert "input changed"（链上 fail-closed）；
///           - 观测过旧 → revert "stale input"（与 ReceiptRegistry 的 MAX_BLOCK_AGE 同口径）。
///
///         本合约是 M2 的最小实例化（演示件）：pace 只保留单笔上限，执行动作 = 官方
///         WMON wrap（deposit），wrap 所得 WMON 留存在本合约。生产形态应并入
///         AegisVaultQuorum 的 _preExecutionHook 链——此处刻意独立，便于把
///         「共识提交输入」作为单独实验变量隔离测量。
contract AtomicExecutor {
    CommittedOracle public immutable oracle;
    address public immutable wmon;
    bytes32 public immutable assetId;
    uint256 public immutable maxPerTxWei;

    /// @notice 与 ReceiptRegistry 的 MAX_BLOCK_AGE=100 同口径
    uint256 public constant MAX_BLOCK_AGE = 100;

    event AtomicExecuted(
        bytes32 indexed assetId,
        uint256 price,
        uint256 obsBlock,
        bytes32 stateHash,
        uint256 amountWei,
        address caller
    );

    constructor(address _oracle, address _wmon, bytes32 _assetId, uint256 _maxPerTxWei) {
        require(_oracle != address(0) && _wmon != address(0), "Zero address");
        oracle = CommittedOracle(_oracle);
        wmon = _wmon;
        assetId = _assetId;
        maxPerTxWei = _maxPerTxWei;
    }

    /// @notice 原子执行：读 oracle（同一 tx）→ 新鲜性/一致性检查 → pace → wrap。
    ///         msg.value 必须等于 amountWei（执行字节自证金额，无外部金额槽）。
    function executeAtomic(uint256 amountWei, bytes32 expectedStateHash) external payable {
        require(msg.value == amountWei, "value != amount");
        (uint256 price, uint256 obsBlock, bytes32 stateHash) = oracle.observations(assetId);
        require(stateHash != bytes32(0), "no observation");
        require(stateHash == expectedStateHash, "input changed");
        require(block.number - obsBlock <= MAX_BLOCK_AGE, "stale input");
        require(amountWei <= maxPerTxWei, "pace");

        IWMON(wmon).deposit{value: amountWei}();
        emit AtomicExecuted(assetId, price, obsBlock, stateHash, amountWei, msg.sender);
    }
}
