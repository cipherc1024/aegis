// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceiptRegistry} from "./interfaces/IReceiptRegistry.sol";

/// @title AegisVault
/// @notice 资金托管 + 链上硬约束 + 死手开关。
///         交易必须：①来自 TEE 派生地址 ②被最新交易收据的 executionHash 背书
///         ③通过白名单/限额 ④Agent 存活（有新鲜收据）。提现永不冻结。
contract AegisVault {
    IReceiptRegistry public immutable registry;
    uint256 public immutable agentId;

    address public owner;
    address public pendingOwner;
    address public teeDerivedAddress;

    mapping(address => bool) public whitelistedTargets;
    uint256 public perTxLimit;
    uint256 public dailyLimit;
    mapping(uint256 => uint256) public dailySpent; // day => amount
    bool public tradingFrozen;

    /// @dev 死手开关容忍窗口：60 块 ≈ 18 秒 @ 300ms
    uint256 public constant STALENESS_LIMIT = 60;

    // ---- 重入保护 ----
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    event TradeExecuted(address indexed target, uint256 amount, bytes32 execHash);
    event TradingFrozen(address indexed by, string reason);
    event TradingResumed(address indexed by);
    event TargetWhitelisted(address indexed target, bool allowed);
    event LimitsUpdated(uint256 perTxLimit, uint256 dailyLimit);
    event TEEUpdated(address indexed tee);
    event Deposited(address indexed by, uint256 amount);
    event Withdrawn(address indexed by, uint256 amount);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyTEE() {
        require(msg.sender == teeDerivedAddress, "Not TEE");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _registry, uint256 _agentId, address _tee, address _owner) {
        require(_registry != address(0) && _tee != address(0) && _owner != address(0), "Zero addr");
        registry = IReceiptRegistry(_registry);
        agentId = _agentId;
        teeDerivedAddress = _tee;
        owner = _owner;
        // 不维护 lastProofBlock：存活判断完全委托给 registry.isAlive，
        // 消除「Vault 记交易、Registry 记收据」两套时间基准不一致导致的误冻结
    }

    /// @dev 死手开关核心：交易前必须有新鲜收据 + 执行体必须被收据背书
    modifier proofAlive() {
        require(!tradingFrozen, "Trading frozen");
        require(registry.isTradeFresh(agentId), "No fresh trade receipt");
        _;
    }

    /// @notice 执行一笔交易。只有 TEE 可调用；执行体必须与最新交易收据的
    ///         executionHash 完全一致（无收据背书的执行直接 revert）。
    ///         value 以原生 MON 随调用发送（限额以 value 计量）。
    function executeTrade(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyTEE proofAlive nonReentrant {
        // PACE 绑定：执行-字节 ↔ 收据
        bytes32 execHash = keccak256(abi.encode(target, value, data));
        require(registry.latestExecutionHash(agentId) == execHash, "No PDR binding");

        // 扩展钩子（如 challenger 互证 quorum）；默认无操作
        _preExecutionHook(execHash);

        // 链上硬约束（独立于 TEE）
        require(whitelistedTargets[target], "Target not whitelisted");
        require(value <= perTxLimit, "Exceeds per-tx limit");
        uint256 today = block.timestamp / 1 days;
        require(value <= dailyLimit - dailySpent[today], "Exceeds daily limit");
        dailySpent[today] += value;

        (bool success, ) = target.call{value: value}(data);
        require(success, "Trade failed");

        emit TradeExecuted(target, value, execHash);
    }

    /// @dev 扩展点：子类覆写以加入额外执行前校验（如 challenger 互证）
    function _preExecutionHook(bytes32 execHash) internal virtual {}

    /// @notice 死手开关：距最近一张收据超过 STALENESS_LIMIT，任何人可触发冻结
    function freezeIfStale() external {
        if (!registry.isAlive(agentId, STALENESS_LIMIT) && !tradingFrozen) {
            tradingFrozen = true;
            emit TradingFrozen(msg.sender, "Stale: no recent receipt");
        }
    }

    /// @notice 解冻：仅 owner；必须证明 Agent 已恢复存活才能解冻
    function resumeTrading() external onlyOwner {
        require(registry.isAlive(agentId, STALENESS_LIMIT), "Agent still stale");
        tradingFrozen = false;
        emit TradingResumed(msg.sender);
    }

    function emergencyPause() external onlyOwner {
        tradingFrozen = true;
        emit TradingFrozen(msg.sender, "Owner emergency pause");
    }

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice 提现永不冻结（最终兜底）。MVP 为单用户金库：owner 即唯一存款人。
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= address(this).balance, "Insufficient balance");
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(owner, amount);
    }

    // ---------- 治理（owner） ----------

    function setTarget(address target, bool allowed) external onlyOwner {
        whitelistedTargets[target] = allowed;
        emit TargetWhitelisted(target, allowed);
    }

    function setLimits(uint256 _perTxLimit, uint256 _dailyLimit) external onlyOwner {
        require(_perTxLimit <= _dailyLimit, "perTx > daily");
        perTxLimit = _perTxLimit;
        dailyLimit = _dailyLimit;
        emit LimitsUpdated(_perTxLimit, _dailyLimit);
    }

    function setTEE(address _tee) external onlyOwner {
        require(_tee != address(0), "Zero addr");
        teeDerivedAddress = _tee;
        emit TEEUpdated(_tee);
    }

    function startOwnershipTransfer(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero addr");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
