import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RequestSpec } from '../../src/fetch.js';
import {
  checkFilmweb,
  ENDPOINT,
  filmweb,
  findMatches,
  realDate,
  toScreening,
  type FilmwebMovie,
} from '../../src/sources/filmweb.js';

const load = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8'));

/** Real API responses, captured 2026-09-24. */
const moviesFixture = load('filmweb-movies.json');
const showsFixture = load('filmweb-shows.json');

const movie = (title: string, id: string, premiere = '2026-10-09T00:00:00'): FilmwebMovie => ({
  title,
  titleOriginal: '',
  mainVersionId: id,
  premiere,
});

type Lists = { current?: FilmwebMovie[]; upcoming?: FilmwebMovie[]; search?: FilmwebMovie[] };

/** A fake filmweb: the real responses, plus whatever the test adds to each list. */
function fakeApi(add: Lists = {}, shows: unknown = { data: { showQuery: { getShows: [] } } }) {
  const base = moviesFixture.data.movieQuery;
  return vi.fn(async (_url: string, spec?: RequestSpec) => {
    const { query } = JSON.parse(spec!.body!) as { query: string };
    if (query.includes('getShows')) return JSON.stringify(shows);
    return JSON.stringify({
      data: {
        movieQuery: {
          current: [...base.current, ...(add.current ?? [])],
          upcoming: [...base.upcoming, ...(add.upcoming ?? [])],
          search: [...base.search, ...(add.search ?? [])],
        },
      },
    });
  });
}

describe('checkFilmweb', () => {
  it('reports absent on the real response, where Jailer 2 is nowhere yet', async () => {
    const sighting = await checkFilmweb('Jailer 2', fakeApi());
    expect(sighting).toMatchObject({ level: 'absent', titles: [], screenings: [] });
    expect(sighting.url).toBe('https://www.filmweb.no/program?location=Oslo');
  });

  it('posts GraphQL to the filmweb API, asking about Oslo and the watched title', async () => {
    const http = fakeApi();
    await checkFilmweb('Jailer 2', http);
    const [url, spec] = http.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(spec?.method).toBe('POST');
    expect(JSON.parse(spec!.body!).variables).toEqual({ movie: 'Jailer 2', location: 'Oslo' });
  });

  it('does not ask for showtimes when nothing matched', async () => {
    const http = fakeApi();
    await checkFilmweb('Jailer 2', http);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('reports listed from the coming-soon list, with the premiere date', async () => {
    const sighting = await checkFilmweb(
      'Jailer 2',
      fakeApi({ upcoming: [movie('Jailer 2 - Tamilfilm', 'EDI20269999')] }),
    );
    expect(sighting).toMatchObject({
      level: 'listed',
      titles: ['Jailer 2 - Tamilfilm'],
      premiere: '2026-10-09',
      url: 'https://www.filmweb.no/film/EDI20269999',
    });
  });

  it('reports listed from the national film database alone — the earliest signal', async () => {
    const sighting = await checkFilmweb('Jailer 2', fakeApi({ search: [movie('Jailer 2', 'PUT20260001')] }));
    expect(sighting.level).toBe('listed');
  });

  it('does not mistake the 2023 original, which the search returns for "Jailer"', async () => {
    const original = movie('Jailer', 'PUT20230021', '2023-08-10T00:00:00');
    expect((await checkFilmweb('Jailer 2', fakeApi({ search: [original] }))).level).toBe('absent');
  });

  it('matches on the original title too', async () => {
    const localised = { ...movie('Fengselsdirektøren 2', 'X1'), titleOriginal: 'Jailer 2' };
    expect((await checkFilmweb('Jailer 2', fakeApi({ upcoming: [localised] }))).level).toBe('listed');
  });

  it('reports on_sale with sorted screenings once Oslo showtimes exist', async () => {
    const http = fakeApi({ current: [movie('Jailer 2', 'EDI20269999')] }, showsFixture);
    const sighting = await checkFilmweb('Jailer 2', http);
    expect(sighting.level).toBe('on_sale');
    expect(sighting.screenings).toEqual([
      {
        cinema: 'NFKino Oslo Symra',
        start: '2026-09-25T20:15:00',
        ticketUrl: expect.stringMatching(/^https:\/\/nfkino\.no\/screening\//),
      },
      expect.objectContaining({ start: '2026-09-28T19:45:00' }),
    ]);
    const showsCall = JSON.parse(http.mock.calls[1]![1]!.body!);
    expect(showsCall.variables).toEqual({ movieId: 'EDI20269999', location: 'Oslo' });
  });

  it('looks up showtimes once per film, even when several lists carry it', async () => {
    const jailer = movie('Jailer 2', 'EDI20269999');
    const http = fakeApi({ current: [jailer], upcoming: [jailer], search: [jailer] });
    await checkFilmweb('Jailer 2', http);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('throws on a GraphQL error so it counts as a failed check', async () => {
    const http = vi.fn(async () => JSON.stringify({ errors: [{ message: 'Cannot query field' }] }));
    await expect(checkFilmweb('Jailer 2', http)).rejects.toThrow(/Cannot query field/);
  });

  it('throws on a response that is not JSON (e.g. a Cloudflare page)', async () => {
    const http = vi.fn(async () => '<html>Just a moment...</html>');
    await expect(checkFilmweb('Jailer 2', http)).rejects.toThrow();
  });

  it('throws when Oslo suddenly has almost nothing showing', async () => {
    const http = vi.fn(async () =>
      JSON.stringify({ data: { movieQuery: { current: [], upcoming: [], search: [] } } }),
    );
    await expect(checkFilmweb('Jailer 2', http)).rejects.toThrow(/API changed/);
  });

  it('is registered with a homepage for broken-bot alerts', () => {
    expect(filmweb.homepage).toBe('https://www.filmweb.no/program?location=Oslo');
  });
});

describe('helpers', () => {
  it('treats 0001-01-01 as no premiere date', () => {
    expect(realDate('0001-01-01T00:00:00')).toBeNull();
    expect(realDate(null)).toBeNull();
    expect(realDate('2026-10-02T00:00:00')).toBe('2026-10-02');
  });

  it('dedupes matches by movie id', () => {
    const a = movie('Jailer 2', 'A');
    expect(findMatches([a, a, movie('Jailer 2 - Tamilfilm', 'B')], 'Jailer 2')).toHaveLength(2);
  });

  it('names the chain and the hall, without repeating ODEON Oslo', () => {
    const show = { movieTitle: 'x', showStart: 's', ticketSaleUrl: null };
    expect(toScreening({ ...show, firmName: 'NFKino Oslo', theaterName: 'Ringen' }).cinema).toBe(
      'NFKino Oslo Ringen',
    );
    expect(toScreening({ ...show, firmName: 'ODEON Oslo', theaterName: 'ODEON Oslo' }).cinema).toBe(
      'ODEON Oslo',
    );
  });
});
