/**
 * Title matching. Cinemas decorate titles freely — "Porattam - Tamilfilm",
 * "Drishyam 3 - Hindi", "JAILER 2 (Tamil)" — so the watched title only has to
 * appear as a whole-word run inside the listed one, case- and accent-blind.
 */

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4' };

/** Lowercase, strip accents and punctuation, and read "II" as "2". */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => ROMAN[word] ?? word)
    .join(' ');
}

/**
 * Whole-word containment, so "Jailer 2" matches "Jailer 2 - Tamilfilm" and
 * "JAILER II", but never plain "Jailer" (the 2023 original) or "Jailer 21".
 */
export function matchesMovie(title: string, movie: string): boolean {
  const needle = normalizeTitle(movie);
  if (needle === '') return false;
  return ` ${normalizeTitle(title)} `.includes(` ${needle} `);
}
