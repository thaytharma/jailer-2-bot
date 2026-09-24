import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nfkino, parseProgramme, PROGRAMME_URL, sightingFrom, type ProgrammeItem } from '../../src/sources/nfkino.js';

const fixture = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'nfkino-oslo.html'), 'utf8');

/** A real item from the fixture, retitled — exactly how Jailer 2 would appear. */
const withTitle = (html: string, from: string, to: string) => html.replaceAll(from, to);

const filler = (n: number): ProgrammeItem[] =>
  Array.from({ length: n }, (_, i) => ({ title: `Film ${i}`, filmUrl: null, screeningUrls: [] }));

describe('parseProgramme on the real Oslo programme', () => {
  const items = parseProgramme(fixture);

  it('finds every film on the page', () => {
    expect(items.map((item) => item.title)).toEqual([
      'Porattam - Tamilfilm',
      'Meesaya Murukku 2',
      'Calle Malaga',
      'Street Fighter',
      'Blue Lock (Burû Rokku)',
      'Avengers: Doomsday',
    ]);
  });

  it('collects the screening links of a film on sale', () => {
    const porattam = items.find((item) => item.title === 'Porattam - Tamilfilm')!;
    expect(porattam.screeningUrls.length).toBeGreaterThan(0);
    for (const url of porattam.screeningUrls) expect(url).toMatch(/^https:\/\/(www\.)?nfkino\.no\/screening\//);
  });

  it('finds no screenings for a film that is only coming soon', () => {
    const avengers = items.find((item) => item.title === 'Avengers: Doomsday')!;
    expect(avengers.screeningUrls).toEqual([]);
  });

  it('keeps the film page link, absolute', () => {
    expect(items[0]!.filmUrl).toBe('https://www.nfkino.no/film/porattam-tamilfilm');
  });

  it('decodes entities in titles', () => {
    const html = `<li class="js-movie-item movie-item"><h2 class="movie-title"><a href="/film/x"><span>Alice&#039;s &amp; Bob</span></a></h2></li>`;
    expect(parseProgramme(html)[0]!.title).toBe("Alice's & Bob");
  });
});

describe('sightingFrom', () => {
  it('reports absent when the film is not on the programme', () => {
    const sighting = sightingFrom(parseProgramme(fixture), 'Jailer 2');
    expect(sighting).toMatchObject({ level: 'absent', titles: [], screenings: [], url: PROGRAMME_URL });
  });

  it('reports listed for a coming-soon film with no screenings', () => {
    const html = withTitle(fixture, 'Avengers: Doomsday', 'Jailer 2 - Tamilfilm');
    expect(sightingFrom(parseProgramme(html), 'Jailer 2')).toMatchObject({
      level: 'listed',
      titles: ['Jailer 2 - Tamilfilm'],
      screenings: [],
    });
  });

  it('reports on_sale, with ticket links, once screenings are linked', () => {
    const html = withTitle(fixture, 'Porattam - Tamilfilm', 'Jailer 2 - Tamilfilm');
    const sighting = sightingFrom(parseProgramme(html), 'Jailer 2');
    expect(sighting.level).toBe('on_sale');
    expect(sighting.screenings.length).toBeGreaterThan(0);
    expect(sighting.screenings[0]!.ticketUrl).toMatch(/\/screening\//);
    expect(sighting.url).toBe('https://www.nfkino.no/film/porattam-tamilfilm');
  });

  it('does not mistake the 2023 original for the sequel', () => {
    const html = withTitle(fixture, 'Porattam - Tamilfilm', 'Jailer - Tamilfilm');
    expect(sightingFrom(parseProgramme(html), 'Jailer 2').level).toBe('absent');
  });

  /** An empty programme is a broken scraper, not "not listed yet". */
  it('throws when the programme is suspiciously short', () => {
    expect(() => sightingFrom(filler(4), 'Jailer 2')).toThrow(/markup changed/);
    expect(() => sightingFrom(parseProgramme('<html>Just a moment...</html>'), 'Jailer 2')).toThrow();
    expect(() => sightingFrom(filler(5), 'Jailer 2')).not.toThrow();
  });
});

describe('nfkino source', () => {
  it('fetches the Oslo programme', async () => {
    const http = vi.fn(async () => fixture);
    await nfkino.check('Jailer 2', http);
    expect(http).toHaveBeenCalledWith(PROGRAMME_URL);
  });
});
