import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '../src/decide.js';
import { encodeHeader, sendNtfy } from '../src/notify/ntfy.js';

const onSale: Notification = {
  kind: 'on_sale',
  title: 'Billetter til Jailer 2 er ute!',
  body: 'Billettsalget for Jailer 2 i Oslo har åpnet.',
  url: 'https://nfkino.no/screening/a/b',
  priority: 5,
  tags: ['rotating_light', 'ticket'],
};

const ok = () => new Response('', { status: 200 });
const call = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[0] as unknown as [string, RequestInit];

describe('sendNtfy', () => {
  it('posts the body to the configured topic', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 'secret-topic', server: 'https://ntfy.sh' }, onSale, fetchMock as never);
    const [url, init] = call(fetchMock);
    expect(url).toBe('https://ntfy.sh/secret-topic');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(onSale.body);
  });

  it('sets priority, tags and a click-through to the tickets', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 't', server: 'https://ntfy.sh' }, onSale, fetchMock as never);
    const headers = call(fetchMock)[1].headers as Record<string, string>;
    expect(headers).toMatchObject({
      Title: 'Billetter til Jailer 2 er ute!',
      Priority: '5',
      Tags: 'rotating_light,ticket',
      Click: onSale.url,
    });
  });

  it('tolerates a trailing slash on the server url', async () => {
    const fetchMock = vi.fn(async () => ok());
    await sendNtfy({ topic: 't', server: 'https://ntfy.sh/' }, onSale, fetchMock as never);
    expect(call(fetchMock)[0]).toBe('https://ntfy.sh/t');
  });

  it('throws on a non-2xx response so the caller can retry next run', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 429 }));
    await expect(sendNtfy({ topic: 't', server: 'https://ntfy.sh' }, onSale, fetchMock as never)).rejects.toThrow(
      'HTTP 429',
    );
  });
});

describe('encodeHeader', () => {
  it('leaves ascii alone', () => {
    expect(encodeHeader('Jailer 2 er lagt ut!')).toBe('Jailer 2 er lagt ut!');
  });

  it('RFC 2047-encodes non-latin-1-safe titles', () => {
    const encoded = encodeHeader('Æøå');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8')).toBe('Æøå');
  });
});
