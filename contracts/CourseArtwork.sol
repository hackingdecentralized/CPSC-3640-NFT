// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Immutable image bytes stored once as STOP-prefixed contract code.
/// @dev No callable functions or storage slots. CourseRenderer uses EXTCODECOPY.
contract CourseArtwork {
    error InvalidArtwork();

    constructor(bytes memory jpeg) {
        if (
            jpeg.length < 4 || jpeg.length > 24_575 || jpeg[0] != 0xff || jpeg[1] != 0xd8
                || jpeg[jpeg.length - 2] != 0xff || jpeg[jpeg.length - 1] != 0xd9
        ) revert InvalidArtwork();
        bytes memory data = bytes.concat(hex"00", jpeg);
        assembly ("memory-safe") {
            return(add(data, 32), mload(data))
        }
    }
}
