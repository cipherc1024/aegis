// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev 测试用被调用合约：记录调用次数与数据。
contract MockTarget {
    uint256 public calls;
    bytes public lastData;

    function ping(uint256 x) external {
        calls += 1;
        lastData = abi.encode(x);
    }
}
