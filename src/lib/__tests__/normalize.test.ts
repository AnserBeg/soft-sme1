import { canonicalizeName, canonicalizePartNumber } from '../normalize';

describe('canonicalizeName', () => {
  it('returns empty string for nullish values', () => {
    expect(canonicalizeName(null)).toBe('');
    expect(canonicalizeName(undefined)).toBe('');
  });

  it.each([
    ['  José   Ángel  ', 'JOSE ANGEL'],
    ["Mary-Jane O'Neill", 'MARY JANE ONEILL'],
    ['François ¾ Bûcher 1/2', 'FRANCOIS 3/4 BUCHER 1/2'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeName(input)).toBe(expected);
  });
});

describe('canonicalizePartNumber', () => {
  it('returns empty string for nullish values', () => {
    expect(canonicalizePartNumber(null)).toBe('');
    expect(canonicalizePartNumber(undefined)).toBe('');
  });

  it.each([
    [' abc-123 ', 'ABC123'],
    ['№ 45/7 ¾', 'NO45734'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizePartNumber(input)).toBe(expected);
  });
});
