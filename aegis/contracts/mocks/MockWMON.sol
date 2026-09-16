// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev 测试用 WMON mock：deposit() 记账式 wrap（1:1，无 ERC20 转账，只记余额供断言）。
contract MockWMON {
    mapping(address => uint256) public balanceOf;
    uint256 public totalWrapped;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalWrapped += msg.value;
    }

    receive() external payable {}
}
