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
        // Security rule: never let a routine command put this on a production network.
        require(block.chainid != 1, "Deploy: refusing to deploy to Ethereum mainnet");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("CONTRACT_OWNER", deployer);
        bool claimOpen = vm.envOr("CLAIM_OPEN", true);
        bytes32 merkleRoot = _merkleRoot();

        require(merkleRoot != bytes32(0), "Deploy: merkle root is zero - run `npm run merkle`");

        console.log("chain id       ", block.chainid);
        console.log("deployer       ", deployer);
        console.log("owner          ", owner);
        console.log("claim open     ", claimOpen);
        console.log("merkle root    ", vm.toString(merkleRoot));

        vm.startBroadcast(deployerKey);
        nft = new CPSC3640NFT(owner, merkleRoot, claimOpen);
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
