// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentVault.sol";

/// Testnet first: forge script script/Deploy.s.sol --rpc-url hsk_testnet --broadcast
/// (testnet needs testnet ROUTER/POOL/QUOTE env vars)
/// Mainnet:       forge script script/Deploy.s.sol --rpc-url hsk --broadcast
/// Env: PRIVATE_KEY (owner), AGENT (agent wallet address)
/// Optional env: ROUTER, POOL, QUOTE (default = HSKSwap mainnet WHSK/USDT 0.3%)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT");
        address router = vm.envOr("ROUTER", address(0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3));
        address pool = vm.envOr("POOL", address(0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC));
        address quote = vm.envOr("QUOTE", address(0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029));

        AgentVault.Limits memory L = AgentVault.Limits({
            maxTradeQuote: 2e6,     // $2 per trade
            dailyVolumeQuote: 10e6, // $10 per day
            maxTradesPerDay: 20,
            maxSlippageBps: 100,    // 1%
            cooldownSecs: 60,
            navFloorQuote: 4e6      // halt below $4
        });

        vm.startBroadcast(pk);
        AgentVault v = new AgentVault(router, pool, quote, agent, L);
        vm.stopBroadcast();
        console.log("AgentVault deployed at", address(v));
    }
}
