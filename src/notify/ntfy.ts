import type { Notification } from '../decide.js';

export interface NtfyConfig {
  topic: string;
  server: string;
}

/**
 * Send via ntfy.sh. The topic name is the only secret, so it must be
 * unguessable — anyone who knows it can read and post to it.
 */
export async function sendNtfy(
  config: NtfyConfig,
  notification: Notification,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${config.server.replace(/\/$/, '')}/${config.topic}`, {
    method: 'POST',
    body: notification.body,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Title: encodeHeader(notification.title),
      Priority: String(notification.priority),
      Tags: notification.tags.join(','),
      Click: notification.url,
    },
  });
  if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
}

/**
 * HTTP headers must be latin-1, and titles may carry æøå or emoji. ntfy
 * decodes RFC 2047 encoded-words, so use that for anything non-ASCII.
 */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
