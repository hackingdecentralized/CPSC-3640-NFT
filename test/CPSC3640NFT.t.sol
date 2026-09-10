// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CPSC3640NFT} from "../contracts/CPSC3640NFT.sol";

/// @dev Minimal Base64 decoder, used to prove `tokenURI` really carries decodable
///      Base64 rather than checking that it merely starts with the right prefix.
library Base64Decode {
    function decode(string memory input) internal pure returns (bytes memory) {
        bytes memory data = bytes(input);
        if (data.length == 0) return new bytes(0);
        require(data.length % 4 == 0, "base64: length not a multiple of 4");

        uint256 padding;
        if (data[data.length - 1] == "=") padding++;
        if (data[data.length - 2] == "=") padding++;

        bytes memory result = new bytes((data.length / 4) * 3 - padding);
        uint256 j;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint256 chunk = (_value(data[i]) << 18) | (_value(data[i + 1]) << 12)
                | (_value(data[i + 2]) << 6) | _value(data[i + 3]);
            if (j < result.length) result[j++] = bytes1(uint8(chunk >> 16));
            if (j < result.length) result[j++] = bytes1(uint8((chunk >> 8) & 0xFF));
            if (j < result.length) result[j++] = bytes1(uint8(chunk & 0xFF));
        }
        return result;
    }

    function _value(bytes1 c) private pure returns (uint256) {
        uint8 ch = uint8(c);
        if (ch >= 65 && ch <= 90) return ch - 65; // A-Z
        if (ch >= 97 && ch <= 122) return ch - 71; // a-z
        if (ch >= 48 && ch <= 57) return ch + 4; // 0-9
        if (ch == 43) return 62; // +
        if (ch == 47) return 63; // /
        if (ch == 61) return 0; // = padding
        revert("base64: invalid character");
    }
}

/// @dev A contract with no `onERC721Received`, used to show `_safeMint` refuses to
///      strand a token in something that cannot handle it.
contract NonReceiver {}

contract CPSC3640NFTTest is Test {
    /// @dev Mirrors the contract's event so `vm.expectEmit` can match on it.
    event Claimed(address indexed account, uint256 indexed tokenId);
    event MerkleRootUpdated(bytes32 indexed previousRoot, bytes32 indexed newRoot);
    event ClaimOpenUpdated(bool isOpen);

    /// @dev Anvil account #2. Deliberately absent from addresses.example.json.
    address internal constant NOT_ALLOWLISTED = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    CPSC3640NFT internal nft;
    address internal owner = makeAddr("owner");

    bytes32 internal merkleRoot;
    address[] internal allowlisted;
    bytes32[][] internal proofs;

    // -----------------------------------------------------------------------
    // Fixture: the tree comes from allowlist/generate-merkle.ts, not from Solidity.
    // If the JS leaf encoding or pair ordering ever stops matching the contract,
    // every claim test below fails.
    // -----------------------------------------------------------------------

    function setUp() public {
        string memory json = vm.readFile("allowlist/generated/example-tree.json");
        merkleRoot = vm.parseJsonBytes32(json, ".merkleRoot");

        for (uint256 i = 0; i < 5; i++) {
            string memory base = string.concat(".entries[", vm.toString(i), "]");
            allowlisted.push(vm.parseJsonAddress(json, string.concat(base, ".address")));
            proofs.push(vm.parseJsonBytes32Array(json, string.concat(base, ".proof")));
        }

        nft = new CPSC3640NFT(owner, merkleRoot, true);
    }

    // -----------------------------------------------------------------------
    // Claiming
    // -----------------------------------------------------------------------

    function test_EligibleAddressCanClaim() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        assertEq(nft.ownerOf(1), allowlisted[0], "token 1 should belong to the claimer");
        assertEq(nft.balanceOf(allowlisted[0]), 1);
        assertTrue(nft.hasClaimed(allowlisted[0]));
        assertEq(nft.totalMinted(), 1);
    }

    function test_IneligibleAddressCannotClaim() public {
        bytes32[] memory empty = new bytes32[](0);

        vm.prank(NOT_ALLOWLISTED);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(empty);

        // Borrowing a real proof from an allowlisted wallet does not help either:
        // the leaf is derived from msg.sender, not from anything the caller supplies.
        vm.prank(NOT_ALLOWLISTED);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(proofs[0]);

        assertEq(nft.totalMinted(), 0, "no token should have been minted");
    }

    function test_InvalidProofFails() public {
        bytes32[] memory tampered = proofs[0];
        tampered[0] = bytes32(uint256(tampered[0]) ^ 1);

        vm.prank(allowlisted[0]);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(tampered);
    }

    function test_SameAddressCannotClaimTwice() public {
        vm.startPrank(allowlisted[0]);
        nft.claim(proofs[0]);

        vm.expectRevert(CPSC3640NFT.AlreadyClaimed.selector);
        nft.claim(proofs[0]);
        vm.stopPrank();

        assertEq(nft.balanceOf(allowlisted[0]), 1, "still exactly one token");
        assertEq(nft.totalMinted(), 1);
    }

    function test_DifferentEligibleAddressesGetDifferentTokenIds() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        vm.prank(allowlisted[1]);
        nft.claim(proofs[1]);
        vm.prank(allowlisted[2]);
        nft.claim(proofs[2]);

        assertEq(nft.ownerOf(1), allowlisted[0]);
        assertEq(nft.ownerOf(2), allowlisted[1]);
        assertEq(nft.ownerOf(3), allowlisted[2]);
        assertEq(nft.totalMinted(), 3);
    }

    function test_FirstTokenIdIsOne() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 0));
        nft.ownerOf(0);
        assertEq(nft.ownerOf(1), allowlisted[0]);
    }

    function test_ClaimedEventHasCorrectValues() public {
        vm.expectEmit(true, true, false, false);
        emit Claimed(allowlisted[1], 1);

        vm.prank(allowlisted[1]);
        nft.claim(proofs[1]);
    }

    function test_ClaimFailsWhileClaimingIsClosed() public {
        vm.prank(owner);
        nft.setClaimOpen(false);

        vm.prank(allowlisted[0]);
        vm.expectRevert(CPSC3640NFT.ClaimClosed.selector);
        nft.claim(proofs[0]);
    }

    function test_ClaimFailsWhenRootUnset() public {
        CPSC3640NFT fresh = new CPSC3640NFT(owner, bytes32(0), true);

        vm.prank(allowlisted[0]);
        vm.expectRevert(CPSC3640NFT.MerkleRootNotSet.selector);
        fresh.claim(proofs[0]);
    }

    function test_SafeMintRejectsNonReceiverContract() public {
        NonReceiver receiver = new NonReceiver();

        // A one-leaf Merkle tree: the root IS the leaf, so the proof is empty.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(address(receiver)))));
        vm.prank(owner);
        nft.setMerkleRoot(leaf);

        vm.prank(address(receiver));
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(receiver))
        );
        nft.claim(new bytes32[](0));
    }

    function test_TokensAreTransferable() public {
        address friend = makeAddr("friend");

        vm.startPrank(allowlisted[0]);
        nft.claim(proofs[0]);
        nft.transferFrom(allowlisted[0], friend, 1);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), friend);
        // Transferring away does not buy a second claim.
        vm.prank(allowlisted[0]);
        vm.expectRevert(CPSC3640NFT.AlreadyClaimed.selector);
        nft.claim(proofs[0]);
    }

    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

    function test_CanClaimAndIsEligibleViews() public {
        assertTrue(nft.canClaim(allowlisted[0]));
        assertTrue(nft.isEligible(allowlisted[0], proofs[0]));
        assertFalse(nft.isEligible(NOT_ALLOWLISTED, proofs[0]));

        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        assertFalse(nft.canClaim(allowlisted[0]), "already claimed");

        vm.prank(owner);
        nft.setClaimOpen(false);
        assertFalse(nft.canClaim(allowlisted[1]), "claiming closed");
    }

    // -----------------------------------------------------------------------
    // Administration
    // -----------------------------------------------------------------------

    function test_OwnerCanUpdateMerkleRoot() public {
        bytes32 newRoot = keccak256("a different roster");

        vm.expectEmit(true, true, false, false);
        emit MerkleRootUpdated(merkleRoot, newRoot);

        vm.prank(owner);
        nft.setMerkleRoot(newRoot);
        assertEq(nft.merkleRoot(), newRoot);
    }

    function test_NonOwnerCannotUpdateMerkleRoot() public {
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        nft.setMerkleRoot(keccak256("hostile"));

        assertEq(nft.merkleRoot(), merkleRoot, "root must be unchanged");
    }

    function test_NonOwnerCannotToggleClaiming() public {
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        nft.setClaimOpen(false);

        assertTrue(nft.claimOpen());
    }

    function test_OwnerCanReopenClaiming() public {
        vm.startPrank(owner);
        nft.setClaimOpen(false);
        assertFalse(nft.claimOpen());
        nft.setClaimOpen(true);
        vm.stopPrank();

        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        assertEq(nft.ownerOf(1), allowlisted[0]);
    }

    function test_RootRotationChangesWhoCanClaim() public {
        vm.prank(owner);
        nft.setMerkleRoot(keccak256("a different roster"));

        vm.prank(allowlisted[0]);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(proofs[0]);

        vm.prank(owner);
        nft.setMerkleRoot(merkleRoot);

        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        assertEq(nft.ownerOf(1), allowlisted[0]);
    }

    // -----------------------------------------------------------------------
    // On-chain metadata
    // -----------------------------------------------------------------------

    function test_TokenURIRevertsBeforeMint() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        nft.tokenURI(1);
    }

    function test_TokenURIExistsAfterMint() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        string memory uri = nft.tokenURI(1);
        assertGt(bytes(uri).length, 0);
        assertTrue(_startsWith(uri, "data:application/json;base64,"), "wrong JSON data URI prefix");
    }

    function test_TokenURIIsValidBase64Json() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        string memory json = _decodedMetadata(1);

        // vm.parseJson reverts on malformed JSON, so reaching these asserts is itself
        // proof that the decoded payload parses.
        assertEq(vm.parseJsonString(json, ".name"), "CPSC 3640/5400 - Fall 2026 #1");
        assertEq(vm.parseJsonString(json, ".attributes[0].trait_type"), "Course");
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), "CPSC 3640/5400");
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Fall 2026");
        assertEq(vm.parseJsonString(json, ".attributes[2].value"), "Course NFT");
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Ethereum");
        assertGt(bytes(vm.parseJsonString(json, ".description")).length, 0);
    }

    function test_TokenIdAppearsInMetadataName() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        vm.prank(allowlisted[1]);
        nft.claim(proofs[1]);

        assertEq(vm.parseJsonString(_decodedMetadata(2), ".name"), "CPSC 3640/5400 - Fall 2026 #2");
    }

    function test_MetadataContainsSvgDataUri() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        string memory image = vm.parseJsonString(_decodedMetadata(1), ".image");
        assertTrue(_startsWith(image, "data:image/svg+xml;base64,"), "wrong image data URI prefix");

        string memory encoded = _slice(image, bytes("data:image/svg+xml;base64,").length);
        string memory svg = string(Base64Decode.decode(encoded));

        assertTrue(_startsWith(svg, "<svg"), "decoded image should be SVG markup");
        assertEq(svg, nft.rawSVG(), "decoded image must equal the contract's SVG");
    }

    /// @notice The SVG compiled into the contract must match `nft/course-nft.svg`.
    /// @dev This is what stops the human-editable artwork and the on-chain copy from
    ///      drifting. If it fails, run `npm run embed:svg`.
    function test_EmbeddedSvgMatchesSourceFile() public view {
        bytes memory file = bytes(vm.readFile("nft/course-nft.svg"));

        // The file ends with a newline; the Solidity constant does not.
        uint256 length = file.length;
        if (length > 0 && file[length - 1] == "\n") length--;

        bytes memory trimmed = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            trimmed[i] = file[i];
        }

        assertEq(
            keccak256(trimmed),
            keccak256(bytes(nft.rawSVG())),
            "nft/course-nft.svg and the embedded SVG differ - run `npm run embed:svg`"
        );
    }

    // -----------------------------------------------------------------------
    // Deployment shape
    // -----------------------------------------------------------------------

    function test_CollectionNameAndSymbol() public view {
        assertEq(nft.name(), "CPSC 3640/5400 Course NFT");
        assertEq(nft.symbol(), "CPSC3640");
        assertEq(nft.owner(), owner);
        assertEq(nft.merkleRoot(), merkleRoot);
        assertTrue(nft.claimOpen());
    }

    function test_BytecodeFitsContractSizeLimit() public {
        uint256 size = address(nft).code.length;
        emit log_named_uint("runtime bytecode size (bytes)", size);
        assertLt(size, 24576, "contract exceeds the EIP-170 limit");
    }

    function test_ThereIsNoPayableClaim() public {
        vm.deal(allowlisted[0], 1 ether);
        vm.prank(allowlisted[0]);
        (bool ok,) = address(nft).call{value: 1 ether}(
            abi.encodeWithSignature("claim(bytes32[])", proofs[0])
        );
        assertFalse(ok, "claim must not accept ETH");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _decodedMetadata(uint256 tokenId) internal view returns (string memory) {
        string memory uri = nft.tokenURI(tokenId);
        string memory encoded = _slice(uri, bytes("data:application/json;base64,").length);
        return string(Base64Decode.decode(encoded));
    }

    function _startsWith(string memory subject, string memory prefix) internal pure returns (bool) {
        bytes memory s = bytes(subject);
        bytes memory p = bytes(prefix);
        if (s.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }

    function _slice(string memory subject, uint256 from) internal pure returns (string memory) {
        bytes memory s = bytes(subject);
        bytes memory out = new bytes(s.length - from);
        for (uint256 i = from; i < s.length; i++) {
            out[i - from] = s[i];
        }
        return string(out);
    }
}
