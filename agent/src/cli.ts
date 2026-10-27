// Terminal chat with a running agent: npm run chat
import * as readline from "node:readline/promises";

const url = process.env.AGENT_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Talking to ${url}. Try "status", "risk 2%", "emergency stop".`);
for (;;) {
  const text = await rl.question("> ");
  const r = await fetch(`${url}/chat`, { method: "POST", body: JSON.stringify({ text }) });
  console.log((await r.json()).reply);
}
