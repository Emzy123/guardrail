// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentVault.sol";
import "../src/MockUSDT.sol";

interface IWHSK2 { function deposit() external payable; function transfer(address, uint256) external returns (bool); }

/// HSK testnet (133): deploy a fresh AgentVault on the existing WHSK/tUSDT pool (from TestnetSetup).
/// Env: PRIVATE_KEY (owner), AGENT. Needs ~0.03 test HSK.
contract TestnetVault is Script {
    address constant WHSK = 0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6;
    address constant ROUTER = 0xa6914E66690c6794244B5f66a09eAEbf66254237;
    address constant POOL = 0x56CD30c83e4397F373E76cE4692dEA536B127904;
    address constant TUSDT = 0xeDacD2eC060C1D4245Ea9e640d3995c6281b62A4;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT");
        uint256 vaultHsk = vm.envOr("VAULT_HSK", uint256(0.02 ether));
        vm.startBroadcast(pk);
        AgentVault.Limits memory L = AgentVault.Limits({
            maxTradeQuote: 2_000, dailyVolumeQuote: 20_000, maxTradesPerDay: 20,
            maxSlippageBps: 100, cooldownSecs: 60, navFloorQuote: 500
        });
        AgentVault v = new AgentVault(ROUTER, POOL, TUSDT, agent, L);
        IWHSK2(WHSK).deposit{value: vaultHsk}();
        IWHSK2(WHSK).transfer(address(v), vaultHsk);
        MockUSDT(TUSDT).mint(address(v), 3_000); // $0.003
        payable(agent).transfer(0.005 ether);
        vm.stopBroadcast();
        console.log("VAULT", address(v));
    }
}
