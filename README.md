# Guardrail — an AI trading agent that can't go rogue

**HSK Chain Horizon (India) · AI Agent Trading track**

Guardrail is an autonomous trading agent for HSKSwap on HSK Chain that you steer in plain English, with its risk limits enforced **on-chain** by a vault contract. The agent decides; the contract decides what it's *allowed* to do.

## The problem
AI trading agents are usually handed a hot wallet with full control of the funds. One bad prompt, buggy strategy, hallucinated number or leaked key can drain everything. Off-chain "risk settings" only protect you if the agent's own code honours them.

## The idea
Put the guardrails where the agent can't edit them: in a smart contract.

- The owner deposits funds into **AgentVault**.
- The agent key can only call `trade()`. It can never withdraw.
- Every trade is checked on-chain against the owner's limits and reverts if it breaks one.
- The agent writes its reason for every trade on-chain (`Traded` event), so its decisions can be audited.
- Either side can hit the kill switch; only the owner can turn trading back on.

## Architecture

```
 You ──chat──▶  Dashboard + chat (agent/web)          ── "cut risk to 2%", "stop", "status"
                     │  HTTP :8787
                     ▼
               Agent (TypeScript + viem)              ── reads HSKSwap pool price every tick
               • EMA trend strategy + stop-loss/take-profit
               • sizes trades by risk %, max exposure
               • LLM (optional) or rule parser turns chat into settings
               • simulates every trade before sending
                     │  trade(tokenIn, amount, slippage, rationale)
                     ▼
               AgentVault.sol (HSK Chain)             ── on-chain limits + kill switch
                     │  exactInputSingle
                     ▼
               HSKSwap (Uniswap V3) WHSK/USDT pool
```

## Risk controls (three layers)
| Layer | Controls |
|---|---|
| Strategy | stop-loss, take-profit, risk % per trade, max HSK exposure, minimum signal edge |
| Agent | simulates each trade first; logs blocked trades with the vault's reason (TradeTooLarge, Cooldown, NavBelowFloor…) |
| **Vault (on-chain)** | max trade size, daily volume cap, daily trade count, cooldown between trades, max slippage vs pool price, NAV floor (reverts any trade that leaves the vault below it), pause/kill switch, owner-only withdraw and unpause |

Known limit: slippage is checked against the pool's spot price, which can be manipulated within a block. A TWAP oracle check is the next upgrade.

## Deployed on HSK Chain testnet (chain 133)

Explorer: https://testnet-explorer.hsk.xyz

| What | Address / tx |
|---|---|
| AgentVault | `0xcdF8D8b5aD9AB07D8a5E15717E62b7936A360169` |
| Vault deploy tx | `0x583844edbe14327df0dd38253e377e17658a11d5c59c91226221733f2871bf2c` |
| WHSK/tUSDT 0.3% pool (HSKSwap testnet) | `0x56CD30c83e4397F373E76cE4692dEA536B127904` |
| tUSDT (test stablecoin, 6 dp) | `0xeDacD2eC060C1D4245Ea9e640d3995c6281b62A4` |
| WHSK (testnet) | `0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6` |
| HSKSwap SwapRouter02 (testnet) | `0xa6914E66690c6794244B5f66a09eAEbf66254237` |
| Owner | `0xEAa27e99Eb0119F9D4Fe65a5061F02eB830D1abf` |
| Agent | `0x4CB5B355E241827b0FF43D6ee3544ff09915Af4A` |

HSKSwap testnet had no stablecoin pool, so `TestnetSetup.s.sol` deploys a test USDT and opens a WHSK/tUSDT pool at the mainnet price (~$0.088). `TestnetVault.s.sol` deploys a vault on that pool with limits scaled to its depth ($0.002 max trade, $0.02/day, 60 s cooldown, 1 % slippage). An earlier vault (`0xcC8AefAaCABDb503Be684f53e291ce2caD32C1f9`, 2026-10-26) ran the same tests; its keys were rotated, so the current vault is the one above.

### Live test trades (2026-10-27, agent key, through the vault)

| # | What happened | Tx |
|---|---|---|
| 1 | Buy $0.001 of HSK: **filled** | [0xfbe9…3d98](https://testnet-explorer.hsk.xyz/tx/0xfbe95ff2eee8a5834e0a8491f8058da535f3d452606cb43cd04f0fc088933d98) |
| 2 | Buy $0.005, over the $0.002 cap: **blocked** by the vault in simulation (`TradeTooLarge`), never sent | none |
| 3 | Immediate second buy: **blocked** by the vault's 60 s cooldown in simulation, never sent | none |
| 4 | Sell 0.005 HSK after the cooldown: **filled** | [0x1a67…8f80](https://testnet-explorer.hsk.xyz/tx/0x1a6711a99ff88950aa924ea1e67272490b00a4e0dfd4486b8d8e8a003e248f80) |
| 5 | Chat "emergency stop": agent **paused the vault** on-chain | [0xf93d…e3c5](https://testnet-explorer.hsk.xyz/tx/0xf93d4c0a845c144ea90b7ac9c62a6f94306dddabd56ad9961f6f603993a1e3c5) |
| 6 | Owner unpaused (only the owner can) | [0xcb3d…0aa6](https://testnet-explorer.hsk.xyz/tx/0xcb3deeebd5a7197db12c19ca134da403fc898537dec52c3f87e06bc64e390aa6) |

On the 2026-10-26 run against the earlier vault, the cooldown case was sent and **reverted on-chain** ([0x9011…73b5](https://testnet-explorer.hsk.xyz/tx/0x901134c6718d56aec30adf5cc6786237bde6f083c62441f88c89b3bbabec73b5)), showing the contract enforces it even if the agent skips simulation.

Re-run: `cd agent && npx tsx src/testnet-trades.ts` with the testnet env.

## Mainnet (chain 177)
`script/Deploy.s.sol` targets the real HSKSwap WHSK/USDT 0.3 % pool (`0x4ff515761864e7838b0adb8b5b2b8b7a068905dc`) with $2 max trade, $10/day, 60 s cooldown, 1 % slippage, $4 NAV floor. Mainnet address: _added after deployment_.

## Run it

### Contracts (Foundry)
```
cd contracts
forge install foundry-rs/forge-std
forge test --fork-url https://mainnet.hsk.xyz -vv      # 9 tests against live HSKSwap, no funds needed

# testnet: pool + vault in one go
PRIVATE_KEY=0x... AGENT=0x... forge script script/TestnetSetup.s.sol --rpc-url https://testnet.hsk.xyz --broadcast
# mainnet
PRIVATE_KEY=0x... AGENT=0x... forge script script/Deploy.s.sol --rpc-url https://mainnet.hsk.xyz --broadcast
```

### Agent + dashboard
```
cd agent
npm install
cp .env.example .env        # MODE=paper simulates; MODE=live needs VAULT_ADDRESS + AGENT_PRIVATE_KEY
set -a; . ./.env; set +a
npm start                   # open http://localhost:8787
```
For testnet set `VAULT_ADDRESS=0xcdF8D8b5aD9AB07D8a5E15717E62b7936A360169 RPC_URL=https://testnet.hsk.xyz CHAIN_ID=133 POOL=0x56CD… QUOTE=0xeDac… BASE=0xCA8a…` (addresses above).

Chat commands: `status` · `show trades` · `risk 2%` · `stop loss 1.5%` · `take profit 4%` · `max exposure 40%` · `slippage 0.5%` · `be more conservative` · `stop` · `resume` · `emergency stop` (pauses the vault on-chain). Set `LLM_API_KEY` (any OpenAI-compatible endpoint) for free-form language.

## Repo
- `contracts/src/AgentVault.sol` — the vault
- `contracts/test/AgentVault.t.sol` — fork tests vs live HSK mainnet
- `contracts/script/` — mainnet deploy, testnet pool setup, testnet vault
- `agent/src/` — strategy, agent loop, chain client, chat, API
- `agent/web/index.html` — dashboard + chat

## Team
Emmanuel Ocheme Onucheojo (solo) · GitHub [Emzy123](https://github.com/Emzy123) · X [@Emmanuelryz](https://x.com/Emmanuelryz)
Available for the online demo on Nov 4.
