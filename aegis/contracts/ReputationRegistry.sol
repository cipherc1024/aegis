// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reputation Registry（ERC-8004 接口的自主实现）
contract ReputationRegistry {
    address public immutable identityRegistry;

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    mapping(uint256 => mapping(address => Feedback[])) private _feedback;
    mapping(uint256 => address[]) private _clients;

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    constructor(address _identityRegistry) {
        identityRegistry = _identityRegistry;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(valueDecimals <= 18, "decimals>18");
        Feedback[] storage list = _feedback[agentId][msg.sender];
        if (list.length == 0) _clients[agentId].push(msg.sender);
        list.push(Feedback(value, valueDecimals, tag1, tag2, false));
        emit NewFeedback(agentId, msg.sender, uint64(list.length), value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback[] storage list = _feedback[agentId][msg.sender];
        require(feedbackIndex >= 1 && feedbackIndex <= list.length, "bad index");
        list[feedbackIndex - 1].isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback memory f = _feedback[agentId][clientAddress][feedbackIndex - 1];
        return (f.value, f.valueDecimals, f.tag1, f.tag2, f.isRevoked);
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        uint256 sum;
        for (uint256 i = 0; i < clientAddresses.length; i++) {
            Feedback[] memory list = _feedback[agentId][clientAddresses[i]];
            for (uint256 j = 0; j < list.length; j++) {
                Feedback memory f = list[j];
                if (f.isRevoked) continue;
                if (bytes(tag1).length > 0 && keccak256(bytes(tag1)) != keccak256(bytes(f.tag1))) continue;
                if (bytes(tag2).length > 0 && keccak256(bytes(tag2)) != keccak256(bytes(f.tag2))) continue;
                sum += uint128(f.value);
                count++;
            }
        }
        summaryValue = count == 0 ? int128(0) : int128(int256(sum / count));
        summaryValueDecimals = 0;
    }
}
