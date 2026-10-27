// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentVault.sol";
import "../src/MockUSDT.sol";

interface IWHSK { function deposit() external payable; function approve(address, uint256) external returns (bool); function transfer(address, uint256) external returns (bool); }
interface INPM {
    struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }
    function createAndInitializePoolIfNecessary(address, address, uint24, uint160) external payable returns (address);
    function mint(MintParams calldata) external payable returns (uint256, uint128, uint256, uint256);
}

/// HSK testnet (133) only: tUSDT + WHSK/tUSDT 0.3% pool on HSKSwap testnet at ~mainnet price ($0.0879), then AgentVault.
/// Env: PRIVATE_KEY (owner/deployer), AGENT (agent address). Amounts sized for one 0.1-HSK faucet drip.
contract TestnetSetup is Script {
    address constant WHSK = 0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6;
    address constant NPM = 0x73dEc6bfa6751509b08480bd97f54b874E3b20e8;
    address constant ROUTER = 0xa6914E66690c6794244B5f66a09eAEbf66254237;

    MockUSDT usdt;
    address pool;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT");
        uint256 lpHsk = vm.envOr("LP_HSK", uint256(0.06 ether));
        uint256 vaultHsk = vm.envOr("VAULT_HSK", uint256(0.02 ether));

        vm.startBroadcast(pk);
        usdt = new MockUSDT();
        usdt.mint(vm.addr(pk), 1_000e6);
        IWHSK(WHSK).deposit{value: lpHsk + vaultHsk}();
        _pool(vm.addr(pk), lpHsk);

        // Limits scaled to the test pool's depth (same shape as the mainnet config)
        AgentVault.Limits memory L = AgentVault.Limits({
            maxTradeQuote: 2_000,      // $0.002 per trade
            dailyVolumeQuote: 20_000,  // $0.02 per day
            maxTradesPerDay: 20,
            maxSlippageBps: 100,       // 1%
            cooldownSecs: 60,
            navFloorQuote: 500         // halt below $0.0005
        });
        AgentVault v = new AgentVault(ROUTER, pool, address(usdt), agent, L);
        IWHSK(WHSK).transfer(address(v), vaultHsk);
        usdt.transfer(address(v), 3_000); // $0.003
        payable(agent).transfer(0.005 ether); // agent gas
        vm.stopBroadcast();

        console.log("tUSDT", address(usdt));
        console.log("POOL", pool);
        console.log("VAULT", address(v));
    }

    function _pool(address me, uint256 lpHsk) internal {
        bool whsk0 = WHSK < address(usdt);
        (address t0, address t1) = whsk0 ? (WHSK, address(usdt)) : (address(usdt), WHSK);
        uint160 sqrtP = whsk0 ? uint160(23489513458998873948160) : uint160(267229959715573074556113582269923328);
        // +/- ~1.8% around $0.0879 (tick spacing 60) so a little test HSK still gives usable depth
        (int24 lo, int24 hi) = whsk0 ? (int24(-300840), int24(-300480)) : (int24(300420), int24(300780));
        pool = INPM(NPM).createAndInitializePoolIfNecessary(t0, t1, 3000, sqrtP);
        IWHSK(WHSK).approve(NPM, type(uint256).max);
        usdt.approve(NPM, type(uint256).max);
        uint256 usdtLp = 1e6; // NPM only takes what matches the WHSK side
        INPM(NPM).mint(INPM.MintParams(t0, t1, 3000, lo, hi,
            whsk0 ? lpHsk : usdtLp, whsk0 ? usdtLp : lpHsk, 0, 0, me, block.timestamp + 600));
    }
}
