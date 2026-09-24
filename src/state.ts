import type { Level } from './sources/types.js';

export interface SourceHealth {
  /** What the source said last run, or `error` if it could not be read. */
  level: Level | 'error';
  /** Consecutive runs the source failed. */
  brokenRuns: number;
  /** True once we have warned about the current broken streak, so we warn once. */
  brokenWarningSent: boolean;
  lastCheckedAt: string;
  lastError?: string;
}

export interface MovieState {
  /**
   * The highest milestone actually delivered. Only ever rises: a film that
   * briefly drops off a programme and comes back must not alert twice.
   */
  notifiedLevel: Level;
  listedAt?: string;
  onSaleAt?: string;
  sources: Record<string, SourceHealth>;
}

export interface BotState {
  version: 1;
  /** Keyed by the watched title, so changing MOVIE starts fresh. */
  movies: Record<string, MovieState>;
}

export const emptyState = (): BotState => ({ version: 1, movies: {} });

export const emptyMovie = (): MovieState => ({ notifiedLevel: 'absent', sources: {} });

export function parseState(raw: string): BotState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'movies' in parsed &&
      typeof (parsed as BotState).movies === 'object' &&
      (parsed as BotState).movies !== null
    ) {
      return { version: 1, movies: (parsed as BotState).movies };
    }
  } catch {
    // Fall through: a corrupt state file must not stop the bot from checking.
  }
  return emptyState();
}

export function serializeState(state: BotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export async function loadState(path: string): Promise<BotState> {
  const { readFile } = await import('node:fs/promises');
  try {
    return parseState(await readFile(path, 'utf8'));
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: BotState): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, serializeState(state), 'utf8');
}
