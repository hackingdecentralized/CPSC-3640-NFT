// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {CourseArtwork} from "./CourseArtwork.sol";

/// @title CPSC 3640/5400 Course NFT
/// @notice A course collectible for CPSC 3640 / CPSC 5400 --
///         Decentralized Payments, Contracts, and Finance for Humans and AI, Fall 2026.
/// @dev Artwork and metadata are stored entirely on-chain: `tokenURI` returns a
///      Base64 `data:application/json` URI whose `image` field is a Base64
///      `data:image/webp` URI. Nothing depends on IPFS or on any web server, so a
///      minted token keeps valid metadata even if the claim website disappears.
///
///      This is a collectible, NOT an official academic credential.
contract CPSC3640NFT is ERC721, Ownable {
    using Strings for uint256;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Claiming is currently closed by the owner.
    error ClaimClosed();
    /// @notice This address has already claimed its one token.
    error AlreadyClaimed();
    /// @notice The supplied Merkle proof does not prove membership in the allowlist.
    error InvalidProof();
    /// @notice No Merkle root has been configured, so nobody can be eligible yet.
    error MerkleRootNotSet();
    /// @notice Deployment was attempted on a chain this contract is not meant for.
    error UnsupportedChain(uint256 chainId);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted once per successful claim. `account` is indexed so the claim
    ///         website can recover a wallet's token id by querying logs.
    event Claimed(address indexed account, uint256 indexed tokenId);
    /// @notice Emitted when the owner replaces the allowlist Merkle root.
    event MerkleRootUpdated(bytes32 indexed previousRoot, bytes32 indexed newRoot);
    /// @notice Emitted when the owner opens or closes claiming.
    event ClaimOpenUpdated(bool isOpen);
    /// @notice Emitted when the owner turns the allowlist requirement on or off.
    event AllowlistEnabledUpdated(bool isEnabled);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Root of the Merkle tree over allowlisted addresses.
    /// @dev Leaves use the OpenZeppelin StandardMerkleTree encoding:
    ///      `keccak256(bytes.concat(keccak256(abi.encode(account))))`, with
    ///      commutative (sorted) pair hashing. `allowlist/generate-merkle.ts`
    ///      builds the tree with exactly this encoding.
    bytes32 public merkleRoot;

    /// @notice Whether claiming is currently open.
    bool public claimOpen;

    /// @notice Whether a Merkle proof is required to claim.
    /// @dev When false, any address may claim one token. The one-per-wallet rule still
    ///      holds, but nothing stops one person using several wallets, so an open claim
    ///      is a collectible handed to whoever finds the page, not a roster of students.
    bool public allowlistEnabled;

    /// @notice Records which addresses have already claimed. Enforces one per wallet.
    mapping(address => bool) public hasClaimed;

    /// @notice Number of tokens minted so far. Token ids are 1..totalMinted.
    uint256 public totalMinted;

    // ---------------------------------------------------------------------
    // Where this contract is allowed to exist
    // ---------------------------------------------------------------------

    /// @notice Ethereum Sepolia, the network this course runs on.
    uint256 public constant SEPOLIA = 11155111;
    /// @notice Anvil's default chain id, so the local demo and the tests still work.
    uint256 public constant LOCAL = 31337;

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param initialOwner Address that may update the root and open/close claiming.
    /// @param initialMerkleRoot Allowlist root; may be `bytes32(0)` and set later.
    /// @param initialClaimOpen Whether claiming starts open.
    /// @param requireAllowlist Whether a Merkle proof is required. Pass false to let
    ///        anyone claim one token.
    constructor(
        address initialOwner,
        bytes32 initialMerkleRoot,
        bool initialClaimOpen,
        bool requireAllowlist
    )
        ERC721("CPSC 3640/5400 Course NFT", "CPSC3640")
        Ownable(initialOwner)
    {
        // The course runs on Sepolia, and deployment is the only moment that can be
        // enforced for good. Scripts and config files can be edited or bypassed with a
        // direct `forge create`; this check cannot. Anything that is not Sepolia or a
        // local node - mainnet, an L2, another testnet - is refused here.
        if (block.chainid != SEPOLIA && block.chainid != LOCAL) {
            revert UnsupportedChain(block.chainid);
        }

        merkleRoot = initialMerkleRoot;
        claimOpen = initialClaimOpen;
        allowlistEnabled = requireAllowlist;
        emit MerkleRootUpdated(bytes32(0), initialMerkleRoot);
        emit ClaimOpenUpdated(initialClaimOpen);
        emit AllowlistEnabledUpdated(requireAllowlist);
    }

    // ---------------------------------------------------------------------
    // Claiming
    // ---------------------------------------------------------------------

    /// @notice Claim the one course NFT allocated to `msg.sender`.
    /// @dev Eligibility is enforced here, on-chain. The website's `proofs.json` is a
    ///      convenience for building `proof`; it grants nothing on its own.
    /// @param proof Merkle proof that `msg.sender` is in the allowlist.
    function claim(bytes32[] calldata proof) external {
        if (!claimOpen) revert ClaimClosed();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        if (allowlistEnabled) {
            bytes32 root = merkleRoot;
            if (root == bytes32(0)) revert MerkleRootNotSet();
            if (!MerkleProof.verifyCalldata(proof, root, _leaf(msg.sender))) revert InvalidProof();
        }

        // Effects before interactions: `_safeMint` calls back into the receiver.
        hasClaimed[msg.sender] = true;
        uint256 tokenId = ++totalMinted;

        _safeMint(msg.sender, tokenId);
        emit Claimed(msg.sender, tokenId);
    }

    /// @notice Whether `account` could claim right now, ignoring the proof.
    /// @dev A convenience read for the website. Never a substitute for `claim`'s checks.
    function canClaim(address account) external view returns (bool) {
        if (!claimOpen || hasClaimed[account]) return false;
        return !allowlistEnabled || merkleRoot != bytes32(0);
    }

    /// @notice Check a proof without sending a transaction.
    function isEligible(address account, bytes32[] calldata proof) external view returns (bool) {
        if (!allowlistEnabled) return true;
        bytes32 root = merkleRoot;
        if (root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, root, _leaf(account));
    }

    /// @dev OpenZeppelin StandardMerkleTree leaf: double-hashed ABI encoding of the
    ///      address. The second hash makes internal-node preimages impossible to forge
    ///      as leaves.
    function _leaf(address account) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account))));
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Replace the allowlist root, e.g. after enrollment changes.
    function setMerkleRoot(bytes32 newRoot) external onlyOwner {
        bytes32 previous = merkleRoot;
        merkleRoot = newRoot;
        emit MerkleRootUpdated(previous, newRoot);
    }

    /// @notice Open or close claiming.
    function setClaimOpen(bool isOpen) external onlyOwner {
        claimOpen = isOpen;
        emit ClaimOpenUpdated(isOpen);
    }

    /// @notice Require a Merkle proof, or let anyone claim.
    /// @dev Turning this off opens the collection to any address that finds the page.
    ///      Turning it back on does not revoke tokens already claimed.
    function setAllowlistEnabled(bool isEnabled) external onlyOwner {
        allowlistEnabled = isEnabled;
        emit AllowlistEnabledUpdated(isEnabled);
    }

    // ---------------------------------------------------------------------
    // On-chain metadata
    // ---------------------------------------------------------------------

    /// @notice Fully on-chain ERC-721 metadata for `tokenId`.
    /// @return A `data:application/json;base64,...` URI embedding the SVG artwork.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory json = string.concat(
            '{"name":"CPSC 3640/5400 - Fall 2026 #',
            tokenId.toString(),
            '","description":"Decentralized Payments, Contracts, and Finance for Humans and AI. ',
            "Fall 2026. A course collectible, not an official academic credential.",
            '","attributes":[',
            '{"trait_type":"Course","value":"CPSC 3640/5400"},',
            '{"trait_type":"Semester","value":"Fall 2026"},',
            '{"trait_type":"Type","value":"Course NFT"},',
            '{"trait_type":"Network","value":"Ethereum"},',
            '{"trait_type":"Claim Number","display_type":"number","value":',
            tokenId.toString(),
            "}",
            '],"image":"',
            imageURI(tokenId),
            '"}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The artwork for `tokenId`, with its claim number stamped on it.
    /// @dev The stored artwork is one fixed image. The per-token badge is composited
    ///      here, at read time, by wrapping that image in an SVG and drawing the number
    ///      over it. Every token therefore has a distinct image without storing a
    ///      distinct image, and without anything being uploaded anywhere.
    function imageURI(uint256 tokenId) public pure returns (string memory) {
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1254 1254' width='1254' height='1254'>",
            "<image width='1254' height='1254' href='data:image/webp;base64,",
            Base64.encode(CourseArtwork.image()),
            "'/>",
            "<g><rect x='985' y='1068' width='184' height='72' rx='36' fill='#17161c' ",
            "fill-opacity='0.88' stroke='#e8a33d' stroke-width='3'/>",
            "<text x='1077' y='1115' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' ",
            "font-size='34' font-weight='700' fill='#e8a33d' letter-spacing='2'>No. ",
            tokenId.toString(),
            "</text></g></svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    /// @notice The raw image bytes of the artwork.
    /// @dev Byte-for-byte identical to `nft/course-nft-onchain.webp`, which
    ///      `scripts/make-onchain-image.py` derives from the master artwork in
    ///      `nft/course-nft.svg`. `test/CPSC3640NFT.t.sol` reads the file and asserts
    ///      they match, so the two cannot silently drift. Regenerate the Solidity copy
    ///      with `npm run embed:image`.
    function rawImage() public pure returns (bytes memory) {
        return CourseArtwork.image();
    }
}
