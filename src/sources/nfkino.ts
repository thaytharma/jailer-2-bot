/**
 * nfkino.no's Oslo programme. Server-rendered Drupal: every film, showing now
 * or coming soon, is one `<li class="js-movie-item movie-item">` holding its
 * title and, once tickets are on sale, links to `/screening/<id>/<id>`.
 *
 * Redundant with filmweb (which carries NF Kino's showtimes too) on purpose:
 * it is a second, independent path, so one of them breaking does not blind us.
 */

import type { Http } from '../fetch.js';
import { decodeEntities } from '../html.js';
import { matchesMovie } from '../match.js';
import type { Sighting, Source } from './types.js';

export const PROGRAMME_URL = 'https://www.nfkino.no/kinoprogram-oslo';
const BASE = 'https://www.nfkino.no';

/** The Oslo programme has well over a hundred films; far fewer means the markup changed. */
export const MIN_MOVIES = 5;

const ITEM_START = '<li class="js-movie-item movie-item"';
const TITLE = /<h2 class="movie-title">[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/;
const FILM_LINK = /<h2 class="movie-title">\s*<a href="([^"]+)"/;
const SCREENING = /href="((?:https:\/\/(?:www\.)?nfkino\.no)?\/screening\/[^"]+)"/g;

export interface ProgrammeItem {
  title: string;
  filmUrl: string | null;
  screeningUrls: string[];
}

const absolute = (href: string) => (href.startsWith('http') ? href : `${BASE}${href}`);

export function parseProgramme(html: string): ProgrammeItem[] {
  return html
    .split(ITEM_START)
    .slice(1)
    .flatMap((chunk) => {
      const title = TITLE.exec(chunk)?.[1];
      if (title === undefined) return [];
      const link = FILM_LINK.exec(chunk)?.[1];
      return [
        {
          title: decodeEntities(title.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
          filmUrl: link ? absolute(link) : null,
          screeningUrls: [...new Set([...chunk.matchAll(SCREENING)].map((m) => absolute(m[1]!)))],
        },
      ];
    });
}

export function sightingFrom(items: ProgrammeItem[], movie: string): Sighting {
  if (items.length < MIN_MOVIES) {
    throw new Error(`only ${items.length} films on the NF Kino Oslo programme — markup changed?`);
  }
  const matches = items.filter((item) => matchesMovie(item.title, movie));
  const screeningUrls = [...new Set(matches.flatMap((item) => item.screeningUrls))];
  return {
    level: screeningUrls.length > 0 ? 'on_sale' : matches.length > 0 ? 'listed' : 'absent',
    titles: [...new Set(matches.map((item) => item.title))],
    premiere: null,
    // The programme only links screenings; times and halls live behind each link.
    screenings: screeningUrls.map((ticketUrl) => ({ cinema: 'NF Kino Oslo', start: '', ticketUrl })),
    url: matches.find((item) => item.filmUrl)?.filmUrl ?? PROGRAMME_URL,
  };
}

export const nfkino: Source = {
  id: 'nfkino',
  label: 'nfkino.no',
  homepage: PROGRAMME_URL,
  check: async (movie, http) => sightingFrom(parseProgramme(await http(PROGRAMME_URL)), movie),
};
