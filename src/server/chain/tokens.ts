import { SELECTORS, decodeString } from './abi';
import type { RpcClient } from './rpc';

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  supply: number; // total supply in whole tokens
}

/** ERC-20 metadata read from the chain, cached per token; null when the contract does not answer like a token. */
export class TokenInfoCache {
  private readonly cache = new Map<string, Promise<TokenInfo | null>>();

  constructor(private readonly rpc: Pick<RpcClient, 'ethCall'>) {}

  get(token: string): Promise<TokenInfo | null> {
    const key = token.toLowerCase();
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.read(key).catch((err) => {
        this.cache.delete(key); // a failed read is retried next time, never cached as "not a token"
        throw err;
      });
      this.cache.set(key, hit);
    }
    return hit;
  }

  private async read(token: string): Promise<TokenInfo | null> {
    const call = (data: string) => this.rpc.ethCall(token, data).catch((err: Error) => (/revert|execution/i.test(err.message) ? '0x' : Promise.reject(err)));
    const [name, symbol, decimals, supply] = await Promise.all([call(SELECTORS.name), call(SELECTORS.symbol), call(SELECTORS.decimals), call(SELECTORS.totalSupply)]);
    if (!supply || supply.length < 66 || !decimals || decimals.length < 66) return null;
    const places = Number(BigInt(decimals.slice(0, 66)));
    if (places > 36) return null;
    return { name: decodeString(name), symbol: decodeString(symbol), decimals: places, supply: Number(BigInt(supply.slice(0, 66))) / 10 ** places };
  }
}
