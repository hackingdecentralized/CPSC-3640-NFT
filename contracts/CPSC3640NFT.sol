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
        "<linearGradient id='fur' x1='0' y1='0' x2='0' y2='1'>\n"
        "<stop offset='0' stop-color='#fbf8f2'/><stop offset='0.55' stop-color='#f1e9dc'/><stop offset='1' stop-color='#ded1bb'/>\n"
        "</linearGradient>\n"
        "<linearGradient id='snout' x1='0' y1='0' x2='0' y2='1'>\n"
        "<stop offset='0' stop-color='#fefcf8'/><stop offset='1' stop-color='#ebe0ce'/>\n"
        "</linearGradient>\n"
        "<linearGradient id='snoot' x1='0' y1='0' x2='0' y2='1'>\n"
        "<stop offset='0' stop-color='#3a3944'/><stop offset='0.45' stop-color='#1c1c23'/><stop offset='1' stop-color='#0c0c10'/>\n"
        "</linearGradient>\n"
        "<linearGradient id='earfur' x1='0' y1='0' x2='0' y2='1'>\n"
        "<stop offset='0' stop-color='#a06c45'/><stop offset='1' stop-color='#66401f'/>\n"
        "</linearGradient>\n"
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
        "<circle cx='512' cy='490' r='254' fill='url(#halo)'/>\n"
        "\n"
        "<g stroke='#5e3a26' stroke-width='3'>\n"
        "<path d='M406 360 C380 344 348 354 342 380 C336 408 358 426 386 420 C387 398 394 376 406 360 Z' fill='url(#earfur)'/>\n"
        "<path d='M618 360 C644 344 676 354 682 380 C688 408 666 426 638 420 C637 398 630 376 618 360 Z' fill='url(#earfur)'/>\n"
        "</g>\n"
        "<g fill='#c08f68' opacity='0.7'>\n"
        "<path d='M399 374 C382 364 362 372 358 389 C355 404 368 414 383 410 C384 397 391 383 399 374 Z'/>\n"
        "<path d='M625 374 C642 364 662 372 666 389 C669 404 656 414 641 410 C640 397 633 383 625 374 Z'/>\n"
        "</g>\n"
        "\n"
        "<path d='M452 330 C490 322 534 322 572 330 C622 340 654 372 668 418 C688 470 698 518 696 558 C692 608 654 640 598 654 C570 660 542 662 512 662 C482 662 454 660 426 654 C370 640 332 608 328 558 C326 518 336 470 356 418 C370 372 402 340 452 330 Z' fill='url(#fur)' stroke='#c2b7a4' stroke-width='2.5'/>\n"
        "\n"
        "<path d='M592 396 C552 398 532 426 534 458 C536 492 562 514 600 512 C638 510 662 482 660 448 C658 414 632 394 592 396 Z' fill='#a3714b' opacity='0.82'/>\n"
        "<path d='M592 396 C552 398 532 426 534 458 C540 442 556 424 582 416 C608 408 640 414 656 432 C650 410 626 394 592 396 Z' fill='#b98a63' opacity='0.5'/>\n"
        "\n"
        "<g fill='none' stroke='#c7b79f' stroke-linecap='round' opacity='0.6'>\n"
        "<path d='M512 384 V424' stroke-width='7'/>\n"
        "<path d='M400 416 C432 390 470 390 496 414' stroke-width='7'/>\n"
        "<path d='M624 416 C592 390 554 390 528 414' stroke-width='7'/>\n"
        "<path d='M362 480 C350 504 349 530 358 552' stroke-width='5'/>\n"
        "<path d='M662 480 C674 504 675 530 666 552' stroke-width='5'/>\n"
        "</g>\n"
        "<g fill='none' stroke='#fbf6ea' stroke-linecap='round' opacity='0.6'>\n"
        "<path d='M512 380 V420' stroke-width='4.5'/>\n"
        "<path d='M400 411 C432 385 470 385 496 409' stroke-width='4.5'/>\n"
        "<path d='M624 411 C592 385 554 385 528 409' stroke-width='4.5'/>\n"
        "<path d='M362 475 C350 499 349 525 358 547' stroke-width='3.5'/>\n"
        "<path d='M662 475 C674 499 675 525 666 547' stroke-width='3.5'/>\n"
        "</g>\n"
        "\n"
        "<g fill='#1d1510'>\n"
        "<ellipse cx='430' cy='456' rx='17' ry='16'/><ellipse cx='594' cy='456' rx='17' ry='16'/>\n"
        "</g>\n"
        "<g fill='#ffffff'>\n"
        "<circle cx='436' cy='450' r='5.5'/><circle cx='600' cy='450' r='5.5'/>\n"
        "</g>\n"
        "<g fill='#ffffff' opacity='0.45'>\n"
        "<circle cx='424' cy='463' r='2.6'/><circle cx='588' cy='463' r='2.6'/>\n"
        "</g>\n"
        "\n"
        "<path d='M512 472 C578 472 626 502 630 542 C634 580 628 608 606 626 C584 644 548 646 530 628 C522 620 516 614 512 608 C508 614 502 620 494 628 C476 646 440 644 418 626 C396 608 390 580 394 542 C398 502 446 472 512 472 Z' fill='url(#snout)' stroke='#c2b7a4' stroke-width='2'/>\n"
        "\n"
        "<path d='M512 486 C550 486 572 503 572 521 C572 542 544 556 512 556 C480 556 452 542 452 521 C452 503 474 486 512 486 Z' fill='url(#snoot)'/>\n"
        "<ellipse cx='492' cy='501' rx='13' ry='5' fill='#ffffff' opacity='0.12' transform='rotate(-14 492 501)'/>\n"
        "<g fill='#3d3c49'>\n"
        "<ellipse cx='489' cy='523' rx='6' ry='8.5' transform='rotate(-20 489 523)'/>\n"
        "<ellipse cx='535' cy='523' rx='6' ry='8.5' transform='rotate(20 535 523)'/>\n"
        "</g>\n"
        "\n"
        "<g fill='none' stroke='#8d8275' stroke-linecap='round'>\n"
        "<path d='M512 558 V590' stroke-width='5'/>\n"
        "<path d='M512 590 C488 584 456 590 428 606' stroke-width='4.5'/>\n"
        "<path d='M512 590 C536 584 568 590 596 606' stroke-width='4.5'/>\n"
        "</g>\n"
        "<g fill='#ffffff'>\n"
        "<path d='M474 598 L484 572 L494 598 Z'/><path d='M530 598 L540 572 L550 598 Z'/>\n"
        "</g>\n"
        "<path d='M496 592 C496 622 528 622 528 592 Z' fill='#ef7f96'/>\n"
        "<path d='M502 597 C502 613 522 613 522 597 Z' fill='#ffffff' opacity='0.18'/>\n"
        "\n"
        "<rect x='402' y='664' width='220' height='34' rx='12' fill='#242129' stroke='#6fbf9b' stroke-width='3'/>\n"
        "<g fill='none' stroke='#6fbf9b' stroke-width='2.5'>\n"
        "<rect x='442' y='671' width='17' height='17' rx='4'/>\n"
        "<rect x='482' y='671' width='17' height='17' rx='4'/>\n"
        "<rect x='522' y='671' width='17' height='17' rx='4'/>\n"
        "<rect x='562' y='671' width='17' height='17' rx='4'/>\n"
        "<path d='M459 679 H482'/><path d='M499 679 H522'/><path d='M539 679 H562'/>\n"
        "</g>\n"
        "\n"
        "<g font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-weight='600' fill='#f6f0e4'>\n"
        "<rect x='118' y='706' width='196' height='74' rx='37' fill='#272430' stroke='#e8a33d' stroke-width='2.5'/>\n"
        "<text x='216' y='752' text-anchor='middle' font-size='26' letter-spacing='4'>HUMAN</text>\n"
        "<rect x='372' y='706' width='280' height='74' rx='16' fill='#242129' stroke='#6fbf9b' stroke-width='2.5'/>\n"
        "<text x='512' y='738' text-anchor='middle' font-size='23' letter-spacing='3'>BLOCKCHAIN</text>\n"
        "<text x='512' y='766' text-anchor='middle' font-size='23' letter-spacing='3'>CONTRACT</text>\n"
        "<rect x='710' y='706' width='196' height='74' rx='37' fill='#2e2415' stroke='#e8a33d' stroke-width='2.5'/>\n"
        "<text x='808' y='754' text-anchor='middle' font-size='30' fill='#f7dfae' letter-spacing='10'>AI</text>\n"
        "</g>\n"
        "<g stroke='#6fbf9b' stroke-width='3' fill='#6fbf9b'>\n"
        "<path d='M332 743 H354' stroke-linecap='round'/>\n"
        "<path d='M341 734 L326 743 L341 752 Z' stroke='none'/><path d='M345 734 L360 743 L345 752 Z' stroke='none'/>\n"
        "</g>\n"
        "<g stroke='#e8a33d' stroke-width='3' fill='#e8a33d'>\n"
        "<path d='M670 743 H692' stroke-linecap='round'/>\n"
        "<path d='M679 734 L664 743 L679 752 Z' stroke='none'/><path d='M683 734 L698 743 L683 752 Z' stroke='none'/>\n"
        "</g>\n"
        "\n"
        "<line x1='336' y1='832' x2='688' y2='832' stroke='url(#edge)' stroke-width='2.5'/>\n"
        "<text x='512' y='894' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='46' font-weight='700' fill='#f6f0e4' letter-spacing='12'>FALL 2026</text>\n"
        "<text x='512' y='936' text-anchor='middle' font-family='Helvetica Neue,Helvetica,Arial,sans-serif' font-size='20' fill='#7d7466' letter-spacing='7'>COURSE NFT</text>\n"
        "</svg>";
        // <<< END GENERATED SVG
    }
}
