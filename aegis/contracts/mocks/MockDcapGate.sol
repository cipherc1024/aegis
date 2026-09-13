// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev 测试用假 DCAP 门
contract MockDcapGate {
    bool public verifiedResult = true;
    bool public boundResult = true;

    function set(bool v, bool b) external {
        verifiedResult = v;
        boundResult = b;
    }

    function check(bytes calldata, bytes32) external view returns (bool, bool) {
        return (verifiedResult, boundResult);
    }
}
