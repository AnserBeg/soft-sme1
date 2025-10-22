import { canonicalizeName, canonicalizePartNumber } from '../normalize';

describe('canonicalizeName', () => {
  it('returns empty string for nullish values', () => {
    expect(canonicalizeName(null)).toBe('');
    expect(canonicalizeName(undefined)).toBe('');
  });

  it('removes diacritics and collapses spaces', () => {
    expect(canonicalizeName('  José   Ángel  ')).toBe('JOSE ANGEL');
  });

  it('removes punctuation while keeping spaces', () => {
    expect(canonicalizeName("Mary-Jane O'Neill")).toBe('MARY JANE ONEILL');
  });

  it('normalizes fractions and accented characters', () => {
    expect(canonicalizeName('François ¾ Bûcher 1/2')).toBe('FRANCOIS 3/4 BUCHER 1/2');
  });
});

describe('canonicalizePartNumber', () => {
  it('returns empty string for nullish values', () => {
    expect(canonicalizePartNumber(null)).toBe('');
    expect(canonicalizePartNumber(undefined)).toBe('');
  });

  it('removes non-alphanumeric characters and uppercases', () => {
    expect(canonicalizePartNumber(' abc-123 ')).toBe('ABC123');
  });

  it('normalizes unicode characters and removes separators', () => {
    expect(canonicalizePartNumber('№ 45/7 ¾')).toBe('NO45734');
  });
});
