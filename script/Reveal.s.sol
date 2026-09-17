// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CPSC3640NFT} from "../contracts/CPSC3640NFT.sol";

/// @title Reveal owner actions
/// @notice Run through `scripts/reveal.sh`, which checks the generated collection and
///         the upload before calling `publish`.
///
/// @dev Reads DEPLOYER_PRIVATE_KEY from the environment, like Deploy.s.sol, so the key
///      never appears on a command line. That account must own the contract.
///
///        forge script script/Reveal.s.sol --sig "publish(address,string,uint256)" \
///          <nft> ipfs://<cid>/ <count> --rpc-url <url> --broadcast
contract Reveal is Script {
    /// @notice Point tokens 1..`count` at `<uri><tokenId>.json`.
    function publish(CPSC3640NFT nft, string calldata uri, uint256 count) external {
        uint256 key = _ownerKey(nft);
        console.log("revealing tokens 1 ..", count);
        console.log("at                   ", uri);
        vm.broadcast(key);
        nft.setBaseURI(uri, count);
        _report(nft);
    }

    /// @notice Open or close claiming.
    function setClaimOpen(CPSC3640NFT nft, bool isOpen) external {
        uint256 key = _ownerKey(nft);
        vm.broadcast(key);
        nft.setClaimOpen(isOpen);
        _report(nft);
    }

    /// @notice Make the reveal permanent. Ends claiming for good.
    function freeze(CPSC3640NFT nft) external {
        uint256 key = _ownerKey(nft);
        vm.broadcast(key);
        nft.freezeMetadata();
        _report(nft);
    }

    function _ownerKey(CPSC3640NFT nft) internal view returns (uint256 key) {
        require(
            block.chainid == 11155111 || block.chainid == 31337,
            "Reveal: only Sepolia (11155111) or a local node (31337)"
        );
        require(address(nft).code.length > 0, "Reveal: no contract at that address on this chain");
        key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address sender = vm.addr(key);
        console.log("contract ", address(nft));
        console.log("sender   ", sender);
        require(sender == nft.owner(), "Reveal: DEPLOYER_PRIVATE_KEY is not the contract owner");
    }

    function _report(CPSC3640NFT nft) internal view {
        console.log("claim open     ", nft.claimOpen());
        console.log("total minted   ", nft.totalMinted());
        // The first deployment has none of the reveal state, and reading it would
        // revert, taking a plain open or close down with it.
        if (!nft.supportsInterface(0x49064906)) {
            console.log("reveal          not supported by this contract");
            return;
        }
        console.log("revealed count ", nft.revealedCount());
        console.log("base URI       ", nft.baseURI());
        console.log("frozen         ", nft.metadataFrozen());
    }
}
