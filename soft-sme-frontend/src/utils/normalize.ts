export const canonicalizeName = (input: unknown): string => {
  if (input == null) {
    return '';
  }
  const prepared = input.toString().trim();
  if (!prepared) {
    return '';
  }
  const normalized = prepared.normalize('NFKD').replace(/\p{M}/gu, '');
  const lettersNumbersSpaces = normalized.replace(/[^0-9A-Za-z/ ]+/g, ' ');
  return lettersNumbersSpaces.trim().replace(/\s+/g, ' ').toUpperCase();
};

export const canonicalizePartNumber = (input: unknown): string => {
  if (input == null) {
    return '';
  }
  const prepared = input.toString().trim();
  if (!prepared) {
    return '';
  }
  const normalized = prepared.normalize('NFKD').replace(/\p{M}/gu, '');
  return normalized.replace(/[^0-9A-Za-z]+/g, '').toUpperCase();
};
