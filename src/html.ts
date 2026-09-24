/** Decode the handful of named entities Norwegian pages emit, plus numeric ones. */
export function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aring: 'å',
    Aring: 'Å',
    aelig: 'æ',
    AElig: 'Æ',
    oslash: 'ø',
    Oslash: 'Ø',
  };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => named[name] ?? whole);
}
