import type { NtfyConfig } from './notify/ntfy.js';

export interface Config {
  movie: string;
  statePath: string;
  ntfy: NtfyConfig | null;
}

export const DEFAULT_MOVIE = 'Jailer 2';

/**
 * GitHub Actions injects unset secrets and vars as empty strings, not as absent
 * keys, so `??` is not enough — an empty value must count as "not configured".
 */
const str = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const ntfyTopic = str(env.NTFY_TOPIC);
  return {
    movie: str(env.MOVIE) ?? DEFAULT_MOVIE,
    statePath: str(env.STATE_PATH) ?? 'state.json',
    ntfy: ntfyTopic
      ? { topic: ntfyTopic, server: str(env.NTFY_SERVER) ?? 'https://ntfy.sh' }
      : null,
  };
}
