import type { MovieState, SourceHealth } from './state.js';
import { LEVEL_RANK, type Level, type Screening, type Sighting } from './sources/types.js';

export interface Notification {
  kind: 'listed' | 'on_sale' | 'broken';
  title: string;
  body: string;
  url: string;
  /** ntfy priority: 5 = max (bypasses phone quiet hours), 4 = high, 3 = default. */
  priority: 3 | 4 | 5;
  tags: string[];
  /** For `broken` warnings: which source, so a failed delivery re-arms only that one. */
  sourceId?: string;
}

export type CheckResult = { ok: true; sighting: Sighting } | { ok: false; error: string };

export interface SourceResult {
  id: string;
  label: string;
  homepage: string;
  result: CheckResult;
}

export interface Outcome {
  next: MovieState;
  notifications: Notification[];
}

/** Consecutive failed runs before we assume a source's scraper is broken. */
export const BROKEN_RUN_THRESHOLD = 3;

/** How many upcoming screenings to spell out in the push. */
const SHOWN_SCREENINGS = 3;

/** "2026-10-02T18:00:00" → "02.10 kl. 18:00". Times are already Oslo local. */
export function formatStart(start: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(start);
  if (!match) return start;
  const [, , month, day, hour, minute] = match;
  return `${day}.${month} kl. ${hour}:${minute}`;
}

/** "2026-10-02" → "02.10.2026". */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date;
}

function healthFor(previous: SourceHealth | undefined, result: CheckResult, now: string): SourceHealth {
  if (result.ok) {
    return { level: result.sighting.level, brokenRuns: 0, brokenWarningSent: false, lastCheckedAt: now };
  }
  return {
    level: 'error',
    brokenRuns: (previous?.brokenRuns ?? 0) + 1,
    brokenWarningSent: previous?.brokenWarningSent ?? false,
    lastCheckedAt: now,
    lastError: result.error,
  };
}

/** Timed screenings first (filmweb knows the times), then bare ticket links. */
function bestScreenings(sightings: Sighting[]): Screening[] {
  const all = sightings.flatMap((sighting) => sighting.screenings);
  const timed = all.filter((s) => s.start !== '').sort((a, b) => a.start.localeCompare(b.start));
  return timed.length > 0 ? timed : all;
}

function milestone(
  movie: string,
  level: Exclude<Level, 'absent'>,
  seenAt: Array<{ label: string; sighting: Sighting }>,
): Notification {
  const sightings = seenAt.map((s) => s.sighting);
  const where = seenAt.map((s) => s.label).join(' og ');
  const titles = [...new Set(sightings.flatMap((s) => s.titles))].filter((t) => t !== '');
  const premiere = sightings
    .map((s) => s.premiere)
    .filter((date): date is string => date !== null)
    .sort()[0];
  const listedAs = titles.length > 0 ? `Oppført som: ${titles.join(', ')}` : null;

  if (level === 'listed') {
    return {
      kind: 'listed',
      title: `${movie} er lagt ut!`,
      body: [
        `${movie} er nå lagt ut på ${where}.`,
        listedAs,
        premiere ? `Premiere: ${formatDate(premiere)}` : null,
        'Ingen billetter ennå — du får et nytt varsel når billettsalget åpner.',
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
      url: seenAt[0]!.sighting.url,
      priority: 4,
      tags: ['clapper', 'eyes'],
    };
  }

  const screenings = bestScreenings(sightings);
  const lines = screenings
    .slice(0, SHOWN_SCREENINGS)
    .filter((s) => s.start !== '')
    .map((s) => `• ${formatStart(s.start)} — ${s.cinema}`);
  const more = screenings.length - lines.length;

  return {
    kind: 'on_sale',
    title: `Billetter til ${movie} er ute!`,
    body: [
      `Billettsalget for ${movie} i Oslo har åpnet (${where}).`,
      listedAs,
      ...lines,
      lines.length > 0 && more > 0 ? `…og ${more} visninger til.` : null,
      lines.length === 0 ? `${screenings.length} visninger lagt ut.` : null,
      'Skynd deg!',
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    url: screenings.find((s) => s.ticketUrl)?.ticketUrl ?? seenAt[0]!.sighting.url,
    priority: 5,
    tags: ['rotating_light', 'ticket'],
  };
}

/**
 * Pure decision step for one run over every source.
 *
 * Milestones are global, not per source: filmweb and nfkino will usually both
 * see the film, and one push naming both beats two identical pushes.
 *  - the highest level any healthy source reports, if above what was already
 *    notified → one push (jumping straight to on_sale skips the listed push)
 *  - a level at or below what was notified → silent, even if it went down
 *  - a source failing BROKEN_RUN_THRESHOLD runs in a row → one warning for
 *    that source, re-armed once it recovers
 */
export function decide(
  movie: string,
  previous: MovieState,
  results: SourceResult[],
  now: string,
): Outcome {
  const next: MovieState = { ...previous, sources: { ...previous.sources } };
  const notifications: Notification[] = [];

  for (const { id, label, homepage, result } of results) {
    const health = healthFor(previous.sources[id], result, now);
    next.sources[id] = health;

    if (!result.ok && health.brokenRuns >= BROKEN_RUN_THRESHOLD && !health.brokenWarningSent) {
      health.brokenWarningSent = true;
      notifications.push({
        kind: 'broken',
        title: 'Cinema bot may be broken',
        body: [
          `${health.brokenRuns} consecutive failed checks of ${label}.`,
          `Reason: ${result.error}`,
          `The other sources are still being checked, but fix this so ${movie} is not missed.`,
        ].join('\n'),
        url: homepage,
        priority: 3,
        tags: ['warning'],
        sourceId: id,
      });
    }
  }

  const seen = results.flatMap(({ label, result }) =>
    result.ok && result.sighting.level !== 'absent' ? [{ label, sighting: result.sighting }] : [],
  );
  const top = seen.reduce<Level>(
    (best, s) => (LEVEL_RANK[s.sighting.level] > LEVEL_RANK[best] ? s.sighting.level : best),
    'absent',
  );

  if (top === 'listed' || top === 'on_sale') {
    if (next.listedAt === undefined) next.listedAt = now;
    if (top === 'on_sale' && next.onSaleAt === undefined) next.onSaleAt = now;
  }

  if (top !== 'absent' && LEVEL_RANK[top] > LEVEL_RANK[previous.notifiedLevel]) {
    next.notifiedLevel = top;
    // Name every source that has reached this milestone, strongest reading first.
    const atTop = seen.filter((s) => s.sighting.level === top);
    notifications.unshift(milestone(movie, top, atTop));
  }

  return { next, notifications };
}
