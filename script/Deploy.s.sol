// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CPSC3640NFT} from "../contracts/CPSC3640NFT.sol";

/// @title Deploy CPSC3640NFT
/// @notice Deploys the course NFT with the Merkle root produced by
///         `allowlist/generate-merkle.ts`.
///
/// @dev Reads from the environment (see `.env.example`):
///        DEPLOYER_PRIVATE_KEY  required, the broadcasting account
///        MERKLE_ROOT           optional, overrides allowlist/generated/root.json
///        CONTRACT_OWNER        optional, defaults to the deployer
///        CLAIM_OPEN            optional, defaults to true
///        REQUIRE_ALLOWLIST     optional, defaults to false: anyone may claim one
///                              token. Set true to require a Merkle proof.
///
///      Local Anvil:
///        forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
///      Sepolia:
///        forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
///
///      Afterwards run `node scripts/save-deployment.mjs sepolia` to record the
///      address, block and transaction hash in deployments/sepolia.json.
contract Deploy is Script {
    function run() external returns (CPSC3640NFT nft) {
        // Fail here, with a readable message, before anything is broadcast. The
        // contract's own constructor enforces the same rule and is the real backstop.
        require(
            block.chainid == 11155111 || block.chainid == 31337,
            "Deploy: this contract only deploys to Sepolia (11155111) or a local node (31337)"
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("CONTRACT_OWNER", deployer);
        bool claimOpen = vm.envOr("CLAIM_OPEN", true);
        bool requireAllowlist = vm.envOr("REQUIRE_ALLOWLIST", false);
        bytes32 merkleRoot = requireAllowlist ? _merkleRoot() : bytes32(0);

        require(
            !requireAllowlist || merkleRoot != bytes32(0),
            "Deploy: merkle root is zero - run `npm run merkle`"
        );

        console.log("chain id       ", block.chainid);
        console.log("deployer       ", deployer);
        console.log("balance (wei)  ", deployer.balance);
        require(deployer.balance > 0, "Deploy: the deployer has no ETH on this network - fund it from a faucet first");
        console.log("owner          ", owner);
        console.log("claim open     ", claimOpen);
        console.log("allowlist      ", requireAllowlist ? "required" : "OFF - anyone may claim");
        console.log("merkle root    ", vm.toString(merkleRoot));

        vm.startBroadcast(deployerKey);
        nft = new CPSC3640NFT(owner, merkleRoot, claimOpen, requireAllowlist);
        vm.stopBroadcast();

        console.log("CPSC3640NFT    ", address(nft));
        console.log("bytecode bytes ", address(nft).code.length);
    }

    /// @dev MERKLE_ROOT wins if set; otherwise use whatever the generator last wrote.
    function _merkleRoot() internal view returns (bytes32) {
        bytes32 fromEnv = vm.envOr("MERKLE_ROOT", bytes32(0));
        if (fromEnv != bytes32(0)) return fromEnv;

        string memory json = vm.readFile("allowlist/generated/root.json");
        return vm.parseJsonBytes32(json, ".merkleRoot");
    }
}
