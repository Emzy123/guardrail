# Guardrail — AI trading agent for HSKSwap

Watches the HSKSwap WHSK/USDT pool, decides with a trend strategy (fast/slow EMA) plus stop-loss and take-profit, and trades ONLY through the AgentVault contract, which enforces hard limits on-chain. Control it in plain English.

## Run
    npm install
    cp .env.example .env   # fill VAULT_ADDRESS + AGENT_PRIVATE_KEY for live; leave MODE=paper to simulate
    set -a; . ./.env; set +a
    npm start              # agent loop + API on :8787
    npm run chat           # talk to it in another terminal

Dashboard: open http://localhost:8787 (live price chart, NAV/P&L, trade log with reasons + tx links, settings, chat, emergency stop).
API: GET /status, POST /chat {"text":"risk 2%"}

## Chat examples
status · show trades · risk 2% · stop loss 1.5% · take profit 4% · max exposure 40% · slippage 0.5% · be more conservative · stop · resume · emergency stop (pauses the vault on-chain)

Set LLM_API_KEY (any OpenAI-compatible endpoint) for free-form language; without it a rule parser handles the commands above.

## Safety layers
1. Strategy: stop-loss, take-profit, max HSK exposure, risk % per trade.
2. Agent: simulates every trade first; vault rejections are logged with the reason (TradeTooLarge, Cooldown, NavBelowFloor...).
3. Vault (on-chain): max trade size, daily volume/trade count, cooldown, slippage cap, NAV floor, kill switch. The agent key can never withdraw.

## Fork test (no real funds)
Start `anvil --fork-url https://mainnet.hsk.xyz`, deploy the vault there, fund it, then run `npx tsx src/e2e-fork.ts` with RPC_URL=http://localhost:8545 MODE=live.
