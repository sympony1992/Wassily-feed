/**
 * Minimal JSON-RPC client for Robinhood Chain. Requests share one pace that
 * adapts to the node: every 429 (or 403 from its edge) slows everyone down and pauses briefly, and the
 * pace creeps back up while calls succeed. Log queries split their block range
 * only when the node says the result is too large.
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
  perSecond?: number; // request ceiling; the actual pace adapts below it
  retries?: number; // attempts for rate limits and transient failures
  timeoutMs?: number;
  minSpan?: number; // smallest block range getLogs will split down to
  sleep?: (ms: number) => Promise<void>;
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
const MIN_PER_SECOND = 1;
const START_PER_SECOND = 5;

export class RpcClient {
  /** Counters for /api/health: where the time goes when the node pushes back. */
  readonly stats = { calls: 0, throttled: 0, timeouts: 0, retries: 0, splits: 0, active: 0, waiting: 0, perSecond: 0 };
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private nextId = 0;
  private readonly timestamps = new Map<number, number>();
  private readonly ceiling: number;
  private pace: number;
  private nextAt = 0;

  constructor(
    readonly url: string,
    private readonly o: RpcOptions = {},
  ) {
    this.ceiling = o.perSecond ?? 10;
    this.pace = Math.min(this.ceiling, START_PER_SECOND);
    this.stats.perSecond = this.pace;
  }

  private sleep(ms: number) {
    return ms > 0 ? (this.o.sleep ?? ((t) => new Promise((resolve) => setTimeout(resolve, t))))(ms) : Promise.resolve();
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const retries = this.o.retries ?? 8;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.withSlot(() => this.send<T>(method, params));
      } catch (err) {
        if (!(err instanceof RpcError) || !err.retryable || attempt >= retries) throw err;
        this.stats.retries++;
        await this.sleep(Math.min(10_000, 500 * 2 ** attempt));
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
      this.stats.splits++;
      this.o.log?.(`getLogs ${fromBlock}-${toBlock}: ${(err as Error).message.slice(0, 100)}; splitting`);
      const left = await this.getLogs({ ...filter, toBlock: mid });
      const right = await this.getLogs({ ...filter, fromBlock: mid + 1 });
      return left.concat(right);
    }
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= (this.o.concurrency ?? 4)) {
      this.stats.waiting = this.waiting.length + 1;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    this.stats.active = this.active;
    this.stats.waiting = this.waiting.length;
    try {
      return await fn();
    } finally {
      this.active--;
      this.stats.active = this.active;
      this.waiting.shift()?.();
    }
  }

  /** Waits for this request's turn at the shared pace. */
  private async turn() {
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + 1000 / this.pace;
    await this.sleep(at - now);
  }

  private setPace(pace: number) {
    this.pace = Math.max(MIN_PER_SECOND, Math.min(this.ceiling, pace));
    this.stats.perSecond = Math.round(this.pace * 10) / 10;
  }

  private async send<T>(method: string, params: unknown[]): Promise<T> {
    await this.turn();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs ?? 90_000);
    this.stats.calls++;
    try {
      const res = await (this.o.fetchImpl ?? fetch)(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.nextId, method, params }),
        signal: controller.signal,
      });
      // The node's edge answers bursts with 403 as well as 429. Both mean "slow down": treated as a refusal,
      // a 403 would split a log range over and over for nothing.
      if (res.status === 429 || res.status === 403) {
        // Everyone slows down and pauses, instead of each request hammering on with its own backoff.
        this.stats.throttled++;
        this.setPace(this.pace * 0.7);
        this.nextAt = Math.max(this.nextAt, Date.now() + 2_000);
        throw new RpcError(`${method} → HTTP ${res.status}`, true);
      }
      if (res.status >= 500) throw new RpcError(`${method} → HTTP ${res.status}`, true);
      if (!res.ok) throw new RpcError(`${method} → HTTP ${res.status}`, false);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      this.setPace(this.pace + 0.05);
      if (body.error) throw new RpcError(`${method}: ${body.error.message}`, false);
      return body.result as T;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if (controller.signal.aborted) {
        this.stats.timeouts++;
        throw new RpcError(`${method}: timed out`, method !== 'eth_getLogs', true); // a slow log query is split instead
      }
      throw new RpcError(`${method}: ${(err as Error).message}`, true); // network failure
    } finally {
      clearTimeout(timer);
    }
  }
}
