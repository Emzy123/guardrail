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
| AgentVault | `0xcC8AefAaCABDb503Be684f53e291ce2caD32C1f9` |
| Vault deploy tx | `0x30b032a45107e6199a4a08e93eaa4c1386b4d9f685ed23de3bb3082aad4fb81c` |
| WHSK/tUSDT 0.3% pool (HSKSwap testnet) | `0x56CD30c83e4397F373E76cE4692dEA536B127904` |
| tUSDT (test stablecoin, 6 dp) | `0xeDacD2eC060C1D4245Ea9e640d3995c6281b62A4` |
| WHSK (testnet) | `0xCA8aAceEC5Db1e91B9Ed3a344bA026c4a2B3ebF6` |
| HSKSwap SwapRouter02 (testnet) | `0xa6914E66690c6794244B5f66a09eAEbf66254237` |
| Owner | `0x0f077FAe383fA6625AC1C4EE1B0CE1C53eBd6Da9` |
| Agent | `0xCCAC4F9Bb38A695051b38A00b7Be14B81a125C8a` |

HSKSwap testnet had no stablecoin pool, so `TestnetSetup.s.sol` deploys a test USDT, opens a WHSK/tUSDT pool at the mainnet price (~$0.088) and deploys the vault with limits scaled to that pool ($0.002 max trade, $0.02/day, 60 s cooldown, 1 % slippage).

### Live test trades (2026-10-26, agent key, through the vault)
| # | What happened | Tx |
|---|---|---|
| 1 | Buy $0.001 of HSK: **filled** | [0xf341…d5e2](https://testnet-explorer.hsk.xyz/tx/0xf341002d746fbcf9bfcd66090dbd38b88afb1f97507d651ac981db89f693d5e2) |
| 2 | Buy $0.005, over the $0.002 cap: **blocked** in simulation (`TradeTooLarge`), never sent | none |
| 3 | Immediate second buy: sent, **reverted on-chain** by the vault's cooldown (same block as #1) | [0x9011…73b5](https://testnet-explorer.hsk.xyz/tx/0x901134c6718d56aec30adf5cc6786237bde6f083c62441f88c89b3bbabec73b5) |
| 4 | Sell 0.005 HSK after the 60 s cooldown: **filled** | [0x8b5d…c9f3](https://testnet-explorer.hsk.xyz/tx/0x8b5d414f868fe7fc0f78c3630f8e1105250ea40342d3ae296a1158ad5720c9f3) |
| 5 | Chat "emergency stop": agent **paused the vault** on-chain | [0xf1c1…b655](https://testnet-explorer.hsk.xyz/tx/0xf1c1f1aa71443efed8fd5e79819bd33ca41ebbe6d22eaeb73a9d21b6d1e4b655) |
| 6 | Owner unpaused (only the owner can) | [0x3fbb…3ffd](https://testnet-explorer.hsk.xyz/tx/0x3fbbdd7cf7b3b6c0e08e97f6bace9756b16f70b5329e6d44e163c7e0a9e73ffd) |

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
For testnet set `RPC_URL=https://testnet.hsk.xyz CHAIN_ID=133 POOL=0x56CD… QUOTE=0xeDac… BASE=0xCA8a…` (addresses above).

Chat commands: `status` · `show trades` · `risk 2%` · `stop loss 1.5%` · `take profit 4%` · `max exposure 40%` · `slippage 0.5%` · `be more conservative` · `stop` · `resume` · `emergency stop` (pauses the vault on-chain). Set `LLM_API_KEY` (any OpenAI-compatible endpoint) for free-form language.

## Repo
- `contracts/src/AgentVault.sol` — the vault
- `contracts/test/AgentVault.t.sol` — fork tests vs live HSK mainnet
- `contracts/script/` — mainnet deploy, testnet setup
- `agent/src/` — strategy, agent loop, chain client, chat, API
- `agent/web/index.html` — dashboard + chat

## Team
Emmanuel Ocheme Onucheojo (solo) · GitHub [Emzy123](https://github.com/Emzy123) · X [@Emmanuelryz](https://x.com/Emmanuelryz)
Available for the online demo on Nov 4.
