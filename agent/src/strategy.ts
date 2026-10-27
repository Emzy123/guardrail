import type { Settings } from "./settings.js";

export interface Position { entryPrice: number; hskAmount: number } // hskAmount in whole HSK
export type Signal =
  | { action: "buy"; usdt: number; reason: string }
  | { action: "sell"; hsk: number; reason: string }
  | { action: "hold"; reason: string };

export function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/**
 * Trend-following with hard exits:
 *  - exits first: stop-loss / take-profit vs entry price
 *  - entry: fast EMA above slow EMA by minEdgePct, and HSK exposure under the cap
 *  - trend flip: fast below slow by minEdgePct -> sell the position
 */
export function decide(input: {
  prices: number[];
  price: number;
  navUsdt: number;
  usdtBal: number;
  hskBal: number;
  position: Position | null;
  s: Settings;
}): Signal {
  const { prices, price, navUsdt, usdtBal, hskBal, position, s } = input;

  if (position && hskBal > 0) {
    const pnlPct = ((price - position.entryPrice) / position.entryPrice) * 100;
    if (pnlPct <= -s.stopLossPct)
      return { action: "sell", hsk: hskBal, reason: `stop-loss: ${pnlPct.toFixed(2)}% from entry ${position.entryPrice.toFixed(5)}` };
    if (pnlPct >= s.takeProfitPct)
      return { action: "sell", hsk: hskBal, reason: `take-profit: +${pnlPct.toFixed(2)}% from entry ${position.entryPrice.toFixed(5)}` };
  }

  if (prices.length < s.slowEma) return { action: "hold", reason: `warming up (${prices.length}/${s.slowEma} ticks)` };

  const fast = ema(prices.slice(-s.slowEma * 3), s.fastEma);
  const slow = ema(prices.slice(-s.slowEma * 3), s.slowEma);
  const edgePct = ((fast - slow) / slow) * 100;
  const exposurePct = navUsdt > 0 ? ((hskBal * price) / navUsdt) * 100 : 0;

  if (edgePct >= s.minEdgePct && exposurePct < s.maxHskExposurePct) {
    const room = (s.maxHskExposurePct - exposurePct) / 100 * navUsdt;
    const usdt = Math.min(navUsdt * s.riskPct / 100, usdtBal, room);
    if (usdt >= 0.1)
      return { action: "buy", usdt, reason: `uptrend: fast EMA ${edgePct.toFixed(2)}% over slow, exposure ${exposurePct.toFixed(0)}%` };
  }

  if (edgePct <= -s.minEdgePct && hskBal > 0)
    return { action: "sell", hsk: hskBal, reason: `trend flip: fast EMA ${edgePct.toFixed(2)}% under slow` };

  return { action: "hold", reason: `no edge (fast vs slow ${edgePct.toFixed(2)}%, exposure ${exposurePct.toFixed(0)}%)` };
}
