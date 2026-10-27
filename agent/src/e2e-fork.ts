// End-to-end check against a local anvil fork of HSK mainnet (no real funds).
// Usage: RPC_URL=http://localhost:8545 MODE=live VAULT_ADDRESS=0x.. AGENT_PRIVATE_KEY=0x.. npx tsx src/e2e-fork.ts
import { Agent } from "./agent.js";
import { handleChat } from "./chat.js";

process.env.SETTINGS_FILE = "/tmp/e2e-settings.json";
const a = new Agent() as any;
a.st.price = await (await import("./chain.js")).readPrice();
await a.refreshBalances();
console.log("start:", (await handleChat(a, "status")).split("\n")[0]);

await a.execute({ action: "buy", usdt: 1.5, reason: "e2e: forced buy $1.50" });
await a.execute({ action: "buy", usdt: 3, reason: "e2e: forced buy $3 (over $2 cap)" });
await a.execute({ action: "buy", usdt: 1, reason: "e2e: immediate second buy (cooldown)" });
console.log("\n" + await handleChat(a, "show trades"));
console.log("\n" + await handleChat(a, "be more conservative"));
console.log("\n" + await handleChat(a, "emergency stop"));
await a.refreshBalances();
console.log("\n" + await handleChat(a, "status"));
