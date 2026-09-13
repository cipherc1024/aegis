// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PolicyRegistry
/// @notice 策略版本注册与链上治理更新。MVP 由治理地址（多签）更新；
///         非对称升级（收紧即时 / 放宽时间锁）列为未来工作。
contract PolicyRegistry {
    address public governance;
    mapping(uint256 => bytes32) public currentPolicyHash;
    mapping(uint256 => bytes32[]) public policyHistory;

    event PolicyUpdated(uint256 indexed agentId, bytes32 newPolicyHash);
    event GovernanceTransferred(address indexed from, address indexed to);

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    constructor(address _governance) {
        require(_governance != address(0), "Zero governance");
        governance = _governance;
    }

    function transferGovernance(address newGov) external onlyGovernance {
        require(newGov != address(0), "Zero governance");
        emit GovernanceTransferred(governance, newGov);
        governance = newGov;
    }

    function updatePolicy(uint256 agentId, bytes32 newPolicyHash) external onlyGovernance {
        currentPolicyHash[agentId] = newPolicyHash;
        policyHistory[agentId].push(newPolicyHash);
        emit PolicyUpdated(agentId, newPolicyHash);
    }

    function policyHistoryLength(uint256 agentId) external view returns (uint256) {
        return policyHistory[agentId].length;
    }
}
