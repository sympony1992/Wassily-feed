/** Event topics and ABI decoding for the pool launches this agent watches on Robinhood Chain. */

export const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'; // dollar stablecoin
export const NATIVE = '0x0000000000000000000000000000000000000000'; // Uniswap v4 uses the zero address for ETH

export const TOPICS = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  // Uniswap v2-style factories: PairCreated(address indexed token0, address indexed token1, address pair, uint256)
  v2PairCreated: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
  // Uniswap v3-style factories: PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
  v3PoolCreated: '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
  // Uniswap v4 PoolManager: Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
  v4Initialize: '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',
  // Pons launchpad factory: (address indexed token, address indexed curve, address indexed creator; address quote (zero = WETH), uint256, uint256)
  ponsCreated: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
  // Pons curve trade, emitted by the curve: (uint256 quoteAmount, uint256 tokenAmount, uint256 fee, uint256 creatorFee)
  ponsTrade: '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455',
} as const;

export const LAUNCH_TOPICS = [TOPICS.v2PairCreated, TOPICS.v3PoolCreated, TOPICS.v4Initialize, TOPICS.ponsCreated];

export type PoolKind = 'v2' | 'v3' | 'v4' | 'pons';

export interface PoolLaunch {
  kind: PoolKind;
  pool: string; // pair or pool address; for v4 the 32-byte pool id
  tokenA: string;
  tokenB: string; // for Pons launches: the quote asset
  creator?: string;
  block: number;
}

export const topicAddress = (topic: string) => `0x${topic.slice(26)}`.toLowerCase();

/** The address stored in ABI word `index` of `data`. */
export const wordAddress = (data: string, index: number) => `0x${data.slice(2 + index * 64 + 24, 2 + (index + 1) * 64)}`.toLowerCase();

/** Decode one launch log, or null if it is not one of LAUNCH_TOPICS. */
export function decodeLaunch(log: { topics: string[]; data: string; blockNumber: string }): PoolLaunch | null {
  const block = Number(log.blockNumber);
  const [topic, t1, t2, t3] = log.topics;
  switch (topic) {
    case TOPICS.v2PairCreated:
      return { kind: 'v2', pool: wordAddress(log.data, 0), tokenA: topicAddress(t1), tokenB: topicAddress(t2), block };
    case TOPICS.v3PoolCreated:
      return { kind: 'v3', pool: wordAddress(log.data, 1), tokenA: topicAddress(t1), tokenB: topicAddress(t2), block };
    case TOPICS.v4Initialize:
      return { kind: 'v4', pool: t1.toLowerCase(), tokenA: topicAddress(t2), tokenB: topicAddress(t3), block };
    case TOPICS.ponsCreated: {
      const quote = log.data.length >= 66 ? wordAddress(log.data, 0) : NATIVE;
      return { kind: 'pons', pool: topicAddress(t2), tokenA: topicAddress(t1), tokenB: quote === NATIVE ? WETH : quote, creator: topicAddress(t3), block };
    }
    default:
      return null;
  }
}

export const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
} as const;

/** ABI `string` return data, or a right-padded bytes32 as older tokens use. */
export function decodeString(data: string): string {
  const hexBody = data.startsWith('0x') ? data.slice(2) : data;
  if (!hexBody) return '';
  const bytes = Buffer.from(hexBody, 'hex');
  if (bytes.length >= 96) {
    const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
    const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`));
    if (offset === 32 && length <= bytes.length - 64) return bytes.subarray(64, 64 + length).toString('utf8').replace(/\0/g, '').trim();
  }
  return bytes.subarray(0, 32).toString('utf8').replace(/\0/g, '').trim();
}
