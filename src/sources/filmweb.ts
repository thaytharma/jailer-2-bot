/**
 * filmweb.no, read through the GraphQL API its own programme page uses
 * (https://www.filmweb.no/program?location=Oslo is rendered client-side, so the
 * HTML has no programme in it).
 *
 * This one source covers every Oslo cinema chain: NF Kino, ODEON Oslo, Vega
 * and Kunstnernes Hus all publish their showtimes through filmweb. That matters
 * because odeonkino.no itself sits behind a Cloudflare challenge and cannot be
 * fetched without a real browser.
 *
 * Three places a film can turn up, earliest first:
 *  1. the national film database (`searchForMovies`) — a distributor has
 *     registered it for Norway, often weeks before any cinema lists it
 *  2. Oslo's coming-soon and now-showing lists
 *  3. Oslo showtimes (`getShows`) — tickets are bookable
 */

import type { Http } from '../fetch.js';
import { matchesMovie } from '../match.js';
import type { Screening, Sighting, Source } from './types.js';

export const ENDPOINT = 'https://movieinfoqs.filmweb.no/graphql';
const LOCATION = 'Oslo';
const PROGRAMME_URL = `https://www.filmweb.no/program?location=${LOCATION}`;

/** Oslo always has well over a hundred films showing; far fewer means the API changed. */
export const MIN_CURRENT_MOVIES = 5;

const MOVIE_FIELDS = 'title titleOriginal mainVersionId premiere';

export const MOVIES_QUERY = `query($movie: String!, $location: String!) {
  movieQuery {
    current: getCurrentMovies(location: $location) { ${MOVIE_FIELDS} }
    upcoming: getUpcomingMovies(location: $location, includeIndependent: true) { ${MOVIE_FIELDS} }
    search: searchForMovies(searchText: $movie, maxNumItems: 20) { ${MOVIE_FIELDS} }
  }
}`;

export const SHOWS_QUERY = `query($movieId: String!, $location: String!) {
  showQuery {
    getShows(movieId: $movieId, location: $location, removePastShows: true) {
      movieTitle theaterName firmName showStart ticketSaleUrl
    }
  }
}`;

export interface FilmwebMovie {
  title: string | null;
  titleOriginal: string | null;
  mainVersionId: string | null;
  premiere: string | null;
}

interface FilmwebShow {
  movieTitle: string | null;
  theaterName: string | null;
  firmName: string | null;
  showStart: string | null;
  ticketSaleUrl: string | null;
}

interface MoviesData {
  movieQuery: { current: FilmwebMovie[]; upcoming: FilmwebMovie[]; search: FilmwebMovie[] };
}

interface ShowsData {
  showQuery: { getShows: FilmwebShow[] };
}

async function graphql<T>(http: Http, query: string, variables: Record<string, string>): Promise<T> {
  const raw = await http(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.filmweb.no' },
    body: JSON.stringify({ query, variables }),
  });
  const parsed = JSON.parse(raw) as { data?: T; errors?: Array<{ message: string }> };
  if (parsed.errors?.length) throw new Error(`filmweb GraphQL: ${parsed.errors[0]!.message}`);
  if (parsed.data == null) throw new Error('filmweb GraphQL: no data in response');
  return parsed.data;
}

/** filmweb uses 0001-01-01 for "no premiere date". */
export function realDate(value: string | null): string | null {
  if (value === null || value.startsWith('0001-')) return null;
  return value.slice(0, 10);
}

export function findMatches(movies: FilmwebMovie[], movie: string): FilmwebMovie[] {
  const byId = new Map<string, FilmwebMovie>();
  for (const candidate of movies) {
    const titles = [candidate.title, candidate.titleOriginal].filter((t): t is string => !!t);
    if (!titles.some((title) => matchesMovie(title, movie))) continue;
    byId.set(candidate.mainVersionId ?? candidate.title ?? '', candidate);
  }
  return [...byId.values()];
}

export function toScreening(show: FilmwebShow): Screening {
  const cinema =
    show.theaterName && show.firmName && !show.firmName.includes(show.theaterName)
      ? `${show.firmName} ${show.theaterName}`
      : (show.theaterName ?? show.firmName ?? 'ukjent kino');
  return { cinema, start: show.showStart ?? '', ticketUrl: show.ticketSaleUrl };
}

export async function checkFilmweb(movie: string, http: Http): Promise<Sighting> {
  const { movieQuery } = await graphql<MoviesData>(http, MOVIES_QUERY, { movie, location: LOCATION });

  if (!Array.isArray(movieQuery?.current) || movieQuery.current.length < MIN_CURRENT_MOVIES) {
    throw new Error(
      `only ${movieQuery?.current?.length ?? 0} films showing in ${LOCATION} — API changed?`,
    );
  }

  const inOslo = findMatches([...movieQuery.current, ...(movieQuery.upcoming ?? [])], movie);
  const inDatabase = findMatches(movieQuery.search ?? [], movie);
  const matches = findMatches([...inOslo, ...inDatabase], movie);

  const screenings: Screening[] = [];
  for (const match of matches) {
    if (!match.mainVersionId) continue;
    const { showQuery } = await graphql<ShowsData>(http, SHOWS_QUERY, {
      movieId: match.mainVersionId,
      location: LOCATION,
    });
    screenings.push(...(showQuery?.getShows ?? []).map(toScreening));
  }
  screenings.sort((a, b) => a.start.localeCompare(b.start));

  const premieres = matches
    .map((match) => realDate(match.premiere))
    .filter((date): date is string => date !== null)
    .sort();
  const first = matches.find((match) => match.mainVersionId);

  return {
    level: screenings.length > 0 ? 'on_sale' : matches.length > 0 ? 'listed' : 'absent',
    titles: [...new Set(matches.map((match) => match.title ?? match.titleOriginal ?? ''))],
    premiere: premieres[0] ?? null,
    screenings,
    url: first ? `https://www.filmweb.no/film/${first.mainVersionId}` : PROGRAMME_URL,
  };
}

export const filmweb: Source = {
  id: 'filmweb',
  label: 'filmweb.no',
  homepage: PROGRAMME_URL,
  check: checkFilmweb,
};
