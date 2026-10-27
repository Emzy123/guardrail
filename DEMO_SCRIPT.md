# Guardrail — demo video script (about 2:30)

Record: screen capture of the dashboard (localhost:8787) + a terminal + the block explorer, with voice-over. Phone camera or OBS is fine.

---

**0:00–0:15 · Hook** (dashboard on screen)
"AI agents are getting trusted with real money. But most of them hold a private key with full control. One bad prompt or buggy line and the funds are gone. This is Guardrail: an AI trading agent on HSK Chain that physically can't break your rules, because the rules live on-chain."

**0:15–0:40 · How it works** (show the architecture diagram in the README)
"You deposit into AgentVault, a smart contract. The agent's key can only call one function: trade. It can never withdraw. Every trade is checked by the contract: max trade size, daily volume, number of trades, cooldown, slippage and a NAV floor. If the agent breaks any of them, the transaction reverts."

**0:40–1:10 · The agent live** (dashboard)
"Here's the agent watching the HSKSwap WHSK/USDT pool. It runs a trend strategy with stop-loss and take-profit, and every decision comes with a reason. Here's a filled trade, and here's its transaction on the HSK explorer, with the agent's rationale written on-chain." (click the 'view tx' link)

**1:10–1:40 · Guardrails in action** (trade log)
"Now watch what happens when the agent tries something it shouldn't. Here it tried a trade over the cap: the vault blocked it with TradeTooLarge. Here it fired a second trade in the same block: the transaction went out, and the vault reverted it on-chain because of the cooldown. The agent didn't have to be well-behaved. The contract made it."

**1:40–2:10 · Talk to it** (chat panel; type these)
- "status" → "It tells me my value, position and P&L in plain English."
- "be more conservative" → "It cuts risk, tightens the stop-loss and lowers exposure."
- "emergency stop" → "And this pauses the vault on-chain. Only I, the owner, can unpause it." (show the pause tx)

**2:10–2:30 · Close**
"Guardrail: autonomous trading with limits you can verify on-chain. Contracts are fork-tested against live HSKSwap, it's deployed on HSK Chain, and the code is open source. Thanks for watching."

---

Before recording: run `npm start` with the testnet env, let it tick a few minutes so the chart fills, and keep the explorer tab open on the vault address.
