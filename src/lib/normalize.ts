import unidecode from 'unidecode';

function baseCanonicalize(value: unknown): string {
  if (value == null) {
    return '';
  }

  const stringValue = value.toString().trim();

  if (!stringValue) {
    return '';
  }

  let normalized = stringValue.normalize('NFKD').replace(/\p{M}/gu, '');
  normalized = unidecode(normalized);

  return normalized;
}

export function canonicalizeName(input: unknown): string {
  const prepared = baseCanonicalize(input);

  if (!prepared) {
    return '';
  }

  const withoutInnerApostrophes = prepared.replace(/([0-9A-Za-z])['’`]+([0-9A-Za-z])/g, '$1$2');
  const lettersNumbersSpaces = withoutInnerApostrophes.replace(/[^0-9A-Za-z/ ]+/g, ' ');
  const collapsedSpaces = lettersNumbersSpaces.trim().replace(/\s+/g, ' ');

  return collapsedSpaces.toUpperCase();
}

export function canonicalizePartNumber(input: unknown): string {
  const prepared = baseCanonicalize(input);

  if (!prepared) {
    return '';
  }

  const alphanumericOnly = prepared.replace(/[^0-9A-Za-z]+/g, '');

  return alphanumericOnly.toUpperCase();
}
