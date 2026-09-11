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

        nft = new CPSC3640NFT(owner, merkleRoot, true, true);
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
        CPSC3640NFT fresh = new CPSC3640NFT(owner, bytes32(0), true, true);

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
    // Chain pinning
    // -----------------------------------------------------------------------

    function test_CannotDeployToAnotherChain() public {
        uint256[3] memory foreign = [uint256(1), uint256(8453), uint256(137)]; // mainnet, Base, Polygon

        for (uint256 i = 0; i < foreign.length; i++) {
            vm.chainId(foreign[i]);
            vm.expectRevert(
                abi.encodeWithSelector(CPSC3640NFT.UnsupportedChain.selector, foreign[i])
            );
            new CPSC3640NFT(owner, merkleRoot, true, true);
        }
    }

    function test_DeploysOnSepoliaAndLocal() public {
        vm.chainId(11155111);
        assertEq(new CPSC3640NFT(owner, merkleRoot, true, true).owner(), owner, "Sepolia");

        vm.chainId(31337);
        assertEq(new CPSC3640NFT(owner, merkleRoot, true, true).owner(), owner, "local");
    }

    // -----------------------------------------------------------------------
    // Claiming without an allowlist
    // -----------------------------------------------------------------------

    function test_OpenClaimLetsAnyoneClaimOnce() public {
        CPSC3640NFT open = new CPSC3640NFT(owner, bytes32(0), true, false);
        bytes32[] memory none = new bytes32[](0);

        assertFalse(open.allowlistEnabled());

        vm.prank(NOT_ALLOWLISTED);
        open.claim(none);
        assertEq(open.ownerOf(1), NOT_ALLOWLISTED, "an address off the roster may claim");

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        open.claim(none);
        assertEq(open.ownerOf(2), stranger);

        // One per wallet still holds. That is the only limit left.
        vm.prank(NOT_ALLOWLISTED);
        vm.expectRevert(CPSC3640NFT.AlreadyClaimed.selector);
        open.claim(none);
    }

    function test_OpenClaimIgnoresAnyProofSupplied() public {
        CPSC3640NFT open = new CPSC3640NFT(owner, bytes32(0), true, false);

        bytes32[] memory junk = new bytes32[](2);
        junk[0] = keccak256("nonsense");
        junk[1] = keccak256("more nonsense");

        vm.prank(NOT_ALLOWLISTED);
        open.claim(junk);
        assertEq(open.ownerOf(1), NOT_ALLOWLISTED);
    }

    function test_OwnerCanTurnTheAllowlistOffAndOn() public {
        bytes32[] memory none = new bytes32[](0);

        // On by default here: a stranger is refused.
        vm.prank(NOT_ALLOWLISTED);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(none);

        vm.prank(owner);
        nft.setAllowlistEnabled(false);

        vm.prank(NOT_ALLOWLISTED);
        nft.claim(none);
        assertEq(nft.ownerOf(1), NOT_ALLOWLISTED);

        // Turning it back on refuses new strangers but does not revoke what was claimed.
        vm.prank(owner);
        nft.setAllowlistEnabled(true);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(CPSC3640NFT.InvalidProof.selector);
        nft.claim(none);

        assertEq(nft.ownerOf(1), NOT_ALLOWLISTED, "an existing token survives");
    }

    function test_NonOwnerCannotTurnTheAllowlistOff() public {
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        nft.setAllowlistEnabled(false);

        assertTrue(nft.allowlistEnabled());
    }

    function test_OpenClaimStillRespectsClaimClosed() public {
        CPSC3640NFT open = new CPSC3640NFT(owner, bytes32(0), true, false);

        vm.prank(owner);
        open.setClaimOpen(false);

        vm.prank(NOT_ALLOWLISTED);
        vm.expectRevert(CPSC3640NFT.ClaimClosed.selector);
        open.claim(new bytes32[](0));
    }

    function test_EligibilityViewsWhenOpen() public {
        CPSC3640NFT open = new CPSC3640NFT(owner, bytes32(0), true, false);

        assertTrue(open.canClaim(NOT_ALLOWLISTED));
        assertTrue(open.isEligible(NOT_ALLOWLISTED, new bytes32[](0)));

        vm.prank(NOT_ALLOWLISTED);
        open.claim(new bytes32[](0));
        assertFalse(open.canClaim(NOT_ALLOWLISTED), "already claimed");
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

    function test_MetadataContainsImageDataUri() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);

        string memory image = vm.parseJsonString(_decodedMetadata(1), ".image");
        assertTrue(_startsWith(image, "data:image/svg+xml;base64,"), "wrong image data URI prefix");

        string memory svg =
            string(Base64Decode.decode(_slice(image, bytes("data:image/svg+xml;base64,").length)));

        assertTrue(_startsWith(svg, "<svg"), "decoded image should be SVG markup");
        assertTrue(_contains(svg, "data:image/webp;base64,"), "SVG should embed the WebP artwork");
        assertTrue(_contains(svg, ">No. 1</text>"), "SVG should carry this token's claim number");
    }

    /// @notice Each token's image is composited at read time, so every claim gets its
    ///         own artwork without a single extra byte being stored.
    function test_EachTokenGetsItsOwnClaimNumber() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        vm.prank(allowlisted[1]);
        nft.claim(proofs[1]);

        assertTrue(_contains(_decodedImage(1), ">No. 1</text>"));
        assertTrue(_contains(_decodedImage(2), ">No. 2</text>"));

        assertTrue(
            keccak256(bytes(nft.imageURI(1))) != keccak256(bytes(nft.imageURI(2))),
            "two tokens must not share an image"
        );
    }

    function test_ClaimNumberIsASortableAttribute() public {
        vm.prank(allowlisted[0]);
        nft.claim(proofs[0]);
        vm.prank(allowlisted[1]);
        nft.claim(proofs[1]);

        string memory json = _decodedMetadata(2);
        assertEq(vm.parseJsonString(json, ".attributes[4].trait_type"), "Claim Number");
        assertEq(vm.parseJsonString(json, ".attributes[4].display_type"), "number");
        assertEq(vm.parseJsonUint(json, ".attributes[4].value"), 2);
    }

    /// @notice The image compiled into the contract must match the file on disk.
    /// @dev This is what stops the committed artwork and the on-chain copy from
    ///      drifting. If it fails, run `npm run embed:image`.
    function test_EmbeddedImageMatchesSourceFile() public view {
        bytes memory file = vm.readFileBinary("nft/course-nft-onchain.webp");

        assertEq(
            keccak256(file),
            keccak256(nft.rawImage()),
            "nft/course-nft-onchain.webp and the embedded image differ - run `npm run embed:image`"
        );
    }

    /// @notice The artwork must leave room for the contract under EIP-170.
    function test_ArtworkStaysWithinBudget() public {
        uint256 artwork = nft.rawImage().length;
        emit log_named_uint("artwork bytes", artwork);
        assertLt(artwork, 17_000, "artwork has outgrown its on-chain budget");
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

    function _decodedImage(uint256 tokenId) internal view returns (string memory) {
        string memory image = vm.parseJsonString(_decodedMetadata(tokenId), ".image");
        return string(Base64Decode.decode(_slice(image, bytes("data:image/svg+xml;base64,").length)));
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || h.length < n.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
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
