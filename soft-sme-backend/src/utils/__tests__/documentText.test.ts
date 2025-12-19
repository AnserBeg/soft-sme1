import { escapeHtml, normalizeDocumentText, stripUnsafeText } from '../documentText';

describe('documentText utils', () => {
  test('escapeHtml escapes special characters', () => {
    expect(escapeHtml(`5 < 6 & 7 > 3 "ok" 'ok'`)).toBe(
      '5 &lt; 6 &amp; 7 &gt; 3 &quot;ok&quot; &#39;ok&#39;'
    );
  });

  test('normalizeDocumentText preserves newlines and spaces', () => {
    expect(normalizeDocumentText('A  B\r\nC\rD')).toBe('A  B\nC\nD');
  });

  test('normalizeDocumentText replaces tabs with spaces', () => {
    expect(normalizeDocumentText('A\tB')).toBe('A  B');
  });

  test('normalizeDocumentText removes trademark-like symbols', () => {
    expect(normalizeDocumentText('A™B®C©')).toBe('ABC');
  });

  test('normalizeDocumentText fixes common mojibake sequences', () => {
    expect(normalizeDocumentText('KING PIN LOCATION\u00E2\u20AC\u2122s')).toBe('KING PIN LOCATION\u2019s');
    expect(normalizeDocumentText(`9\u00E2\u20AC\u00B26`)).toBe('9\u20326');
    expect(normalizeDocumentText('\u00C2 VALUE')).toBe(' VALUE');
  });

  test('stripUnsafeText removes null bytes and control chars but keeps tabs/newlines', () => {
    expect(stripUnsafeText(`A\u0000B\u0007C\tD\nE`)).toBe(`ABC\tD\nE`);
  });
});
