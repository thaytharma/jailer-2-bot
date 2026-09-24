import { describe, expect, it } from 'vitest';
import {
  BROKEN_RUN_THRESHOLD,
  decide,
  formatDate,
  formatStart,
  type CheckResult,
  type SourceResult,
} from '../src/decide.js';
import type { Level, Sighting } from '../src/sources/types.js';
import { emptyMovie, type MovieState } from '../src/state.js';

const MOVIE = 'Jailer 2';
const NOW = '2026-09-24T13:00:00.000Z';

const sighting = (level: Level, overrides: Partial<Sighting> = {}): Sighting => ({
  level,
  titles: level === 'absent' ? [] : ['Jailer 2 - Tamilfilm'],
  premiere: null,
  screenings: [],
  url: 'https://www.filmweb.no/film/EDI20269999',
  ...overrides,
});

const ok = (s: Sighting): CheckResult => ({ ok: true, sighting: s });
const fail = (error = 'HTTP 503'): CheckResult => ({ ok: false, error });

const filmweb = (result: CheckResult): SourceResult => ({
  id: 'filmweb',
  label: 'filmweb.no',
  homepage: 'https://www.filmweb.no/program?location=Oslo',
  result,
});
const nfkino = (result: CheckResult): SourceResult => ({
  id: 'nfkino',
  label: 'nfkino.no',
  homepage: 'https://www.nfkino.no/kinoprogram-oslo',
  result,
});

const onSale = sighting('on_sale', {
  premiere: '2026-10-09',
  screenings: [
    { cinema: 'ODEON Oslo', start: '2026-10-09T21:00:00', ticketUrl: 'https://odeon/2' },
    { cinema: 'NFKino Oslo Symra', start: '2026-10-09T18:00:00', ticketUrl: 'https://nfkino/1' },
    { cinema: 'NFKino Oslo Ringen', start: '2026-10-10T18:00:00', ticketUrl: 'https://nfkino/3' },
    { cinema: 'ODEON Oslo', start: '2026-10-11T18:00:00', ticketUrl: 'https://odeon/4' },
  ],
});

/** Run decide() repeatedly, carrying state, and return every notification sent. */
function runs(results: SourceResult[][], start: MovieState = emptyMovie()) {
  let state = start;
  const sent = [];
  for (const run of results) {
    const outcome = decide(MOVIE, state, run, NOW);
    state = outcome.next;
    sent.push(...outcome.notifications);
  }
  return { state, sent };
}

describe('decide — milestones', () => {
  it('stays silent while the film is nowhere', () => {
    const { notifications, next } = decide(MOVIE, emptyMovie(), [filmweb(ok(sighting('absent'))), nfkino(ok(sighting('absent')))], NOW);
    expect(notifications).toEqual([]);
    expect(next.notifiedLevel).toBe('absent');
    expect(next.listedAt).toBeUndefined();
  });

  it('notifies once when the film is first listed', () => {
    const { notifications, next } = decide(
      MOVIE,
      emptyMovie(),
      [filmweb(ok(sighting('listed', { premiere: '2026-10-09' }))), nfkino(ok(sighting('absent')))],
      NOW,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: 'listed', priority: 4, title: 'Jailer 2 er lagt ut!' });
    expect(notifications[0]!.body).toContain('filmweb.no');
    expect(notifications[0]!.body).toContain('Premiere: 09.10.2026');
    expect(notifications[0]!.body).toContain('Jailer 2 - Tamilfilm');
    expect(notifications[0]!.url).toBe('https://www.filmweb.no/film/EDI20269999');
    expect(next).toMatchObject({ notifiedLevel: 'listed', listedAt: NOW });
  });

  it('sends one push naming both sources, not one per source', () => {
    const { notifications } = decide(
      MOVIE,
      emptyMovie(),
      [filmweb(ok(sighting('listed'))), nfkino(ok(sighting('listed')))],
      NOW,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.body).toContain('filmweb.no og nfkino.no');
  });

  it('stays silent on later runs while still only listed', () => {
    const listed = [filmweb(ok(sighting('listed')))];
    expect(runs([listed, listed, listed]).sent).toHaveLength(1);
  });

  it('notifies again, at max priority, when tickets go on sale', () => {
    const { sent, state } = runs([[filmweb(ok(sighting('listed')))], [filmweb(ok(onSale))]]);
    expect(sent.map((n) => n.kind)).toEqual(['listed', 'on_sale']);
    expect(sent[1]).toMatchObject({ priority: 5, title: 'Billetter til Jailer 2 er ute!' });
    expect(state).toMatchObject({ notifiedLevel: 'on_sale', onSaleAt: NOW });
  });

  it('skips the listed push when a film goes straight on sale', () => {
    const { notifications } = decide(MOVIE, emptyMovie(), [filmweb(ok(onSale))], NOW);
    expect(notifications.map((n) => n.kind)).toEqual(['on_sale']);
  });

  it('lists the earliest screenings in time order and links the first ticket', () => {
    const { notifications } = decide(MOVIE, emptyMovie(), [filmweb(ok(onSale))], NOW);
    const body = notifications[0]!.body;
    expect(body).toContain('• 09.10 kl. 18:00 — NFKino Oslo Symra');
    expect(body.indexOf('18:00 — NFKino Oslo Symra')).toBeLessThan(body.indexOf('21:00 — ODEON Oslo'));
    expect(body).toContain('…og 1 visninger til.');
    expect(notifications[0]!.url).toBe('https://nfkino/1');
  });

  it('prefers filmweb’s timed screenings over nfkino’s bare links', () => {
    const bare = sighting('on_sale', { screenings: [{ cinema: 'NF Kino Oslo', start: '', ticketUrl: 'https://nfkino/bare' }] });
    const { notifications } = decide(MOVIE, emptyMovie(), [nfkino(ok(bare)), filmweb(ok(onSale))], NOW);
    expect(notifications[0]!.url).toBe('https://nfkino/1');
    expect(notifications[0]!.body).toContain('nfkino.no og filmweb.no');
  });

  it('still alerts with a ticket link when only untimed screenings are known', () => {
    const bare = sighting('on_sale', {
      screenings: [
        { cinema: 'NF Kino Oslo', start: '', ticketUrl: 'https://nfkino/a' },
        { cinema: 'NF Kino Oslo', start: '', ticketUrl: 'https://nfkino/b' },
      ],
    });
    const { notifications } = decide(MOVIE, emptyMovie(), [nfkino(ok(bare))], NOW);
    expect(notifications[0]!.url).toBe('https://nfkino/a');
    expect(notifications[0]!.body).toContain('2 visninger lagt ut.');
    expect(notifications[0]!.body).not.toContain('•');
  });

  it('never alerts twice for a film that drops off and comes back', () => {
    const { sent } = runs([
      [filmweb(ok(onSale))],
      [filmweb(ok(sighting('absent')))],
      [filmweb(ok(sighting('listed')))],
      [filmweb(ok(onSale))],
    ]);
    expect(sent).toHaveLength(1);
  });

  it('keeps the milestone timestamps from the first time they were reached', () => {
    const first = decide(MOVIE, emptyMovie(), [filmweb(ok(onSale))], NOW);
    const later = decide(MOVIE, first.next, [filmweb(ok(onSale))], '2026-09-25T00:00:00.000Z');
    expect(later.next).toMatchObject({ listedAt: NOW, onSaleAt: NOW });
  });

  it('still reports a milestone seen by one source while the other is failing', () => {
    const { notifications } = decide(MOVIE, emptyMovie(), [filmweb(fail()), nfkino(ok(sighting('listed')))], NOW);
    expect(notifications.map((n) => n.kind)).toEqual(['listed']);
    expect(notifications[0]!.body).not.toContain('filmweb.no');
  });
});

describe('decide — self-monitoring', () => {
  it('does not cry wolf on a single failure', () => {
    const { notifications, next } = decide(MOVIE, emptyMovie(), [filmweb(fail())], NOW);
    expect(notifications).toEqual([]);
    expect(next.sources.filmweb).toMatchObject({ level: 'error', brokenRuns: 1, lastError: 'HTTP 503' });
  });

  it('warns once a source fails the threshold number of runs in a row', () => {
    const { sent } = runs(Array.from({ length: BROKEN_RUN_THRESHOLD }, () => [filmweb(fail('HTTP 403'))]));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'broken',
      priority: 3,
      sourceId: 'filmweb',
      url: 'https://www.filmweb.no/program?location=Oslo',
    });
    expect(sent[0]!.body).toContain('HTTP 403');
    expect(sent[0]!.body).toContain('filmweb.no');
  });

  it('warns only once per broken streak', () => {
    const { sent } = runs(Array.from({ length: BROKEN_RUN_THRESHOLD + 5 }, () => [nfkino(fail())]));
    expect(sent).toHaveLength(1);
  });

  it('tracks each source separately', () => {
    const { sent, state } = runs(
      Array.from({ length: BROKEN_RUN_THRESHOLD }, () => [filmweb(ok(sighting('absent'))), nfkino(fail())]),
    );
    expect(sent.map((n) => n.sourceId)).toEqual(['nfkino']);
    expect(state.sources.filmweb!.brokenRuns).toBe(0);
  });

  it('resets and re-arms once the source recovers', () => {
    const broken = Array.from({ length: BROKEN_RUN_THRESHOLD }, () => [filmweb(fail())]);
    const { sent } = runs([...broken, [filmweb(ok(sighting('absent')))], ...broken]);
    expect(sent.filter((n) => n.kind === 'broken')).toHaveLength(2);
  });

  it('puts the milestone first when both happen in one run', () => {
    const start: MovieState = {
      ...emptyMovie(),
      sources: { nfkino: { level: 'error', brokenRuns: BROKEN_RUN_THRESHOLD - 1, brokenWarningSent: false, lastCheckedAt: NOW } },
    };
    const { notifications } = decide(MOVIE, start, [filmweb(ok(onSale)), nfkino(fail())], NOW);
    expect(notifications.map((n) => n.kind)).toEqual(['on_sale', 'broken']);
  });
});

describe('formatting', () => {
  it('formats Oslo-local show times', () => {
    expect(formatStart('2026-10-02T18:05:00')).toBe('02.10 kl. 18:05');
    expect(formatStart('whenever')).toBe('whenever');
  });

  it('formats dates the Norwegian way', () => {
    expect(formatDate('2026-10-02')).toBe('02.10.2026');
  });
});
