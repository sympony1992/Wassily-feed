import { SELECTORS, decodeString } from './abi';
import type { RpcClient } from './rpc';

export interface TokenInfo {
  decimals: number;
  supply: number; // total supply in whole tokens
}

export interface TokenLabel {
  name: string;
  symbol: string;
}

/**
 * ERC-20 metadata read from the chain and cached per token. Supply and
 * decimals are needed to price every traded token; name and symbol only for
 * the few that are labelled, so they are read separately.
 */
export class TokenInfoCache {
  private readonly infos = new Map<string, Promise<TokenInfo | null>>();
  private readonly labels = new Map<string, Promise<TokenLabel>>();

  constructor(private readonly rpc: Pick<RpcClient, 'ethCall'>) {}

  /** Metadata known without asking the chain, such as a launchpad's fixed supply; never overrides a value already read. */
  seed(token: string, info: TokenInfo) {
    const key = token.toLowerCase();
    if (!this.infos.has(key)) this.infos.set(key, Promise.resolve(info));
  }

  /** Decimals and total supply, or null when the contract does not answer like a token. */
  get(token: string): Promise<TokenInfo | null> {
    return this.cached(this.infos, token.toLowerCase(), async (key) => {
      const [decimals, supply] = await Promise.all([this.call(key, SELECTORS.decimals), this.call(key, SELECTORS.totalSupply)]);
      if (supply.length < 66 || decimals.length < 66) return null;
      const places = Number(BigInt(decimals.slice(0, 66)));
      return places > 36 ? null : { decimals: places, supply: Number(BigInt(supply.slice(0, 66))) / 10 ** places };
    });
  }

  label(token: string): Promise<TokenLabel> {
    return this.cached(this.labels, token.toLowerCase(), async (key) => {
      const [name, symbol] = await Promise.all([this.call(key, SELECTORS.name), this.call(key, SELECTORS.symbol)]);
      return { name: decodeString(name), symbol: decodeString(symbol) };
    });
  }

  private cached<T>(map: Map<string, Promise<T>>, key: string, read: (key: string) => Promise<T>): Promise<T> {
    let hit = map.get(key);
    if (!hit) {
      hit = read(key).catch((err) => {
        map.delete(key); // a failed read is retried next time, never cached as "not a token"
        throw err;
      });
      map.set(key, hit);
    }
    return hit;
  }

  private call(token: string, data: string): Promise<string> {
    return this.rpc.ethCall(token, data).catch((err: Error) => (/revert|execution/i.test(err.message) ? '0x' : Promise.reject(err)));
  }
}
