// Live test trades on HSK testnet (133) against the deployed AgentVault + WHSK/tUSDT pool.
// Usage: set -a; . ./.env.testnet; set +a; npx tsx src/testnet-trades.ts
import { Agent } from "./agent.js";
import { handleChat } from "./chat.js";
import { readPrice } from "./chain.js";

process.env.SETTINGS_FILE = "/tmp/testnet-settings.json";
const a = new Agent() as any;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
a.st.price = await readPrice();
await a.refreshBalances();
console.log("start:", (await handleChat(a, "status")).split("\n").slice(0, 2).join(" | "));

await a.execute({ action: "buy", usdt: 0.001, reason: "testnet: buy $0.001 of HSK" });
await a.execute({ action: "buy", usdt: 0.005, reason: "testnet: buy $0.005 (over the $0.002 vault cap)" });
await a.execute({ action: "buy", usdt: 0.001, reason: "testnet: immediate second buy (cooldown)" });
console.log("waiting out the 60s cooldown...");
await sleep(65);
a.st.price = await readPrice();
await a.execute({ action: "sell", hsk: 0.005, reason: "testnet: sell 0.005 HSK after cooldown" });
console.log("\n" + await handleChat(a, "show trades"));
console.log("\n" + await handleChat(a, "emergency stop"));
await a.refreshBalances();
console.log("\n" + await handleChat(a, "status"));
