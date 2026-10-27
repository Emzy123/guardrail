# Guardrail — AgentVault

An AI trading agent can trade the owner's funds on HSKSwap (HSK Chain), but only inside limits enforced on-chain:
max trade size, daily volume, daily trade count, cooldown, max slippage vs pool price, and a NAV floor (stop-loss that reverts any trade leaving the vault below it). Owner or agent can pause; only the owner can unpause or withdraw. Every trade logs the agent's rationale on-chain.

## Test (forks live HSK mainnet, no funds needed)
    forge install foundry-rs/forge-std
    forge test --fork-url https://mainnet.hsk.xyz -vv

## Deploy
    export PRIVATE_KEY=0x...  AGENT=0x...
    forge script script/Deploy.s.sol --rpc-url hsk --broadcast
Then send USDT to the vault address.
