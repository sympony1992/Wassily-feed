/**
 * Minimal JSON-RPC client for Robinhood Chain: bounded concurrency, retries
 * with backoff for rate limits and transient failures, and log queries that
 * split their block range only when the node says the result is too large.
 */
export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export interface LogFilter {
  fromBlock: number;
  toBlock: number;
  address?: string | string[];
  topics?: (string | string[] | null)[];
}

export interface RpcOptions {
  fetchImpl?: typeof fetch;
  concurrency?: number; // parallel requests to the node
  retries?: number; // attempts for rate limits and transient failures
  timeoutMs?: number;
  minSpan?: number; // smallest block range getLogs will split down to
  log?: (msg: string) => void;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

const hex = (n: number) => `0x${n.toString(16)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RpcClient {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private nextId = 0;
  private readonly timestamps = new Map<number, number>();

  constructor(
    readonly url: string,
    private readonly o: RpcOptions = {},
  ) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const retries = this.o.retries ?? 6;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.withSlot(() => this.send<T>(method, params));
      } catch (err) {
        if (!(err instanceof RpcError) || !err.retryable || attempt >= retries) throw err;
        await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
      }
    }
  }

  async blockNumber(): Promise<number> {
    return Number(await this.call<string>('eth_blockNumber', []));
  }

  /** Block timestamp in seconds, cached: blocks never change once final. */
  async timestamp(block: number): Promise<number> {
    const cached = this.timestamps.get(block);
    if (cached !== undefined) return cached;
    const b = await this.call<{ timestamp: string } | null>('eth_getBlockByNumber', [hex(block), false]);
    if (!b) throw new RpcError(`block ${block} not found`, false);
    const ts = Number(b.timestamp);
    this.timestamps.set(block, ts);
    return ts;
  }

  /** The first block at or after `seconds`, by binary search over timestamps. */
  async blockAt(seconds: number, head?: number): Promise<number> {
    let lo = 1;
    let hi = head ?? (await this.blockNumber());
    if ((await this.timestamp(hi)) < seconds) return hi;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await this.timestamp(mid)) < seconds) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  ethCall(to: string, data: string, block: number | 'latest' = 'latest'): Promise<string> {
    return this.call<string>('eth_call', [{ to, data }, block === 'latest' ? block : hex(block)]);
  }

  async getLogs(filter: LogFilter): Promise<RpcLog[]> {
    const { fromBlock, toBlock } = filter;
    try {
      return await this.call<RpcLog[]>('eth_getLogs', [{ ...filter, fromBlock: hex(fromBlock), toBlock: hex(toBlock) }]);
    } catch (err) {
      // Rate limits were already retried; a refusal ("exceeds limit") or a timeout means the range is too big.
      const tooBig = err instanceof RpcError && (!err.retryable || err.timedOut);
      if (!tooBig || toBlock - fromBlock < (this.o.minSpan ?? 50)) throw err;
      const mid = Math.floor((fromBlock + toBlock) / 2);
      this.o.log?.(`getLogs ${fromBlock}-${toBlock}: ${(err as Error).message.slice(0, 100)}; splitting`);
      const left = await this.getLogs({ ...filter, toBlock: mid });
      const right = await this.getLogs({ ...filter, fromBlock: mid + 1 });
      return left.concat(right);
    }
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= (this.o.concurrency ?? 3)) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async send<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs ?? 90_000);
    try {
      const res = await (this.o.fetchImpl ?? fetch)(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.nextId, method, params }),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) throw new RpcError(`${method} → HTTP ${res.status}`, true);
      if (!res.ok) throw new RpcError(`${method} → HTTP ${res.status}`, false);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw new RpcError(`${method}: ${body.error.message}`, false);
      return body.result as T;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if (controller.signal.aborted) throw new RpcError(`${method}: timed out`, method !== 'eth_getLogs', true); // a slow log query is split instead
      throw new RpcError(`${method}: ${(err as Error).message}`, true); // network failure
    } finally {
      clearTimeout(timer);
    }
  }
}
