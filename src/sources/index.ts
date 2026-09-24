import { filmweb } from './filmweb.js';
import { nfkino } from './nfkino.js';
import type { Source } from './types.js';

/**
 * odeonkino.no is deliberately absent: it answers every non-browser request
 * with a Cloudflare challenge (HTTP 403). ODEON Oslo's showtimes still reach us
 * through filmweb, which carries them.
 */
export const SOURCES: Source[] = [filmweb, nfkino];

export type { Level, Screening, Sighting, Source } from './types.js';
