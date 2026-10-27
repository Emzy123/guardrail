import { createPublicClient, createWalletClient, http, defineChain, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const env = {
  rpcUrl: process.env.RPC_URL ?? "https://mainnet.hsk.xyz",
  chainId: Number(process.env.CHAIN_ID ?? 177),
  vault: process.env.VAULT_ADDRESS as Address | undefined,
  agentKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
  mode: (process.env.MODE ?? "paper") as "paper" | "live",
  pool: (process.env.POOL ?? "0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC") as Address, // WHSK/USDT 0.3%
  usdt: (process.env.QUOTE ?? "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029") as Address,
  whsk: (process.env.BASE ?? "0xB210D2120d57b758EE163cFfb43e73728c471Cf1") as Address,
  port: Number(process.env.PORT ?? 8787),
};

export const hsk = defineChain({
  id: env.chainId,
  name: env.chainId === 177 ? "HSK Chain" : "HSK Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
});

// The HSK RPC rejects requests without a User-Agent header.
const transport = http(env.rpcUrl, { fetchOptions: { headers: { "User-Agent": "guardrail-agent/0.1" } } });

export const pub = createPublicClient({ chain: hsk, transport });
export const account = env.agentKey ? privateKeyToAccount(env.agentKey) : undefined;
export const wallet = account ? createWalletClient({ chain: hsk, transport, account }) : undefined;

export const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function token0() view returns (address)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const vaultAbi = parseAbi([
  "function trade(address tokenIn, uint256 amountIn, uint16 slippageBps, string rationale) returns (uint256)",
  "function pause(string reason)",
  "function paused() view returns (bool)",
  "function navQuote() view returns (uint256)",
  "function status() view returns (bool isPaused, uint256 nav, uint256 volToday, uint16 tradesCount, uint256 nextTradeAt)",
  "function limits() view returns (uint256 maxTradeQuote, uint256 dailyVolumeQuote, uint16 maxTradesPerDay, uint16 maxSlippageBps, uint32 cooldownSecs, uint256 navFloorQuote)",
  "event TradeExecuted(address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 navAfterQuote, string rationale)",
  "error NotOwner()",
  "error NotAgent()",
  "error NotAuthorized()",
  "error IsPaused()",
  "error BadToken()",
  "error TradeTooLarge(uint256 sizeQuote, uint256 max)",
  "error DailyVolumeExceeded()",
  "error DailyTradesExceeded()",
  "error Cooldown(uint256 readyAt)",
  "error SlippageTooHigh(uint16 requestedBps, uint16 maxBps)",
  "error NavBelowFloor(uint256 nav, uint256 floor)",
  "error TransferFailed()",
]);

/** USDT per HSK from the pool's sqrtPriceX96 (WHSK 18 dec, USDT 6 dec). */
export async function readPrice(): Promise<number> {
  const [[sqrtP], token0] = await Promise.all([
    pub.readContract({ address: env.pool, abi: poolAbi, functionName: "slot0" }),
    pub.readContract({ address: env.pool, abi: poolAbi, functionName: "token0" }),
  ]);
  const s = Number(sqrtP) / 2 ** 96;
  const raw = s * s; // token1 per token0 in raw units
  const whskIs0 = token0.toLowerCase() === env.whsk.toLowerCase();
  const usdtPerHskRaw = whskIs0 ? raw : 1 / raw;
  return usdtPerHskRaw * 1e18 / 1e6;
}

export async function balances(holder: Address) {
  const [usdt, whsk] = await Promise.all([
    pub.readContract({ address: env.usdt, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    pub.readContract({ address: env.whsk, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
  ]);
  return { usdt, whsk };
}
