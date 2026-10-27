import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** User-adjustable strategy settings. The vault's on-chain limits still cap everything. */
export interface Settings {
  trading: boolean;          // agent on/off (soft switch; on-chain pause is the hard one)
  riskPct: number;           // % of NAV per trade
  fastEma: number;           // ticks
  slowEma: number;           // ticks
  minEdgePct: number;        // fast must beat slow by this % to signal
  stopLossPct: number;       // exit a position if price falls this % below entry
  takeProfitPct: number;     // exit if price rises this % above entry
  slippageBps: number;       // requested slippage (vault caps it)
  pollSecs: number;          // seconds between ticks
  maxHskExposurePct: number; // max share of NAV held in HSK
}

export const DEFAULTS: Settings = {
  trading: true,
  riskPct: 5,
  fastEma: 6,
  slowEma: 24,
  minEdgePct: 0.15,
  stopLossPct: 2,
  takeProfitPct: 3,
  slippageBps: 80,
  pollSecs: 30,
  maxHskExposurePct: 60,
};

const FILE = process.env.SETTINGS_FILE ?? "settings.json";

export function loadSettings(): Settings {
  if (!existsSync(FILE)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf8")) };
}

export function saveSettings(s: Settings) {
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/** Clamp anything the chat layer sets so a bad parse can't do something silly. */
export function sanitize(s: Settings): Settings {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    ...s,
    riskPct: c(s.riskPct, 0.5, 25),
    fastEma: Math.round(c(s.fastEma, 2, 100)),
    slowEma: Math.round(c(Math.max(s.slowEma, s.fastEma + 1), 3, 500)),
    minEdgePct: c(s.minEdgePct, 0, 5),
    stopLossPct: c(s.stopLossPct, 0.2, 20),
    takeProfitPct: c(s.takeProfitPct, 0.2, 50),
    slippageBps: Math.round(c(s.slippageBps, 5, 300)),
    pollSecs: Math.round(c(s.pollSecs, 5, 3600)),
    maxHskExposurePct: c(s.maxHskExposurePct, 0, 100),
  };
}
