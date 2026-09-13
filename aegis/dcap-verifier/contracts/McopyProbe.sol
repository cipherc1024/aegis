// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev 探测 Monad 是否支持 Cancun 的 MCOPY (EIP-5656)；loopBack 作为对照组
contract McopyProbe {
    function copyBack(bytes calldata input) external pure returns (bytes memory out) {
        out = new bytes(input.length);
        assembly {
            mcopy(add(out, 0x20), input.offset, input.length)
        }
    }

    function loopBack(bytes calldata input) external pure returns (bytes memory out) {
        out = new bytes(input.length);
        for (uint256 i = 0; i < input.length; i++) {
            out[i] = input[i];
        }
    }
}
