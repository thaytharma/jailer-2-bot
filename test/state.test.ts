import { describe, expect, it } from 'vitest';
import { emptyState, parseState, serializeState, type BotState } from '../src/state.js';

const sample = (): BotState => ({
  version: 1,
  movies: {
    'Jailer 2': {
      notifiedLevel: 'listed',
      listedAt: '2026-09-24T13:00:00.000Z',
      sources: {
        filmweb: { level: 'listed', brokenRuns: 0, brokenWarningSent: false, lastCheckedAt: '2026-09-24T13:00:00.000Z' },
        nfkino: {
          level: 'error',
          brokenRuns: 2,
          brokenWarningSent: false,
          lastCheckedAt: '2026-09-24T13:00:00.000Z',
          lastError: 'HTTP 503',
        },
      },
    },
  },
});

describe('state serialization', () => {
  it('round-trips without loss', () => {
    expect(parseState(serializeState(sample()))).toEqual(sample());
  });

  it('ends with a newline so git is happy', () => {
    expect(serializeState(sample()).endsWith('\n')).toBe(true);
  });
});

describe('parseState resilience', () => {
  it.each([
    ['invalid json', 'not json at all'],
    ['empty string', ''],
    ['an array', '[]'],
    ['null', 'null'],
    ['an object without movies', '{"version":1}'],
    ['movies set to null', '{"version":1,"movies":null}'],
  ])('falls back to empty state for %s rather than crashing the run', (_label, raw) => {
    expect(parseState(raw)).toEqual(emptyState());
  });
});
