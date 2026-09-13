// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev 与 Automata V4QuoteVerifier 的 Header 元组结构一致
struct QuoteHeader {
    uint16 version;
    bytes2 attestationKeyType;
    bytes4 teeType;
    bytes2 qeSvn;
    bytes2 pceSvn;
    bytes16 qeVendorId;
    bytes20 userData;
}

interface IQuoteVerifier {
    function verifyQuote(QuoteHeader calldata header, bytes calldata rawQuote, uint32 tcbEvalNumber)
        external
        view
        returns (bool, bytes memory);
}

/// @title DcapGate
/// @notice 链上验 DCAP quote，并把 quote 的 report_data[0:32] 绑定到"收据摘要"。
///         report_data 在 TDX v4 quote 中的固定偏移为 [568:632]（header 48 + tdReport 内 520）。
contract DcapGate {
    IQuoteVerifier public immutable verifier;
    uint32 public immutable tcbEvalNumber;

    error QuoteTooShort();

    constructor(address _verifier, uint32 _tcbEvalNumber) {
        verifier = IQuoteVerifier(_verifier);
        tcbEvalNumber = _tcbEvalNumber;
    }

    function header(bytes calldata rawQuote) public pure returns (QuoteHeader memory h) {
        if (rawQuote.length < 48) revert QuoteTooShort();
        // version 是小端 u16
        h.version = uint16(uint8(rawQuote[0])) | (uint16(uint8(rawQuote[1])) << 8);
        h.attestationKeyType = bytes2(rawQuote[2:4]);
        h.teeType = bytes4(rawQuote[4:8]);
        h.qeSvn = bytes2(rawQuote[8:10]);
        h.pceSvn = bytes2(rawQuote[10:12]);
        h.qeVendorId = bytes16(rawQuote[12:28]);
        h.userData = bytes20(rawQuote[28:48]);
    }

    /// @notice 从 quote 中提取我们要绑定的摘要 report_data[0:32]
    function reportDataDigest(bytes calldata rawQuote) public pure returns (bytes32) {
        if (rawQuote.length < 632) revert QuoteTooShort();
        return bytes32(rawQuote[568:600]);
    }

    function reportDataNonce(bytes calldata rawQuote) public pure returns (bytes32) {
        if (rawQuote.length < 632) revert QuoteTooShort();
        return bytes32(rawQuote[600:632]);
    }

    /// @notice 链上验证 quote 是否真实，且其 report_data 是否绑定到 expectedDigest
    function check(bytes calldata rawQuote, bytes32 expectedDigest)
        external
        view
        returns (bool verified, bool bound)
    {
        QuoteHeader memory h = header(rawQuote);
        (bool ok,) = verifier.verifyQuote(h, rawQuote, tcbEvalNumber);
        verified = ok;
        bound = ok && (reportDataDigest(rawQuote) == expectedDigest);
    }
}
