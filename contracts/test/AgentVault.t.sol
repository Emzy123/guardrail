// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentVault.sol";

/// Fork test against live HSKSwap on HSK Chain mainnet (chain 177).
/// Run: forge test --fork-url https://mainnet.hsk.xyz -vv
contract AgentVaultForkTest is Test {
    address constant ROUTER = 0x2c16f75b95Cf1390c328aB70e2CEE7f4b80bD8F3;
    address constant POOL = 0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC; // WHSK/USDT 0.3%
    address constant USDT = 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029;
    address constant WHSK = 0xB210D2120d57b758EE163cFfb43e73728c471Cf1;

    AgentVault vault;
    address agentKey = makeAddr("agent");
    address stranger = makeAddr("stranger");

    function setUp() public {
        AgentVault.Limits memory L = AgentVault.Limits({
            maxTradeQuote: 20e6,      // $20 per trade (USDT has 6 decimals)
            dailyVolumeQuote: 50e6,   // $50 per day
            maxTradesPerDay: 10,
            maxSlippageBps: 100,      // 1%
            cooldownSecs: 60,
            navFloorQuote: 90e6       // stop if vault value < $90
        });
        vault = new AgentVault(ROUTER, POOL, USDT, agentKey, L);
        deal(USDT, address(vault), 100e6); // $100 starting balance
    }

    function test_agentCanTradeWithinLimits() public {
        vm.prank(agentKey);
        uint256 out = vault.trade(USDT, 10e6, 100, "momentum up, buy $10 HSK");
        assertGt(out, 0);
        assertGt(IERC20(WHSK).balanceOf(address(vault)), 0);
        (, uint256 nav, uint256 vol, uint16 n,) = vault.status();
        assertGt(nav, 98e6); // lost no more than fee + slippage
        assertEq(vol, 10e6);
        assertEq(n, 1);
        emit log_named_uint("WHSK received (1e18)", out);
        emit log_named_uint("NAV after (USDT 1e6)", nav);
    }

    function test_sellBackRoundTrip() public {
        vm.prank(agentKey);
        uint256 got = vault.trade(USDT, 10e6, 100, "buy");
        vm.warp(block.timestamp + 61);
        vm.prank(agentKey);
        vault.trade(WHSK, got, 100, "take profit");
        assertEq(IERC20(WHSK).balanceOf(address(vault)), 0);
    }

    function test_revert_tradeTooLarge() public {
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TradeTooLarge.selector, 25e6, 20e6));
        vault.trade(USDT, 25e6, 100, "too big");
    }

    function test_revert_cooldown() public {
        vm.startPrank(agentKey);
        vault.trade(USDT, 5e6, 100, "1");
        vm.expectRevert();
        vault.trade(USDT, 5e6, 100, "2");
        vm.stopPrank();
    }

    function test_revert_slippageAboveCap() public {
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.SlippageTooHigh.selector, 500, 100));
        vault.trade(USDT, 5e6, 500, "yolo");
    }

    function test_revert_dailyVolume() public {
        vm.startPrank(agentKey);
        for (uint256 i; i < 2; i++) {
            vault.trade(USDT, 20e6, 100, "x");
            vm.warp(block.timestamp + 61);
        }
        vm.expectRevert(AgentVault.DailyVolumeExceeded.selector);
        vault.trade(USDT, 20e6, 100, "x");
        vm.stopPrank();
    }

    function test_revert_navFloor() public {
        AgentVault.Limits memory L = AgentVault.Limits(20e6, 50e6, 10, 100, 60, 99_990_000); // floor $99.99
        vault.setLimits(L);
        vm.prank(agentKey);
        vm.expectRevert(); // swap fee alone pushes NAV under the floor
        vault.trade(USDT, 20e6, 100, "would breach floor");
    }

    function test_killSwitch() public {
        vm.prank(agentKey);
        vault.pause("agent detected abnormal volatility");
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.IsPaused.selector);
        vault.trade(USDT, 5e6, 100, "x");
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.unpause();
        vault.unpause(); // owner
        assertFalse(vault.paused());
    }

    function test_onlyAgentTrades_onlyOwnerWithdraws() public {
        vm.prank(stranger);
        vm.expectRevert(AgentVault.NotAgent.selector);
        vault.trade(USDT, 5e6, 100, "x");
        vm.prank(agentKey);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.withdraw(USDT, 1, agentKey);
        vault.withdraw(USDT, 100e6, address(this));
        assertEq(IERC20(USDT).balanceOf(address(this)), 100e6);
    }
}
