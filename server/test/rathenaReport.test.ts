import { describe, expect, it } from 'vitest';

import { formatRathenaError } from '../src/analysis/rathenaReport.js';

const SOURCE = [
  'prontera,150,180,4\tscript\tTest\t100,{', // line 1
  '\tmes "[Test]";', //                        line 2
  '\tmes "hola";', //                          line 3
  '\tnext;', //                                line 4
  '', //                                       line 5
  '\t.@a = 1', //                              line 6
  '\tend;', //                                 line 7
  '}' //                                       line 8
].join('\n');

/** Offset of the `e` in the `end;` on line 7. */
const OFFSET = SOURCE.indexOf('\tend;') + 1;

describe('formatRathenaError', () => {
  const report = formatRathenaError({
    source: SOURCE,
    file: 'npc/custom/test.txt',
    offset: OFFSET,
    message: "parse_line: expected ';'"
  });

  it('reports a zero-based line for LSP ranges', () => {
    expect(report.line).toBe(6);
  });

  it('reports the character within that line', () => {
    expect(report.character).toBe(1);
  });

  it('opens with the header the map-server prints, counting lines from one', () => {
    expect(report.text.split('\n')[0]).toBe('script error on npc/custom/test.txt line 7');
  });

  it('indents the message by four spaces', () => {
    expect(report.text.split('\n')[1]).toBe("    parse_line: expected ';'");
  });

  it('marks the offending line with an asterisk', () => {
    const marked = report.text.split('\n').find((l) => l.startsWith('*'));
    expect(marked).toBeDefined();
    expect(marked).toContain('7 : ');
  });

  it("wraps the offending character in single quotes", () => {
    const marked = report.text.split('\n').find((l) => l.startsWith('*'))!;
    expect(marked).toContain("'e'nd;");
  });

  it('shows up to five lines of context before', () => {
    const lines = report.text.split('\n');
    // header + message + 5 context lines before the marked one
    expect(lines[2]).toContain('2 : ');
    expect(lines[6]).toContain('6 : ');
  });

  it('shows the lines after the error too', () => {
    expect(report.text).toContain('8 : }');
  });

  it('right-aligns the line numbers the way printf "% 5d" does', () => {
    // `script_print_line` uses " % 5d : " for ordinary lines, which puts the
    // number in a five-wide right-aligned field: five spaces before a "2".
    expect(report.text).toContain('     2 : ');
    // …and "*% 5d : " for the offending one, replacing the leading space.
    expect(report.text).toContain('*    7 : ');
  });

  it('handles an error on the very first line', () => {
    const first = formatRathenaError({
      source: 'mes "a";\nend;',
      file: 'x.txt',
      offset: 0,
      message: "not found '{'"
    });
    expect(first.line).toBe(0);
    expect(first.text).toContain('line 1');
    expect(first.text.split('\n').find((l) => l.startsWith('*'))).toContain("'m'es");
  });

  it('handles an offset past the end of its line', () => {
    const past = formatRathenaError({
      source: 'mes "a";',
      file: 'x.txt',
      offset: 999,
      message: 'unexpected end of script'
    });
    expect(past.text).toContain('<end of line>');
  });
});
