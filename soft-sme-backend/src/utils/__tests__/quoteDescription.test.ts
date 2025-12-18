import { parseQuoteDescription, renderQuoteDescriptionHtml, renderQuoteDescriptionPlainText } from '../quoteDescription';

describe('quoteDescription', () => {
  test('parses markdown tables into blocks', () => {
    const input = [
      'Intro line',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Outro',
    ].join('\n');

    const blocks = parseQuoteDescription(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].kind).toBe('text');
    expect((blocks[0] as any).text).toContain('Intro line');
    expect(blocks[1].kind).toBe('table');
    expect(blocks[2]).toEqual({ kind: 'text', text: 'Outro' });
  });

  test('renders table HTML with no cell borders', () => {
    const html = renderQuoteDescriptionHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('border: none');
  });

  test('renders plain text tables with padded columns', () => {
    const text = renderQuoteDescriptionPlainText('| A | BB |\n| --- | --- |\n| 1 | 22 |');
    const lines = text.split('\n');
    expect(lines[0]).toContain('A');
    expect(lines[0]).toContain('BB');
    expect(lines[1]).toContain('1');
    expect(lines[1]).toContain('22');
  });
});
