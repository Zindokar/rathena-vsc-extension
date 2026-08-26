import { describe, expect, it } from 'vitest';

import { quickCheck } from '../src/analysis/quickCheck.js';
import { ServerDatabase } from '../src/data/database.js';
import { tokenize } from '../src/lexer.js';

const database = new ServerDatabase();

/** Diagnostic codes reported for a snippet, with command checking disabled. */
function codesFor(source: string): string[] {
  const { tokens } = tokenize(source);
  return quickCheck(source, tokens, { checkUnknownCommands: false, database }).map((d) => String(d.code));
}

function semicolonLines(source: string): number[] {
  const { tokens } = tokenize(source);
  return quickCheck(source, tokens, { checkUnknownCommands: false, database })
    .filter((d) => d.code === 'missing-semicolon')
    .map((d) => d.range.start.line + 1);
}

/** Wraps statements in a minimal NPC body so they sit at brace depth 1. */
function inNpc(body: string): string {
  return `-\tscript\tTest\t-1,{\n${body}\n}`;
}

describe('missing semicolons — true positives', () => {
  it('flags a statement with no terminator', () => {
    // Line 1 is the header, so the body starts on line 2.
    expect(semicolonLines(inNpc('\tmes "hola"\n\tend;'))).toEqual([2]);
  });

  it('flags the last statement before a closing brace', () => {
    expect(semicolonLines(inNpc('\tend'))).toEqual([2]);
  });

  it('flags a bare return, the defect found in novice.txt:2741', () => {
    expect(semicolonLines(inNpc('\twarp "new_1-4",99,10;\n\treturn\n\tend;'))).toEqual([3]);
  });

  it('flags an assignment', () => {
    expect(semicolonLines(inNpc('\t.@a = 1\n\tend;'))).toEqual([2]);
  });

  it('flags the tail of a do-while, which does need a semicolon', () => {
    expect(semicolonLines(inNpc('\tdo {\n\t\t.@i++;\n\t} while (.@i < 3)\n\tend;'))).toEqual([4]);
  });

  it('flags a call statement', () => {
    expect(semicolonLines(inNpc('\tcallfunc("F_Test")\n\tend;'))).toEqual([2]);
  });
});

describe('missing semicolons — places one is legitimately absent', () => {
  it('ignores event and user labels', () => {
    expect(semicolonLines(inNpc('OnInit:\n\tend;\nL_Mine:\n\tend;'))).toEqual([]);
  });

  it('ignores case and default arms', () => {
    expect(
      semicolonLines(
        inNpc('\tswitch (.@a) {\n\tcase 1:\n\t\tend;\n\tdefault:\n\t\tend;\n\t}')
      )
    ).toEqual([]);
  });

  it('ignores an if header on its own line', () => {
    expect(semicolonLines(inNpc('\tif (.@a == 1)\n\t\tend;'))).toEqual([]);
  });

  it('ignores if / else if / else chains', () => {
    expect(
      semicolonLines(inNpc('\tif (.@a)\n\t\tend;\n\telse if (.@b)\n\t\tend;\n\telse\n\t\tend;'))
    ).toEqual([]);
  });

  it('ignores for and while headers', () => {
    expect(
      semicolonLines(inNpc('\tfor (.@i = 0; .@i < 3; .@i++)\n\t\tend;\n\twhile (.@x)\n\t\tend;'))
    ).toEqual([]);
  });

  it('ignores blocks', () => {
    expect(semicolonLines(inNpc('\tif (.@a) {\n\t\tend;\n\t}'))).toEqual([]);
  });

  it('ignores an argument list split across lines', () => {
    expect(semicolonLines(inNpc('\tmes sprintf("%d %d",\n\t\t1,\n\t\t2);'))).toEqual([]);
  });

  it('ignores an expression continued by a trailing operator', () => {
    expect(semicolonLines(inNpc('\tmes "hola " +\n\t\t"mundo";'))).toEqual([]);
  });

  it('ignores an expression continued by a leading operator on the next line', () => {
    expect(semicolonLines(inNpc('\tmes "hola "\n\t\t+ "mundo";'))).toEqual([]);
  });

  it('ignores a multi-line array subscript', () => {
    expect(semicolonLines(inNpc('\t.@a = .@array[\n\t\t0\n\t];'))).toEqual([]);
  });

  it('ignores top-level definition lines, which are records and not statements', () => {
    const source = [
      'prontera,150,180,4\tscript\tTest\t100,{',
      '\tend;',
      '}',
      'prontera,160,180,0\twarp\tw\t2,2,geffen,120,100',
      'prt_fild00,0,0\tmonster\tPoring\t1002,10,5000',
      'prontera\tmapflag\tnomemo'
    ].join('\n');
    expect(semicolonLines(source)).toEqual([]);
  });

  it('ignores a local function declaration and definition', () => {
    expect(semicolonLines(inNpc('\tfunction SF_A;\n\tSF_A();\n\tfunction SF_A {\n\t\treturn;\n\t}'))).toEqual([]);
  });

  it('stays quiet on a comment-only line', () => {
    expect(semicolonLines(inNpc('\t// solo un comentario\n\tend;'))).toEqual([]);
  });
});

describe('other checks', () => {
  it('reports spaces where a definition line needs tabs', () => {
    expect(codesFor('prontera,150,180,4 script Test 100,{\n\tend;\n}')).toContain('header-needs-tabs');
  });

  it('accepts a definition line that uses tabs', () => {
    expect(codesFor('prontera,150,180,4\tscript\tTest\t100,{\n\tend;\n}')).not.toContain(
      'header-needs-tabs'
    );
  });

  it('reports an unterminated string', () => {
    expect(codesFor(inNpc('\tmes "sin cerrar;\n\tend;'))).toContain('unterminated-string');
  });

  it('reports an unclosed brace', () => {
    expect(codesFor('-\tscript\tTest\t-1,{\n\tend;')).toContain('unclosed-bracket');
  });

  it('reports a mismatched bracket', () => {
    expect(codesFor(inNpc('\t.@a = (1 + 2];'))).toContain('mismatched-bracket');
  });

  it('finds nothing wrong with a well-formed NPC', () => {
    const source = [
      'prontera,150,180,4\tscript\tTest\t100,{',
      '\tmes "[Test]";',
      '\tif (Zeny < 100) {',
      '\t\tclose;',
      '\t}',
      '\tswitch (select("A:B")) {',
      '\t\tcase 1:',
      '\t\t\tbreak;',
      '\t\tcase 2:',
      '\t\t\tbreak;',
      '\t}',
      '\tend;',
      '',
      'OnInit:',
      '\tend;',
      '}'
    ].join('\n');
    expect(codesFor(source)).toEqual([]);
  });
});
