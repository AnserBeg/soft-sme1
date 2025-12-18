const CONTROL_CHARS_EXCEPT_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const TRADEMARK_LIKE_CHARS = /[\u2122\u00AE\u00A9]/g;
const NBSP = /\u00A0/g;

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });

const mojibakeScore = (value: string): number => {
  const matches = value.match(/[\u00C3\u00C2\u00E2\uFFFD]/g);
  return matches ? matches.length : 0;
};

const fixCommonMojibakeSequences = (value: string): string => {
  return value
    // Smart quotes / dashes / ellipsis / primes (UTF-8 bytes misread as Windows-1252).
    .replace(/\u00E2\u20AC\u2122/g, '\u2019') // â€™ -> ’
    .replace(/\u00E2\u20AC\u02DC/g, '\u2018') // â€˜ -> ‘
    .replace(/\u00E2\u20AC\u0153/g, '\u201C') // â€œ -> “
    .replace(/\u00E2\u20AC\uFFFD/g, '\u201D') // â€� -> ”
    .replace(/\u00E2\u20AC\u201C/g, '\u2013') // â€“ -> –
    .replace(/\u00E2\u20AC\u201D/g, '\u2014') // â€” -> —
    .replace(/\u00E2\u20AC\u00A6/g, '\u2026') // â€¦ -> …
    .replace(/\u00E2\u20AC\u00B2/g, '\u2032') // â€² -> ′
    .replace(/\u00E2\u20AC\u00B3/g, '\u2033') // â€³ -> ″
    // Common "Â " artifact from non-breaking space (C2 A0).
    .replace(/\u00C2(?=\s)/g, '');
};

const maybeFixLatin1Mojibake = (value: string): string => {
  if (!/[\u00C3\u00C2]/.test(value)) {
    return value;
  }

  const originalScore = mojibakeScore(value);

  try {
    const candidate = Buffer.from(value, 'latin1').toString('utf8');
    if (candidate === value) {
      return value;
    }

    const candidateScore = mojibakeScore(candidate);
    if (candidateScore < originalScore) {
      return candidate;
    }
  } catch {
    return value;
  }

  return value;
};

export const normalizeDocumentText = (input: unknown): string => {
  if (input === null || input === undefined) {
    return '';
  }

  let value = typeof input === 'string' ? input : String(input);

  value = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  value = value.replace(NBSP, ' ');
  value = value.replace(/\t/g, '  ');
  value = value.replace(CONTROL_CHARS_EXCEPT_NEWLINE, '');

  value = fixCommonMojibakeSequences(value);
  value = maybeFixLatin1Mojibake(value);
  value = fixCommonMojibakeSequences(value);

  value = value.replace(TRADEMARK_LIKE_CHARS, '');
  value = value.replace(/\uFFFD/g, '');

  return value;
};

