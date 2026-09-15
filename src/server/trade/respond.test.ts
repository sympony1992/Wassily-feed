import { describe, expect, it, vi } from 'vitest';
import { tradeError } from './respond';
import { TradeRefused } from './service';

describe('Trade responses', () => {
  it('answers a refusal with its own message and status', async () => {
    const res = tradeError(new TradeRefused('The jar is not full, so quick buy is locked.', 403));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'The jar is not full, so quick buy is locked.' });
  });

  it('recognises a refusal thrown by another bundle’s copy of the class', async () => {
    class OtherBundleRefusal extends Error {
      readonly name = 'TradeRefused';
      constructor(
        message: string,
        readonly status: number,
      ) {
        super(message);
      }
    }
    const res = tradeError(new OtherBundleRefusal('This server runs a simulated market: there is nothing real to buy.', 403));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This server runs a simulated market: there is nothing real to buy.' });
  });

  it('hides anything else behind a generic 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = tradeError(new Error('internal detail that must not reach the page'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong. Try again.' });
    log.mockRestore();
  });
});
