import { parseUnits, BaseError, ContractFunctionRevertedError } from "viem";
import { env, pub, wallet, vaultAbi, readPrice, balances } from "./chain.js";
import { decide, type Position, type Signal } from "./strategy.js";
import { loadSettings, type Settings } from "./settings.js";

export interface TradeLog {
  time: string;
  action: "buy" | "sell";
  amountIn: string;
  price: number;
  reason: string;
  tx?: string;
  status: "filled" | "blocked" | "paper";
  note?: string;
}

export interface AgentState {
  mode: "paper" | "live";
  price: number;
  prices: number[];
  usdt: number;
  hsk: number;
  nav: number;
  startNav: number;
  position: Position | null;
  lastSignal: Signal | null;
  trades: TradeLog[];
  onchain?: { paused: boolean; volToday: number; tradesToday: number; nextTradeAt: number };
}

const FEE = 0.003; // HSKSwap pool fee, used for paper fills

export class Agent {
  s: Settings = loadSettings();
  st: AgentState = {
    mode: env.mode, price: 0, prices: [], usdt: env.mode === "paper" ? 100 : 0, hsk: 0,
    nav: 0, startNav: 0, position: null, lastSignal: null, trades: [],
  };
  private timer?: NodeJS.Timeout;

  async refreshBalances() {
    if (env.mode === "live" && env.vault) {
      const b = await balances(env.vault);
      this.st.usdt = Number(b.usdt) / 1e6;
      this.st.hsk = Number(b.whsk) / 1e18;
      const [paused, , vol, n, next] = await pub.readContract({ address: env.vault, abi: vaultAbi, functionName: "status" });
      this.st.onchain = { paused, volToday: Number(vol) / 1e6, tradesToday: n, nextTradeAt: Number(next) };
    }
    this.st.nav = this.st.usdt + this.st.hsk * this.st.price;
    if (!this.st.startNav) this.st.startNav = this.st.nav;
  }

  async tick(): Promise<Signal> {
    this.st.price = await readPrice();
    this.st.prices.push(this.st.price);
    if (this.st.prices.length > 2000) this.st.prices.shift();
    await this.refreshBalances();

    if (!this.s.trading) return (this.st.lastSignal = { action: "hold", reason: "trading switched off by user" });
    if (this.st.onchain?.paused) return (this.st.lastSignal = { action: "hold", reason: "vault paused on-chain" });

    const sig = decide({
      prices: this.st.prices, price: this.st.price, navUsdt: this.st.nav,
      usdtBal: this.st.usdt, hskBal: this.st.hsk, position: this.st.position, s: this.s,
    });
    this.st.lastSignal = sig;
    if (sig.action !== "hold") await this.execute(sig);
    return sig;
  }

  private async execute(sig: Exclude<Signal, { action: "hold" }>) {
    const price = this.st.price;
    const log: TradeLog = {
      time: new Date().toISOString(), action: sig.action, price, reason: sig.reason, status: "paper",
      amountIn: sig.action === "buy" ? `${fmt(sig.usdt)} USDT` : `${sig.hsk.toFixed(4)} HSK`,
    };

    if (env.mode === "paper") {
      if (sig.action === "buy") {
        const got = (sig.usdt / price) * (1 - FEE);
        this.st.usdt -= sig.usdt;
        this.trackBuy(got, price);
      } else {
        this.st.usdt += sig.hsk * price * (1 - FEE);
        this.st.hsk -= sig.hsk;
        this.st.position = null;
      }
    } else {
      if (!wallet || !env.vault) throw new Error("live mode needs VAULT_ADDRESS and AGENT_PRIVATE_KEY");
      const tokenIn = sig.action === "buy" ? env.usdt : env.whsk;
      const amountIn = sig.action === "buy"
        ? parseUnits(sig.usdt.toFixed(6), 6)
        : parseUnits(sig.hsk.toFixed(18), 18);
      try {
        // simulate first so a vault limit shows up as a readable reason, not a failed tx
        const { request } = await pub.simulateContract({
          account: wallet.account, address: env.vault, abi: vaultAbi, functionName: "trade",
          args: [tokenIn, amountIn, this.s.slippageBps, sig.reason.slice(0, 120)], blockTag: "pending",
        });
        const hash = await wallet.writeContract({ ...request, nonce: await nextNonce() });
        const rc = await pub.waitForTransactionReceipt({ hash });
        log.tx = hash;
        if (rc.status !== "success") throw new Error("reverted on-chain by the vault (limit hit after the simulation, e.g. Cooldown)");
        log.status = "filled";
        const before = this.st.hsk;
        await this.refreshBalances();
        if (sig.action === "buy") this.trackBuy(this.st.hsk - before, price, true);
        else this.st.position = null;
      } catch (e) {
        log.status = "blocked";
        log.note = revertName(e);
      }
    }
    this.st.nav = this.st.usdt + this.st.hsk * price;
    this.st.trades.unshift(log);
    if (this.st.trades.length > 200) this.st.trades.pop();
    console.log(`[${log.time}] ${log.status.toUpperCase()} ${log.action} ${log.amountIn} @ ${price.toFixed(5)} | ${log.reason}${log.note ? " | " + log.note : ""}${log.tx ? " | tx " + log.tx : ""}`);
  }

  private trackBuy(gotHsk: number, price: number, alreadyCounted = false) {
    const prev = this.st.position;
    const prevAmt = prev?.hskAmount ?? 0;
    const amt = prevAmt + gotHsk;
    const entry = prev ? (prev.entryPrice * prevAmt + price * gotHsk) / amt : price;
    this.st.position = { entryPrice: entry, hskAmount: amt };
    if (!alreadyCounted) this.st.hsk += gotHsk;
  }

  /** Hard kill switch: pauses the vault on-chain (live) and stops the loop. */
  async emergencyStop(reason: string) {
    this.s.trading = false;
    if (env.mode === "live" && wallet && env.vault) {
      const { request } = await pub.simulateContract({
        account: wallet.account, address: env.vault, abi: vaultAbi, functionName: "pause", args: [reason.slice(0, 120)],
      });
      const hash = await wallet.writeContract({ ...request, nonce: await nextNonce() });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    }
  }

  start() {
    const loop = async () => {
      try { await this.tick(); } catch (e) { console.error("tick error:", (e as Error).message); }
      this.timer = setTimeout(loop, this.s.pollSecs * 1000);
    };
    loop();
  }

  stop() { if (this.timer) clearTimeout(this.timer); }

  summary() {
    const st = this.st;
    const pnl = st.nav - st.startNav;
    return {
      mode: st.mode, price: st.price, usdt: st.usdt, hsk: st.hsk, nav: st.nav,
      pnl, pnlPct: st.startNav ? (pnl / st.startNav) * 100 : 0,
      position: st.position, lastSignal: st.lastSignal, onchain: st.onchain,
      settings: this.s, trades: st.trades.slice(0, 20), prices: st.prices.slice(-200),
      vault: env.vault ?? null, chainId: env.chainId, startNav: st.startNav,
    };
  }
}

function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return `vault blocked: ${r.data?.errorName ?? r.shortMessage}`;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Money with enough decimals to stay readable for tiny (testnet) sizes. */
export function fmt(n: number) { return Math.abs(n) >= 1 || n === 0 ? n.toFixed(2) : n.toPrecision(2); }

/** Pending nonce from the RPC: avoids "nonce too low" when a load-balanced node lags right after a tx. */
async function nextNonce() { return pub.getTransactionCount({ address: wallet!.account!.address, blockTag: "pending" }); }
