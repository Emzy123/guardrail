import { fmt } from "./agent.js";
import type { Agent } from "./agent.js";
import { sanitize, saveSettings, type Settings } from "./settings.js";

/**
 * Natural-language control. Uses an OpenAI-compatible LLM when LLM_API_KEY is set,
 * otherwise a rule parser that covers the common commands.
 * The LLM can only return a settings patch or an intent; it never signs anything.
 */
type Intent =
  | { kind: "status" }
  | { kind: "trades" }
  | { kind: "set"; patch: Partial<Settings> }
  | { kind: "stop" }
  | { kind: "emergency" }
  | { kind: "start" }
  | { kind: "help" };

export async function handleChat(agent: Agent, text: string): Promise<string> {
  const intent = (await llmIntent(text)) ?? ruleIntent(text);

  switch (intent.kind) {
    case "status": return statusText(agent);
    case "trades": {
      const t = agent.st.trades.slice(0, 5);
      if (!t.length) return "No trades yet.";
      return t.map((x) => `${x.time.slice(11, 19)} ${x.status} ${x.action} ${x.amountIn} @ $${x.price.toFixed(5)} (${x.reason}${x.note ? "; " + x.note : ""})`).join("\n");
    }
    case "set": {
      const before = { ...agent.s };
      agent.s = sanitize({ ...agent.s, ...intent.patch });
      saveSettings(agent.s);
      const changed = (Object.keys(intent.patch) as (keyof Settings)[])
        .filter((k) => before[k] !== agent.s[k])
        .map((k) => `${k}: ${before[k]} → ${agent.s[k]}`).join(", ");
      return changed ? `Updated ${changed}. On-chain vault limits still apply.` : "Those settings are already in place.";
    }
    case "stop":
      agent.s.trading = false; saveSettings(agent.s);
      return "Trading paused (soft). Say 'resume' to restart, or 'emergency stop' to pause the vault on-chain.";
    case "start":
      if (agent.st.onchain?.paused) return "The vault is paused on-chain; only the owner can unpause it.";
      agent.s.trading = true; saveSettings(agent.s);
      return "Trading resumed.";
    case "emergency": {
      try {
        const tx = await agent.emergencyStop("user emergency stop via chat");
        return tx ? `Vault paused on-chain. tx ${tx}` : "Trading stopped (paper mode, nothing on-chain to pause).";
      } catch (e) {
        return `Trading stopped locally, but the on-chain pause failed: ${(e as Error).message.split("\n")[0]}`;
      }
    }
    default:
      return "Try: 'status', 'show trades', 'risk 2%', 'stop loss 1.5%', 'take profit 4%', 'max exposure 40%', 'be more conservative', 'stop', 'resume', 'emergency stop'.";
  }
}

function statusText(agent: Agent): string {
  const s = agent.summary();
  const pos = s.position
    ? `Holding ${s.position.hskAmount.toFixed(2)} HSK from $${s.position.entryPrice.toFixed(5)} (${(((s.price - s.position.entryPrice) / s.position.entryPrice) * 100).toFixed(2)}%).`
    : "No open position.";
  return [
    `[${s.mode}] HSK $${s.price.toFixed(5)} | NAV $${fmt(s.nav)} (${s.pnl >= 0 ? "+" : ""}${fmt(s.pnl)}, ${s.pnlPct.toFixed(2)}%)`,
    `${fmt(s.usdt)} USDT + ${fmt(s.hsk)} HSK. ${pos}`,
    `Risk ${s.settings.riskPct}%/trade, SL ${s.settings.stopLossPct}%, TP ${s.settings.takeProfitPct}%, max exposure ${s.settings.maxHskExposurePct}%. Trading ${s.settings.trading ? "ON" : "OFF"}.`,
    `Last decision: ${s.lastSignal ? `${s.lastSignal.action} (${s.lastSignal.reason})` : "none yet"}`,
  ].join("\n");
}

export function ruleIntent(raw: string): Intent {
  const t = raw.toLowerCase();
  const num = (re: RegExp) => { const m = t.match(re); return m ? parseFloat(m[1]) : undefined; };

  if (/emergency|kill|panic/.test(t)) return { kind: "emergency" };
  if (/\b(resume|start|turn on)\b/.test(t)) return { kind: "start" };
  if (/\b(stop|pause|halt|turn off)\b/.test(t) && !/stop.?loss/.test(t)) return { kind: "stop" };
  if (/trade|history|log/.test(t) && !/\d/.test(t)) return { kind: "trades" };
  if (/status|p&l|pnl|position|balance|how.*doing/.test(t)) return { kind: "status" };

  const patch: Partial<Settings> = {};
  const sl = num(/stop.?loss[^\d]*(\d+(?:\.\d+)?)/); if (sl !== undefined) patch.stopLossPct = sl;
  const tp = num(/take.?profit[^\d]*(\d+(?:\.\d+)?)/); if (tp !== undefined) patch.takeProfitPct = tp;
  const ex = num(/exposure[^\d]*(\d+(?:\.\d+)?)/); if (ex !== undefined) patch.maxHskExposurePct = ex;
  const sp = num(/slippage[^\d]*(\d+(?:\.\d+)?)/); if (sp !== undefined) patch.slippageBps = t.includes("bps") ? sp : sp * 100;
  const pl = num(/(?:every|poll|frequency)[^\d]*(\d+)\s*s/); if (pl !== undefined) patch.pollSecs = pl;
  const rk = num(/(?:risk|size|position size)[^\d]*(\d+(?:\.\d+)?)/); if (rk !== undefined && sl === undefined) patch.riskPct = rk;

  if (/conservative|safer|less risk|careful/.test(t)) Object.assign(patch, { riskPct: 2, stopLossPct: 1.5, maxHskExposurePct: 30, minEdgePct: 0.3 });
  if (/aggressive|more risk/.test(t)) Object.assign(patch, { riskPct: 10, stopLossPct: 3, maxHskExposurePct: 80, minEdgePct: 0.1 });

  if (Object.keys(patch).length) return { kind: "set", patch };
  return { kind: "help" };
}

async function llmIntent(text: string): Promise<Intent | null> {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const base = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const sys = `You control a crypto trading agent. Map the user's message to ONE JSON object:
{"kind":"status"} | {"kind":"trades"} | {"kind":"stop"} | {"kind":"start"} | {"kind":"emergency"} | {"kind":"help"} |
{"kind":"set","patch":{...}} where patch keys are any of: riskPct, stopLossPct, takeProfitPct, maxHskExposurePct, minEdgePct, slippageBps, pollSecs, fastEma, slowEma (numbers, percents as plain numbers).
Reply with JSON only.`;
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
      }),
    });
    const j: any = await r.json();
    const parsed = JSON.parse(j.choices[0].message.content);
    return parsed?.kind ? (parsed as Intent) : null;
  } catch {
    return null; // fall back to rules
  }
}
