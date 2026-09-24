// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Six shared base cards, three small decorations, and a claim number.
/// @dev No owner, setters, external URLs, or mutable rendering rules. The draw is
///      public and predictable. The NFT supplies its permanent original claimer.
contract CourseRenderer {
    using Strings for uint256;
    error InvalidArtwork(uint256 index);
    event DesignWeights(uint256[6] weights);
    uint256 private constant COMMON_WEIGHT = 19;
    uint256 private constant HANDSOME_DAN_WEIGHT = 5;
    address[6] public artwork;

    struct Traits {
        uint8 design;
        uint8 accent;
        uint8 symbol;
        bool orbit;
    }

    constructor(address[6] memory images) {
        for (uint256 i; i < 6; i++) {
            bytes memory code = images[i].code;
            if (
                code.length < 5 || code.length > 24_576 || code[0] != 0 || code[1] != 0xff || code[2] != 0xd8
                    || code[code.length - 2] != 0xff || code[code.length - 1] != 0xd9
            ) revert InvalidArtwork(i);
            artwork[i] = images[i];
        }
        // The deployment record uses these actual on-chain weights for previews.
        emit DesignWeights([
                COMMON_WEIGHT, COMMON_WEIGHT, COMMON_WEIGHT, COMMON_WEIGHT, COMMON_WEIGHT, HANDSOME_DAN_WEIGHT
            ]);
    }

    function traits(uint256 tokenId, address claimer) public pure returns (Traits memory t) {
        uint256 seed = uint256(keccak256(abi.encode("CPSC3640-onchain-v1", claimer, tokenId)));
        // Rolls 0..94 give five cards 19 slots each; 95..99 give Dan 5 slots.
        uint256 roll = seed % (5 * COMMON_WEIGHT + HANDSOME_DAN_WEIGHT);
        t.design = roll < 5 * COMMON_WEIGHT ? uint8(roll / COMMON_WEIGHT) : 5;
        t.accent = uint8((seed >> 64) % 4);
        t.symbol = uint8((seed >> 128) % 3);
        t.orbit = (seed >> 192) % 2 == 1;
    }

    function designName(uint256 design) public pure returns (string memory) {
        string[6] memory names = [
            "Harkness Tower",
            "Elm Tree",
            "Sterling Memorial Library",
            "Beinecke Library",
            "Yale Shield",
            "Handsome Dan"
        ];
        return names[design];
    }

    function accentName(uint256 accent) public pure returns (string memory) {
        string[4] memory names = ["Gold", "Cyan", "Lavender", "Mint"];
        return names[accent];
    }

    function symbolName(uint256 symbol) public pure returns (string memory) {
        string[3] memory names = ["Book", "Chain", "Spark"];
        return names[symbol];
    }

    function rawImage(uint256 design) public view returns (bytes memory image) {
        address source = artwork[design];
        image = new bytes(source.code.length - 1);
        assembly ("memory-safe") {
            extcodecopy(source, add(image, 32), 1, mload(image))
        }
    }

    function _color(uint256 accent) private pure returns (string memory) {
        string[4] memory colors = ["#e8b65c", "#65dce8", "#c4a1ff", "#8de4ba"];
        return colors[accent];
    }

    function _symbol(uint256 symbol) private pure returns (string memory) {
        if (symbol == 0) {
            return "<path d='M-25-18Q-12-24 0-15Q12-24 25-18V20Q12 14 0 23Q-12 14-25 20ZM0-15V23'/>";
        }
        if (symbol == 1) {
            return "<g transform='rotate(-35)'><rect x='-28' y='-12' width='34' height='24' rx='12'/><rect x='-6' y='-12' width='34' height='24' rx='12'/></g>";
        }
        return "<path d='M0-28L7-7L28 0L7 7L0 28L-7 7L-28 0L-7-7Z'/>";
    }

    function imageURI(uint256 tokenId, address claimer) public view returns (string memory) {
        Traits memory t = traits(tokenId, claimer);
        string memory color = _color(t.accent);
        // Keep decorations outside the course text and central illustration.
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1254 1254' width='1254' height='1254'>",
            "<image width='1254' height='1254' href='data:image/jpeg;base64,",
            Base64.encode(rawImage(t.design)),
            "'/>"
        );
        svg = string.concat(
            svg,
            "<g stroke='",
            color,
            "' fill='none' stroke-width='4'>",
            "<rect x='22' y='22' width='1210' height='1210' rx='42'/>",
            "<path d='M54 100V54H100M1154 54H1200V100M54 1154V1200H100M1154 1200H1200V1154'/></g>",
            "<g transform='translate(109 1104)'><circle r='43' fill='#101724' stroke='",
            color,
            "' stroke-width='3'/>",
            t.orbit
                ? string.concat(
                    "<circle r='53' fill='none' stroke='",
                    color,
                    "' stroke-width='2' stroke-dasharray='7 9'/>"
                )
                : "",
            "<g fill='none' stroke='",
            color,
            "' stroke-width='3.5' stroke-linejoin='round'>",
            _symbol(t.symbol),
            "</g></g>"
        );
        svg = string.concat(
            svg,
            "<rect x='969' y='1068' width='226' height='72' rx='36' fill='#101724' stroke='",
            color,
            "' stroke-width='3'/>",
            "<text x='1082' y='1115' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' font-size='30' font-weight='700' fill='",
            color,
            "'>No. ",
            tokenId.toString(),
            "</text></svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function tokenURI(uint256 tokenId, address claimer) external view returns (string memory) {
        Traits memory t = traits(tokenId, claimer);
        string memory json = string.concat(
            '{"name":"CPSC 3640/5400 - Fall 2026 #',
            tokenId.toString(),
            '","description":"A course collectible, not an official academic credential. Artwork and metadata are stored on-chain.",',
            '"attributes":[{"trait_type":"Course","value":"CPSC 3640/5400"},',
            '{"trait_type":"Semester","value":"Fall 2026"},',
            '{"trait_type":"Type","value":"Course NFT"},',
            '{"trait_type":"Network","value":"Ethereum"},',
            '{"trait_type":"Claim Number","display_type":"number","value":',
            tokenId.toString(),
            "},"
        );
        json = string.concat(
            json,
            '{"trait_type":"Base Template","value":"',
            designName(t.design),
            '"},',
            '{"trait_type":"Accent","value":"',
            accentName(t.accent),
            '"},',
            '{"trait_type":"Symbol","value":"',
            symbolName(t.symbol),
            '"},',
            '{"trait_type":"Orbit","value":"',
            t.orbit ? "Yes" : "No",
            '"}',
            "]"
        );
        json = string.concat(json, ',"image":"', imageURI(tokenId, claimer), '"}');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
