import type { Http } from '../fetch.js';

/**
 * How far along the film is at one source, in the order it gets there:
 *   absent  → not mentioned anywhere
 *   listed  → on the programme / coming-soon list, no bookable showtimes yet
 *   on_sale → at least one bookable showtime in Oslo
 */
export type Level = 'absent' | 'listed' | 'on_sale';

export const LEVEL_RANK: Record<Level, number> = { absent: 0, listed: 1, on_sale: 2 };

export interface Screening {
  cinema: string;
  /** Local Oslo time as the source reports it, e.g. "2026-10-02T18:00:00". */
  start: string;
  ticketUrl: string | null;
}

export interface Sighting {
  level: Level;
  /** Every listed title that matched, as the source spells it. */
  titles: string[];
  /** Earliest premiere date the source gives, if any. */
  premiere: string | null;
  screenings: Screening[];
  /** Where a human should look: the film's page, or the programme. */
  url: string;
}

export interface Source {
  id: string;
  /** Shown to a human, e.g. "filmweb.no". */
  label: string;
  /** The page a human would check by hand. */
  homepage: string;
  /**
   * Throws when the source cannot be read *or* looks wrong (e.g. an empty
   * programme), so a broken scraper is never mistaken for "not listed yet".
   */
  check(movie: string, http: Http): Promise<Sighting>;
}
