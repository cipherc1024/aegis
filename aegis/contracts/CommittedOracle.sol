// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CommittedOracle（M2：共识提交输入）
/// @notice 治理方按块锚提交观测值；stateHash = keccak256(assetId, price, blockNumber)
///         扮演 root_x = H(x) 的角色——输入 x 是链上状态，由共识提交，任何人可从链上
///         独立重取并验证（公开承诺源 ⇒ H1⁺ 被公开性破坏，无需 TEE 信任，论文 §4.6 注）。
///
///         与攻击矩阵输入格的关系：链下喂数 regime 下输入代换无层可拦（R1 设计边界）；
///         本合约把输入搬进链上 regime——proposer 原文声明的 inputRoot 必须等于本合约的
///         stateHash，challenger 直接读链比对（input_commitment_mismatch），
///         执行端由 AtomicExecutor 在同一 tx 内读取（原子输入–执行绑定）。
contract CommittedOracle {
    address public immutable governance;

    struct Observation {
        uint256 price;
        uint256 blockNumber;
        bytes32 stateHash;
    }

    /// @notice assetId（如 keccak256("WMON/MON")）→ 最新观测
    mapping(bytes32 => Observation) public observations;

    event ObservationPosted(bytes32 indexed assetId, uint256 price, uint256 blockNumber, bytes32 stateHash);

    error NotGovernance();

    constructor() {
        governance = msg.sender;
    }

    /// @notice 治理方提交观测。块号锚 = 当前块——观测的新鲜性由执行端
    ///         （AtomicExecutor 的 MAX_BLOCK_AGE）判定，本合约只负责提交与存证。
    function postObservation(bytes32 assetId, uint256 price) external {
        if (msg.sender != governance) revert NotGovernance();
        bytes32 stateHash = keccak256(abi.encode(assetId, price, block.number));
        observations[assetId] = Observation(price, block.number, stateHash);
        emit ObservationPosted(assetId, price, block.number, stateHash);
    }

    /// @notice challenger 侧读取接口：返回承诺根（challenger 重推导 inputRoot 的链上参照）。
    function commitRoot(bytes32 assetId) external view returns (bytes32) {
        return observations[assetId].stateHash;
    }
}
