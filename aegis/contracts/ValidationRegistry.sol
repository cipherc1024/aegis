// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ValidationRegistry（ERC-8004 接口的自主实现，官方 Validation Registry 尚未在 Monad 部署）
contract ValidationRegistry {
    address public immutable identityRegistry;

    struct Validation {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
    }

    mapping(bytes32 => Validation) public validations;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

    event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash);
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    constructor(address _identityRegistry) {
        identityRegistry = _identityRegistry;
    }

    function getIdentityRegistry() external view returns (address) {
        return identityRegistry;
    }

    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external {
        require(validations[requestHash].validatorAddress == address(0), "exists");
        validations[requestHash] = Validation(validatorAddress, agentId, 0, bytes32(0), "", 0);
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(bytes32 requestHash, uint8 response, string calldata responseURI, bytes32 responseHash, string calldata tag) external {
        Validation storage v = validations[requestHash];
        require(v.validatorAddress == msg.sender, "not validator");
        require(response <= 100, "response>100");
        v.response = response;
        v.responseHash = responseHash;
        v.tag = tag;
        v.lastUpdate = block.timestamp;
        emit ValidationResponse(msg.sender, v.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)
    {
        Validation memory v = validations[requestHash];
        return (v.validatorAddress, v.agentId, v.response, v.responseHash, v.tag, v.lastUpdate);
    }

    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 averageResponse)
    {
        bytes32[] memory hashes = _agentValidations[agentId];
        uint256 sum;
        for (uint256 i = 0; i < hashes.length; i++) {
            Validation memory v = validations[hashes[i]];
            if (v.lastUpdate == 0) continue;
            if (validatorAddresses.length > 0) {
                bool ok;
                for (uint256 j = 0; j < validatorAddresses.length; j++) if (validatorAddresses[j] == v.validatorAddress) ok = true;
                if (!ok) continue;
            }
            if (bytes(tag).length > 0 && keccak256(bytes(tag)) != keccak256(bytes(v.tag))) continue;
            sum += v.response;
            count++;
        }
        averageResponse = count == 0 ? 0 : uint8(sum / count);
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
