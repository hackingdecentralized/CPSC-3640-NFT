// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CPSC 3640/5400 Course NFT
/// @notice A course collectible for CPSC 3640 / CPSC 5400 --
///         Decentralized Payments, Contracts, and Finance for Humans and AI, Fall 2026.
/// @dev Artwork and metadata are stored entirely on-chain: `tokenURI` returns a
///      Base64 `data:application/json` URI whose `image` field is a Base64
///      `data:image/svg+xml` URI. Nothing depends on IPFS or on any web server, so a
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

    /// @notice Records which addresses have already claimed. Enforces one per wallet.
    mapping(address => bool) public hasClaimed;

    /// @notice Number of tokens minted so far. Token ids are 1..totalMinted.
    uint256 public totalMinted;

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param initialOwner Address that may update the root and open/close claiming.
    /// @param initialMerkleRoot Allowlist root; may be `bytes32(0)` and set later.
    /// @param initialClaimOpen Whether claiming starts open.
    constructor(address initialOwner, bytes32 initialMerkleRoot, bool initialClaimOpen)
        ERC721("CPSC 3640/5400 Course NFT", "CPSC3640")
        Ownable(initialOwner)
    {
        merkleRoot = initialMerkleRoot;
        claimOpen = initialClaimOpen;
        emit MerkleRootUpdated(bytes32(0), initialMerkleRoot);
        emit ClaimOpenUpdated(initialClaimOpen);
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

        bytes32 root = merkleRoot;
        if (root == bytes32(0)) revert MerkleRootNotSet();
        if (!MerkleProof.verifyCalldata(proof, root, _leaf(msg.sender))) revert InvalidProof();

        // Effects before interactions: `_safeMint` calls back into the receiver.
        hasClaimed[msg.sender] = true;
        uint256 tokenId = ++totalMinted;

        _safeMint(msg.sender, tokenId);
        emit Claimed(msg.sender, tokenId);
    }

    /// @notice Whether `account` could claim right now, ignoring the proof.
    /// @dev A convenience read for the website. Never a substitute for `claim`'s checks.
    function canClaim(address account) external view returns (bool) {
        return claimOpen && !hasClaimed[account] && merkleRoot != bytes32(0);
    }

    /// @notice Check a proof without sending a transaction.
    function isEligible(address account, bytes32[] calldata proof) external view returns (bool) {
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
            '{"trait_type":"Network","value":"Ethereum"}',
            '],"image":"',
            imageURI(),
            '"}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The artwork as a self-contained `data:image/svg+xml;base64,...` URI.
    function imageURI() public pure returns (string memory) {
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(rawSVG())));
    }

    /// @notice The raw SVG source of the artwork.
    /// @dev Byte-for-byte identical to `nft/course-nft.svg` (minus that file's trailing
    ///      newline). `test/CPSC3640NFT.t.sol` reads the file and asserts they match, so
    ///      the two cannot silently drift. Regenerate with `npm run embed:svg`.
    function rawSVG() public pure returns (string memory) {
        return
        // >>> BEGIN GENERATED SVG -- do not edit by hand
        "<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024' viewBox='0 0 1024 1024' role='img' aria-label='CPSC 3640/5400 Course NFT, Fall 2026'>\n"
        "<defs>\n"
        "<linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>\n"
        "<stop offset='0' stop-color='#17161c'/><stop offset='0.55' stop-color='#211f28'/><stop offset='1' stop-color='#15141a'/>\n"
        "</linearGradient>\n"
        "<linearGradient id='edge' x1='0' y1='0' x2='1' y2='0'>\n"
        "<stop offset='0' stop-color='#e8a33d'/><stop offset='1' stop-color='#6fbf9b'/>\n"
        "</linearGradient>\n"
        "<radialGradient id='halo' cx='0.5' cy='0.5' r='0.5'>\n"
        "<stop offset='0' stop-color='#e8a33d' stop-opacity='0.22'/><stop offset='1' stop-color='#e8a33d' stop-opacity='0'/>\n"
        "</radialGradient>\n"
        "<pattern id='grid' width='64' height='64' patternUnits='userSpaceOnUse'>\n"
        "<circle cx='1' cy='1' r='1.4' fill='#e8a33d' opacity='0.20'/>\n"
        "</pattern>\n"
        "</defs>\n"
        "\n"
        "<rect width='1024' height='1024' fill='url(#bg)'/>\n"
        "<rect width='1024' height='1024' fill='url(#grid)'/>\n"
        "<rect x='34' y='34' width='956' height='956' rx='26' fill='none' stroke='url(#edge)' stroke-width='2' opacity='0.55'/>\n"
        "<rect x='48' y='48' width='928' height='928' rx='18' fill='none' stroke='#e8a33d' stroke-width='1' opacity='0.18'/>\n"
        "\n"
        "<g stroke='#6fbf9b' stroke-width='1.2' opacity='0.28' fill='none'>\n"
        "<path d='M48 330 H150 L196 284 V220'/><path d='M976 330 H874 L828 284 V220'/>\n"
        "<path d='M48 690 H150 L196 736 V806'/><path d='M976 690 H874 L828 736 V806'/>\n"
        "</g>\n"
        "<g fill='#6fbf9b' opacity='0.5'>\n"
        "<circle cx='196' cy='284' r='4'/><circle cx='828' cy='284' r='4'/>\n"
        "<circle cx='196' cy='736' r='4'/><circle cx='828' cy='736' r='4'/>\n"
        "</g>\n"
        "\n"
        "<text x='512' y='146' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='58' font-weight='700' fill='#f6f0e4' letter-spacing='2'>CPSC 3640 / CPSC 5400</text>\n"
        "<line x1='336' y1='174' x2='688' y2='174' stroke='url(#edge)' stroke-width='2.5'/>\n"
        "<text x='512' y='222' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='31' fill='#bdb2a0'>Decentralized Payments,</text>\n"
        "<text x='512' y='262' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='31' fill='#bdb2a0'>Contracts, and Finance</text>\n"
        "\n"
        "<circle cx='512' cy='460' r='252' fill='url(#halo)'/>\n"
        "\n"
        "<g fill='#8d5a3c' stroke='#5e3a26' stroke-width='3'>\n"
        "<path d='M396 340 C352 330 328 358 334 396 C338 424 356 440 380 440 C376 406 382 368 396 340 Z'/>\n"
        "<path d='M628 340 C672 330 696 358 690 396 C686 424 668 440 644 440 C648 406 642 368 628 340 Z'/>\n"
        "</g>\n"
        "\n"
        "<path d='M512 310 C586 310 644 344 658 396 C668 434 666 464 658 488 C688 510 692 558 662 586 C634 610 576 622 512 622 C448 622 390 610 362 586 C332 558 336 510 366 488 C358 464 356 434 366 396 C380 344 438 310 512 310 Z' fill='#f4eee6' stroke='#c9bfae' stroke-width='2.5'/>\n"
        "\n"
        "<g fill='none' stroke='#d9cec0' stroke-width='4.5' stroke-linecap='round'>\n"
        "<path d='M416 396 C444 374 470 374 494 392'/>\n"
        "<path d='M608 396 C580 374 554 374 530 392'/>\n"
        "<path d='M512 364 V394'/>\n"
        "<path d='M386 446 C372 466 370 490 378 508'/>\n"
        "<path d='M638 446 C652 466 654 490 646 508'/>\n"
        "</g>\n"
        "\n"
        "<g fill='#16233a'>\n"
        "<ellipse cx='446' cy='432' rx='19' ry='17'/><ellipse cx='578' cy='432' rx='19' ry='17'/>\n"
        "</g>\n"
        "<g fill='#ffffff' opacity='0.9'>\n"
        "<circle cx='453' cy='426' r='6'/><circle cx='585' cy='426' r='6'/>\n"
        "</g>\n"
        "\n"
        "<path d='M512 470 C576 470 618 498 618 538 C618 578 570 602 512 602 C454 602 406 578 406 538 C406 498 448 470 512 470 Z' fill='#fbf7f1' stroke='#c9bfae' stroke-width='2'/>\n"
        "<g fill='none' stroke='#d9cec0' stroke-width='3.5' stroke-linecap='round'>\n"
        "<path d='M450 516 C424 542 416 572 422 596'/>\n"
        "<path d='M574 516 C600 542 608 572 602 596'/>\n"
        "</g>\n"
        "\n"
        "<path d='M512 476 C548 476 570 490 570 507 C570 527 544 538 512 538 C480 538 454 527 454 507 C454 490 476 476 512 476 Z' fill='#191920'/>\n"
        "<g fill='#4a4a58'>\n"
        "<ellipse cx='490' cy='505' rx='6.5' ry='9' transform='rotate(-18 490 505)'/>\n"
        "<ellipse cx='534' cy='505' rx='6.5' ry='9' transform='rotate(18 534 505)'/>\n"
        "</g>\n"
        "\n"
        "<g fill='none' stroke='#8d8275' stroke-width='4.5' stroke-linecap='round'>\n"
        "<path d='M512 538 V562'/>\n"
        "<path d='M512 562 C482 590 438 586 422 556'/>\n"
        "<path d='M512 562 C542 590 586 586 602 556'/>\n"
        "</g>\n"
        "<g fill='#ffffff'>\n"
        "<path d='M478 566 L486 546 L494 566 Z'/><path d='M530 566 L538 546 L546 566 Z'/>\n"
        "</g>\n"
        "<path d='M494 568 C494 592 530 592 530 568 Z' fill='#ff8fa3'/>\n"
        "\n"
        "<rect x='396' y='628' width='232' height='44' rx='15' fill='#242129' stroke='#6fbf9b' stroke-width='3'/>\n"
        "<g fill='none' stroke='#6fbf9b' stroke-width='2.5'>\n"
        "<rect x='430' y='639' width='22' height='22' rx='5'/>\n"
        "<rect x='476' y='639' width='22' height='22' rx='5'/>\n"
        "<rect x='522' y='639' width='22' height='22' rx='5'/>\n"
        "<rect x='568' y='639' width='22' height='22' rx='5'/>\n"
        "<path d='M452 650 H476'/><path d='M498 650 H522'/><path d='M544 650 H568'/>\n"
        "</g>\n"
        "\n"
        "<g font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-weight='600' fill='#f6f0e4'>\n"
        "<rect x='118' y='702' width='196' height='74' rx='37' fill='#272430' stroke='#e8a33d' stroke-width='2.5'/>\n"
        "<text x='216' y='748' text-anchor='middle' font-size='26' letter-spacing='4'>HUMAN</text>\n"
        "<rect x='372' y='702' width='280' height='74' rx='16' fill='#242129' stroke='#6fbf9b' stroke-width='2.5'/>\n"
        "<text x='512' y='734' text-anchor='middle' font-size='23' letter-spacing='3'>BLOCKCHAIN</text>\n"
        "<text x='512' y='762' text-anchor='middle' font-size='23' letter-spacing='3'>CONTRACT</text>\n"
        "<rect x='710' y='702' width='196' height='74' rx='37' fill='#2e2415' stroke='#e8a33d' stroke-width='2.5'/>\n"
        "<text x='808' y='750' text-anchor='middle' font-size='30' fill='#f7dfae' letter-spacing='10'>AI</text>\n"
        "</g>\n"
        "<g stroke='#6fbf9b' stroke-width='3' fill='#6fbf9b'>\n"
        "<path d='M332 739 H354' stroke-linecap='round'/>\n"
        "<path d='M341 730 L326 739 L341 748 Z' stroke='none'/><path d='M345 730 L360 739 L345 748 Z' stroke='none'/>\n"
        "</g>\n"
        "<g stroke='#e8a33d' stroke-width='3' fill='#e8a33d'>\n"
        "<path d='M670 739 H692' stroke-linecap='round'/>\n"
        "<path d='M679 730 L664 739 L679 748 Z' stroke='none'/><path d='M683 730 L698 739 L683 748 Z' stroke='none'/>\n"
        "</g>\n"
        "\n"
        "<line x1='336' y1='832' x2='688' y2='832' stroke='url(#edge)' stroke-width='2.5'/>\n"
        "<text x='512' y='894' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='46' font-weight='700' fill='#f6f0e4' letter-spacing='12'>FALL 2026</text>\n"
        "<text x='512' y='936' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='20' fill='#7d7466' letter-spacing='7'>COURSE NFT</text>\n"
        "</svg>";
        // <<< END GENERATED SVG
    }
}
