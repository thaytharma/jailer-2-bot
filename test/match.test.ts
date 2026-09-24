import { describe, expect, it } from 'vitest';
import { matchesMovie, normalizeTitle } from '../src/match.js';

describe('matchesMovie', () => {
  it.each([
    'Jailer 2',
    'JAILER 2',
    'Jailer 2 - Tamilfilm',
    'Jailer 2 (Tamil)',
    'Jailer II',
    'Jailer-2',
    'Rajinikanth: Jailer 2',
  ])('matches %s', (title) => {
    expect(matchesMovie(title, 'Jailer 2')).toBe(true);
  });

  it.each(['Jailer', 'Jailer - Tamilfilm', 'Jailer 21', 'The Jailers 2', 'Jailer 3', 'Porattam - Tamilfilm'])(
    'does not match %s',
    (title) => {
      expect(matchesMovie(title, 'Jailer 2')).toBe(false);
    },
  );

  it('ignores accents and case in both directions', () => {
    expect(matchesMovie('GLEMSELENS ØY', 'glemselens øy')).toBe(true);
    expect(matchesMovie('Café Society', 'cafe society')).toBe(true);
  });

  it('never matches an empty watched title', () => {
    expect(matchesMovie('Jailer 2', '')).toBe(false);
    expect(matchesMovie('Jailer 2', ' - ')).toBe(false);
  });
});

describe('normalizeTitle', () => {
  it('collapses punctuation and reads roman numerals as digits', () => {
    expect(normalizeTitle('  Jailer II – Tamilfilm! ')).toBe('jailer 2 tamilfilm');
  });

  it('drops HTML entities rather than matching on them', () => {
    expect(normalizeTitle('Alice&#039;s Adventures')).toBe('alice s adventures');
  });
});
