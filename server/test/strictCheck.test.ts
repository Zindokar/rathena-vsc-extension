import { describe, expect, it } from 'vitest';

import { findScriptBlocks, strictCheckDetailed } from '../src/analysis/strictCheck.js';
import { tokenize } from '../src/lexer.js';
import { makeDatabase } from './helpers/testDatabase.js';

const database = makeDatabase();

function blocksIn(text: string) {
  return findScriptBlocks(text, tokenize(text).tokens);
}

describe('findScriptBlocks', () => {
  it('finds a single NPC body and reads its name from the header', () => {
    const text = 'prontera,150,180,4\tscript\tHealer\t100,{\n\tend;\n}';
    const blocks = blocksIn(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('Healer');
    expect(text[blocks[0].start]).toBe('{');
  });

  it('finds every body in a multi-NPC file', () => {
    const text = [
      '-\tscript\tOne\t-1,{\n\tend;\n}',
      'prontera,1,2,3\tscript\tTwo\t100,{\n\tend;\n}',
      'function\tscript\tF_Three\t{\n\treturn;\n}'
    ].join('\n');
    expect(blocksIn(text).map((b) => b.name)).toEqual(['One', 'Two', 'F_Three']);
  });

  it('ignores single-line records, which have no body', () => {
    const text = [
      'prontera,160,180,0\twarp\tw1\t2,2,geffen,120,100',
      'prt_fild00,0,0\tmonster\tPoring\t1002,10,5000',
      'prontera\tmapflag\tnomemo'
    ].join('\n');
    expect(blocksIn(text)).toHaveLength(0);
  });

  it('does not treat braces inside a body as new blocks', () => {
    const text = '-\tscript\tT\t-1,{\n\tif (1) {\n\t\tend;\n\t}\n\tend;\n}';
    expect(blocksIn(text)).toHaveLength(1);
  });

  it('extends an unclosed body to the end of the file', () => {
    const text = '-\tscript\tT\t-1,{\n\tend;';
    const [block] = blocksIn(text);
    expect(block.end).toBe(text.length);
  });
});

describe('strictCheckDetailed', () => {
  it('reports each broken NPC separately', () => {
    const text = [
      '-\tscript\tBad1\t-1,{\n\tmes "a"\n\tend;\n}', // missing ;
      '-\tscript\tGood\t-1,{\n\tend;\n}',
      '-\tscript\tBad2\t-1,{\n\tcase 1:\n\tend;\n}' // case outside switch
    ].join('\n');

    const { diagnostics } = strictCheckDetailed(text, database, 'npc/test.txt');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].message).toContain("Bad1");
    expect(diagnostics[1].message).toContain("Bad2");
  });

  it('produces no diagnostics for a healthy file', () => {
    const text = '-\tscript\tOK\t-1,{\n\tmes "hola";\n\tclose;\n}';
    expect(strictCheckDetailed(text, database, 'x').diagnostics).toHaveLength(0);
  });

  it('accepts calls to indexed global functions, including awkward names', () => {
    const text = '-\tscript\tOK\t-1,{\n\tF_Navi();\n\tend;\n}';
    expect(strictCheckDetailed(text, database, 'x').diagnostics).toHaveLength(0);
  });

  it('embeds the rAthena-formatted report in the diagnostic message', () => {
    const text = '-\tscript\tBad\t-1,{\n\tmes "a"\n\tend;\n}';
    const { diagnostics, reports } = strictCheckDetailed(text, database, 'npc/custom/bad.txt');
    expect(reports[0]).toContain('script error on npc/custom/bad.txt line');
    expect(diagnostics[0].message).toContain('script error on');
    expect(diagnostics[0].message).toContain("would refuse to load 'Bad'");
  });

  it('stays silent when no symbol table is loaded', () => {
    const empty = new (Object.getPrototypeOf(database).constructor)();
    const text = '-\tscript\tT\t-1,{\n\tanything_at_all;\n}';
    expect(strictCheckDetailed(text, empty, 'x').diagnostics).toHaveLength(0);
  });
});
