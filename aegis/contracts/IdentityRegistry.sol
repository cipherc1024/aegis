// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title Identity Registry（ERC-8004 接口的自主实现， Monad testnet 尚无官方部署）
contract IdentityRegistry is ERC721, ERC721URIStorage {
    uint256 public lastId;
    mapping(uint256 => mapping(string => bytes)) private _metadata;
    mapping(uint256 => address) public agentWallet;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(uint256 indexed agentId, string indexed indexedKey, string metadataKey, bytes metadataValue);

    string private constant RESERVED_KEY = "agentWallet";

    constructor() ERC721("Aegis Identity Registry", "AEGIS-ID") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = ++lastId;
        agentWallet[agentId] = msg.sender;
        _safeMint(msg.sender, agentId);
        if (bytes(agentURI).length > 0) _setTokenURI(agentId, agentURI);
        emit Registered(agentId, agentURI, msg.sender);
        emit MetadataSet(agentId, RESERVED_KEY, RESERVED_KEY, abi.encodePacked(msg.sender));
    }

    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory) {
        return _metadata[agentId][key];
    }

    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external {
        require(ownerOf(agentId) == msg.sender, "not owner");
        require(keccak256(bytes(key)) != keccak256(bytes(RESERVED_KEY)), "reserved key");
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
