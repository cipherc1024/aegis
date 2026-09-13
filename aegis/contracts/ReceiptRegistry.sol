// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDcapGate {
    function check(bytes calldata rawQuote, bytes32 expectedDigest)
        external
        view
        returns (bool verified, bool bound);
}

/// @title ReceiptRegistry
/// @notice 收据哈希链账本。两条提交路径：
///         1) submitReceipt —— 仅授权 TEE 地址（MVP/回退）
///         2) submitReceiptWithQuote —— 附带 DCAP quote，链上验证 quote 真实
///            且其 report_data[0:32] 绑定本收据的"语义摘要"
contract ReceiptRegistry {
    uint256 public constant MAX_BLOCK_AGE = 100; // 100 块 ≈ 30s @300ms：容忍 quote 往返 + LLM 延迟（nonce+prev 链已防重放）

    struct Receipt {
        bytes32 digest;
        bytes32 pdrHash;
        bytes32 guardrailHash;
        bytes32 executionHash;
        uint256 blockHeight;
        bytes32 blockHash;
        uint256 submitBlock;
        bytes32 nonce;
        bytes32 quoteHash; // keccak256(rawQuote)；无 quote 时为 0
        bool isHeartbeat;
        uint256 timestamp;
    }

    address public governance;
    mapping(uint256 => address) public agentTEE;
    IDcapGate public dcapGate;

    mapping(uint256 => bytes32) public lastReceiptHash;
    mapping(uint256 => Receipt) public latestReceipt;
    mapping(uint256 => Receipt) public lastTradeReceipt;
    mapping(uint256 => bytes32) public agentGuardrailHash;
    mapping(uint256 => mapping(bytes32 => bool)) public usedNonces;
    // 决策原文绑定：receiptDigest => keccak(abi.encode(command, marketData, target, amount, data))
    mapping(bytes32 => bytes32) public transcriptHash;

    event ReceiptSubmitted(
        uint256 indexed agentId,
        bytes32 indexed receiptHash,
        uint256 blockHeight,
        bytes32 executionHash,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 nonce,
        bytes32 quoteHash,
        bool isHeartbeat
    );
    event GuardrailUpdated(uint256 indexed agentId, bytes32 guardrailHash);
    event TEEAuthorized(uint256 indexed agentId, address tee);
    event DcapGateUpdated(address gate);
    event TranscriptBound(uint256 indexed agentId, bytes32 indexed receiptDigest, bytes32 transcriptHash, string transcriptURI);

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier onlyTEE(uint256 agentId) {
        require(msg.sender == agentTEE[agentId], "Not authorized TEE");
        _;
    }

    constructor(address _governance) {
        require(_governance != address(0), "Zero governance");
        governance = _governance;
    }

    function authorizeTEE(uint256 agentId, address tee) external onlyGovernance {
        agentTEE[agentId] = tee;
        emit TEEAuthorized(agentId, tee);
    }

    function setGuardrailHash(uint256 agentId, bytes32 hash) external onlyGovernance {
        agentGuardrailHash[agentId] = hash;
        emit GuardrailUpdated(agentId, hash);
    }

    function setDcapGate(address gate) external onlyGovernance {
        dcapGate = IDcapGate(gate);
        emit DcapGateUpdated(gate);
    }

    /// @notice 决策原文绑定：把 transcriptHash（决策原文的 keccak）绑到最新收据。
    ///         challenger 独立重推导时以链上 transcriptHash 锚定原文 —— 伪造原文直接 mismatch，
    ///         无绑定（未 bind）→ challenger fail-closed 拒绝（no transcript, no signature）。
    function bindTranscript(
        uint256 agentId,
        bytes32 receiptDigest,
        bytes32 tHash,
        string calldata transcriptURI
    ) external onlyTEE(agentId) {
        require(lastReceiptHash[agentId] == receiptDigest, "Not latest receipt");
        require(transcriptHash[receiptDigest] == bytes32(0), "Transcript bound");
        require(tHash != bytes32(0), "Zero transcript hash");
        transcriptHash[receiptDigest] = tHash;
        emit TranscriptBound(agentId, receiptDigest, tHash, transcriptURI);
    }

    /// @notice 路径 1：仅授权 TEE 地址可提交（MVP/回退）
    function submitReceipt(
        uint256 agentId,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 executionHash,
        bytes32 nonce,
        uint256 blockHeight,
        bytes32 blockHash,
        bool isHeartbeat
    ) external onlyTEE(agentId) {
        _submit(agentId, pdrHash, guardrailHash, executionHash, nonce, blockHeight, blockHash, isHeartbeat, bytes32(0));
    }

    /// @notice 路径 2：附带 DCAP quote。任何人可代提交，但须证明：
    ///         quote 验真，且其 report_data[0:32] == 语义摘要（TEE 已背书）。
    function submitReceiptWithQuote(
        uint256 agentId,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 executionHash,
        bytes32 nonce,
        uint256 blockHeight,
        bytes32 blockHash,
        bool isHeartbeat,
        bytes calldata quote
    ) external {
        require(address(dcapGate) != address(0), "DCAP gate not set");
        bytes32 prev = lastReceiptHash[agentId];
        bytes32 semantic = semanticDigest(agentId, pdrHash, guardrailHash, executionHash, nonce, prev);
        (bool verified, bool bound) = dcapGate.check(quote, semantic);
        require(verified, "DCAP quote not verified");
        require(bound, "DCAP report_data not bound");
        _submit(agentId, pdrHash, guardrailHash, executionHash, nonce, blockHeight, blockHash, isHeartbeat, keccak256(quote));
    }

    /// @notice TEE 在 quote 的 report_data[0:32] 中背书的"语义摘要"
    function semanticDigest(
        uint256 agentId,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 executionHash,
        bytes32 nonce,
        bytes32 prev
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(agentId, pdrHash, guardrailHash, executionHash, nonce, prev));
    }

    function _submit(
        uint256 agentId,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 executionHash,
        bytes32 nonce,
        uint256 blockHeight,
        bytes32 blockHash,
        bool isHeartbeat,
        bytes32 quoteHash
    ) internal {
        require(block.number > blockHeight, "Height in future");
        require(block.number - blockHeight <= MAX_BLOCK_AGE, "Stale attestation");
        require(blockhash(blockHeight) == blockHash, "Block hash mismatch");
        require(!usedNonces[agentId][nonce], "Nonce used");
        usedNonces[agentId][nonce] = true;
        require(guardrailHash == agentGuardrailHash[agentId], "Guardrail mismatch");

        bytes32 prev = lastReceiptHash[agentId];
        bytes32 digest = keccak256(abi.encode(
            agentId, pdrHash, guardrailHash, executionHash, blockHeight, blockHash, prev, nonce
        ));

        Receipt memory rec = Receipt({
            digest: digest,
            pdrHash: pdrHash,
            guardrailHash: guardrailHash,
            executionHash: executionHash,
            blockHeight: blockHeight,
            blockHash: blockHash,
            submitBlock: block.number,
            nonce: nonce,
            quoteHash: quoteHash,
            isHeartbeat: isHeartbeat,
            timestamp: block.timestamp
        });

        lastReceiptHash[agentId] = digest;
        latestReceipt[agentId] = rec;
        if (!isHeartbeat) {
            lastTradeReceipt[agentId] = rec;
        }

        emit ReceiptSubmitted(
            agentId, digest, blockHeight, executionHash, pdrHash, guardrailHash, nonce, quoteHash, isHeartbeat
        );
    }

    function isTradeFresh(uint256 agentId) external view returns (bool) {
        Receipt memory r = lastTradeReceipt[agentId];
        return r.submitBlock != 0 && block.number - r.blockHeight <= MAX_BLOCK_AGE;
    }

    function isAlive(uint256 agentId, uint256 maxStaleness) external view returns (bool) {
        Receipt memory r = latestReceipt[agentId];
        return r.submitBlock != 0 && block.number - r.submitBlock <= maxStaleness;
    }

    function latestExecutionHash(uint256 agentId) external view returns (bytes32) {
        return lastTradeReceipt[agentId].executionHash;
    }

    function computeDigest(
        uint256 agentId,
        bytes32 pdrHash,
        bytes32 guardrailHash,
        bytes32 executionHash,
        uint256 blockHeight,
        bytes32 blockHash,
        bytes32 prev,
        bytes32 nonce
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(agentId, pdrHash, guardrailHash, executionHash, blockHeight, blockHash, prev, nonce));
    }
}
