import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../web/index.html", import.meta.url));
import { Agent } from "./agent.js";
import { handleChat } from "./chat.js";
import { env } from "./chain.js";

const agent = new Agent();
agent.start();

// Tiny JSON API for the web UI: GET /status, POST /chat {text}
createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("content-type", "application/json");
  if (req.method === "OPTIONS") return res.end();
  try {
    if (req.url === "/" || req.url === "/index.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(readFileSync(UI));
    }
    if (req.url === "/status") return res.end(JSON.stringify(agent.summary()));
    if (req.url === "/chat" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const { text } = JSON.parse(body || "{}");
      return res.end(JSON.stringify({ reply: await handleChat(agent, String(text ?? "")) }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: (e as Error).message }));
  }
}).listen(env.port, () => console.log(`Guardrail agent [${env.mode}] on :${env.port} — vault ${env.vault ?? "(none, paper)"}`));
