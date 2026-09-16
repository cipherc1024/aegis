// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AuditDraw（M3：承诺–揭示抽选机 CRAD）
/// @notice 一机两用：① 供给 MA2a 的「真随机抽选」——审计者在周期后从链上转录抽选
///         金丝雀复核，抽选规则对手不可预知；② 供给 IC-1 的金丝雀索引承诺——治理方
///         在周期初对种子做哈希承诺，周期末揭示，无法追溯性豁免。
///
///         随机性结构：draw 输入 = keccak256(seed, anchorHash, periodId, i)。
///           - seed 由治理方在周期初承诺（commitment = keccak256(seed)）——治理方在
///             锚块产出前即被钉死，无法按锚选种子；
///           - anchorHash = blockhash(commitBlock + REVEAL_DELAY)——揭示时才能读到的
///             未来块哈希，对手在承诺时不可预知。
///         单方都无法单独偏置输出；残余偏差 = RANDAO 同款最后一动者扣块（锚块出块者
///         可在「产出 / 扣块」间二选一，≤1 bit 研磨，代价 ≥ 块奖励）。偏差界命题见论文
///         §6.2 备注；k = REVEAL_DELAY 的选取使扣块成本超过单次捕获暴露的 bond 敞口。
///
///         抽选函数公开确定：任何人拿到 (seed, anchorHash, receiptCount) 后可链下重算
///         indices 并与 DrawRevealed 事件逐值比对——「审计者可复算」是本设计的卖点。
contract AuditDraw {
    address public immutable governance;

    /// @notice 承诺到揭示之间等待的块数（锚块 = commitBlock + REVEAL_DELAY）
    uint256 public constant REVEAL_DELAY = 5;

    struct Draw {
        bytes32 commitment;
        uint256 commitBlock;
        bool revealed;
    }

    /// @notice periodId → 抽选记录
    mapping(uint256 => Draw) public draws;

    event DrawCommitted(uint256 indexed periodId, bytes32 commitment, uint256 commitBlock);
    event DrawRevealed(
        uint256 indexed periodId,
        bytes32 seed,
        uint256 anchorBlock,
        bytes32 anchorHash,
        uint256 receiptCount,
        uint256 sampleSize,
        uint256[] indices
    );

    error NotGovernance();

    constructor() {
        governance = msg.sender;
    }

    /// @notice 周期初：治理方承诺种子（commitment = keccak256(abi.encode(seed))）。
    ///         每个周期只许承诺一次——承诺即钉死，防治理方按后续锚块重选种子。
    function commitDraw(uint256 periodId, bytes32 commitment) external {
        if (msg.sender != governance) revert NotGovernance();
        require(commitment != bytes32(0), "zero commitment");
        require(draws[periodId].commitment == bytes32(0), "already committed");
        draws[periodId] = Draw(commitment, block.number, false);
        emit DrawCommitted(periodId, commitment, block.number);
    }

    /// @notice 周期末：揭示种子并从锚块哈希导出抽选索引。permissionless——
    ///         只有正确的 preimage 能通过 commitment 校验，任何人可触发揭示。
    /// @dev    blockhash 只保留最近 256 块：超过窗口未揭示则本周期抽选作废
    ///         （"anchor expired"），fail-closed——宁可缺审计周期，不可用退化随机源。
    function revealDraw(
        uint256 periodId,
        bytes32 seed,
        uint256 receiptCount,
        uint256 sampleSize
    ) external returns (uint256[] memory indices) {
        Draw storage d = draws[periodId];
        require(d.commitment != bytes32(0), "not committed");
        require(!d.revealed, "already revealed");
        uint256 anchorBlock = d.commitBlock + REVEAL_DELAY;
        require(block.number >= anchorBlock, "too early");
        bytes32 anchorHash = blockhash(anchorBlock);
        require(anchorHash != bytes32(0), "anchor expired");
        require(keccak256(abi.encode(seed)) == d.commitment, "bad seed");
        require(receiptCount > 0, "no receipts");
        require(sampleSize > 0 && sampleSize <= receiptCount, "bad sample size");

        indices = new uint256[](sampleSize);
        for (uint256 i = 0; i < sampleSize; i++) {
            indices[i] = uint256(keccak256(abi.encode(seed, anchorHash, periodId, i))) % receiptCount;
        }
        d.revealed = true;
        emit DrawRevealed(periodId, seed, anchorBlock, anchorHash, receiptCount, sampleSize, indices);
    }
}
