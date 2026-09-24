import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MOVIE, loadConfig } from '../src/config.js';
import { fetchText } from '../src/fetch.js';

describe('loadConfig', () => {
  it('watches for Jailer 2 by default', () => {
    expect(DEFAULT_MOVIE).toBe('Jailer 2');
    expect(loadConfig({}).movie).toBe('Jailer 2');
  });

  it('can watch another film', () => {
    expect(loadConfig({ MOVIE: ' Coolie ' }).movie).toBe('Coolie');
  });

  it('disables ntfy when no topic is set', () => {
    expect(loadConfig({}).ntfy).toBeNull();
  });

  it('enables ntfy from a topic alone, defaulting to ntfy.sh', () => {
    expect(loadConfig({ NTFY_TOPIC: 'j2-abc123' }).ntfy).toEqual({ topic: 'j2-abc123', server: 'https://ntfy.sh' });
  });

  it('allows a self-hosted ntfy server', () => {
    expect(loadConfig({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://push.me' }).ntfy?.server).toBe('https://push.me');
  });

  /** GitHub Actions passes unset secrets and vars as empty strings. */
  it('treats empty and whitespace-only values as unset', () => {
    const config = loadConfig({ MOVIE: '', NTFY_TOPIC: 'j2', NTFY_SERVER: '', STATE_PATH: '  ' });
    expect(config).toEqual({
      movie: 'Jailer 2',
      statePath: 'state.json',
      ntfy: { topic: 'j2', server: 'https://ntfy.sh' },
    });
    expect(loadConfig({ NTFY_TOPIC: '   ' }).ntfy).toBeNull();
  });
});

describe('fetchText', () => {
  const noSleep = async () => {};

  it('identifies as a browser and asks in Norwegian', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    await expect(fetchText('https://x.no', {}, { fetchImpl: fetchImpl as never })).resolves.toBe('ok');
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers['Accept-Language']).toMatch(/^nb-NO/);
    expect(init.method).toBe('GET');
  });

  it('sends a POST body and merges extra headers', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await fetchText(
      'https://api.x.no',
      { method: 'POST', body: '{"q":1}', headers: { 'Content-Type': 'application/json' } },
      { fetchImpl: fetchImpl as never },
    );
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"q":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('retries a transient failure and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await expect(fetchText('https://x.no', {}, { fetchImpl: fetchImpl as never, sleep: noSleep })).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured attempts and reports the last error', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    await expect(
      fetchText('https://x.no', {}, { attempts: 2, fetchImpl: fetchImpl as never, sleep: noSleep }),
    ).rejects.toThrow('failed after 2 attempts: HTTP 403');
  });

  it('backs off progressively between attempts', async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    await fetchText('https://x.no', {}, {
      attempts: 3,
      fetchImpl: fetchImpl as never,
      sleep: async (ms) => void waits.push(ms),
    }).catch(() => {});
    expect(waits).toEqual([2000, 4000]);
  });
});
