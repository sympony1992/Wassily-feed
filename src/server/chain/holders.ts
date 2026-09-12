import { NATIVE, TOPICS, topicAddress } from './abi';
import type { RpcClient } from './rpc';

/**
 * Holder count at `toBlock`: replay every ERC-20 Transfer of `token` since
 * `fromBlock` and count addresses with a positive balance. Pools and
 * contracts count as holders, the same as on a block explorer.
 * Returns null when the replay is incomplete: an address that sent more than it
 * received means transfers before `fromBlock` were missed, so no count is honest.
 */
export async function holdersAt(rpc: Pick<RpcClient, 'getLogs'>, token: string, fromBlock: number, toBlock: number): Promise<number | null> {
  const logs = await rpc.getLogs({ fromBlock, toBlock, address: token, topics: [TOPICS.transfer] });
  const balances = new Map<string, bigint>();
  for (const log of logs) {
    if (log.topics.length !== 3 || log.data.length < 66) continue; // ERC-721 transfers index the id instead
    const value = BigInt(log.data.slice(0, 66));
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (from !== NATIVE) balances.set(from, (balances.get(from) ?? 0n) - value);
    if (to !== NATIVE) balances.set(to, (balances.get(to) ?? 0n) + value);
  }
  let holders = 0;
  for (const balance of balances.values()) {
    if (balance < 0n) return null;
    if (balance > 0n) holders++;
  }
  return holders;
}
