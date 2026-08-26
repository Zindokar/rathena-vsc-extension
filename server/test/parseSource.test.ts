import { describe, expect, it } from 'vitest';

import {
  arityOf,
  parseBuildins,
  parseConstants,
  parseDocumentation,
  parseItemDb,
  parseMobDb
} from '../src/data/parseSource.js';

describe('arityOf', () => {
  it('counts required parameters', () => {
    expect(arityOf('sii')).toEqual({ minArgs: 3, maxArgs: 3, paramTypes: ['s', 'i', 'i'] });
  });

  it('treats ? as one optional parameter each', () => {
    expect(arityOf('i??')).toEqual({ minArgs: 1, maxArgs: 3, paramTypes: ['i'] });
  });

  it('makes * unbounded', () => {
    expect(arityOf('s*')).toEqual({ minArgs: 1, maxArgs: null, paramTypes: ['s'] });
  });

  it('handles the empty signature', () => {
    expect(arityOf('')).toEqual({ minArgs: 0, maxArgs: 0, paramTypes: [] });
  });
});

describe('parseBuildins', () => {
  const source = `
    BUILDIN_DEF(mes,"s*"),
    BUILDIN_DEF(next,""),
    BUILDIN_DEF2(close, "close3", ""),
    BUILDIN_DEF(warp,"sii?"),
    BUILDIN_DEF_DEPRECATED(setr,"rv?","2024-01-01"),
  `;

  const commands = parseBuildins(source);
  const byName = new Map(commands.map((c) => [c.name, c]));

  it('reads the plain form', () => {
    expect(byName.get('mes')).toMatchObject({ arg: 's*', minArgs: 1, maxArgs: null });
  });

  it('uses the alias as the script-visible name for BUILDIN_DEF2', () => {
    expect(byName.has('close3')).toBe(true);
    expect(byName.has('close')).toBe(false);
  });

  it('captures optional parameters', () => {
    expect(byName.get('warp')).toMatchObject({ minArgs: 3, maxArgs: 4 });
  });

  it('records the deprecation date without eating the signature', () => {
    expect(byName.get('setr')).toMatchObject({ arg: 'rv?', deprecated: '2024-01-01' });
  });

  it('ignores the #define lines that declare the macros', () => {
    const commands = parseBuildins(`
      #define BUILDIN_DEF(x,args) { buildin_ ## x , #x , args, nullptr }
      #define BUILDIN_DEF2(x,x2,args) { buildin_ ## x , x2 , args, nullptr }
      BUILDIN_DEF(mes,"s*"),
    `);
    expect(commands.map((c) => c.name)).toEqual(['mes']);
  });

  it('returns commands sorted by name', () => {
    const names = commands.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('parseConstants', () => {
  it('reads plain export_constant macros', () => {
    const constants = parseConstants(`
      export_constant(MAX_LEVEL);
      export_constant(SC_INCREASEAGI);
    `);
    expect(constants.map((c) => c.name)).toEqual(['MAX_LEVEL', 'SC_INCREASEAGI']);
  });

  it('reads the aliased form and keeps its value', () => {
    const [constant] = parseConstants('export_constant2("bStr",SP_STR);');
    expect(constant).toEqual({ name: 'bStr', value: 'SP_STR' });
  });

  it('strips the JT_ prefix from NPC sprite constants', () => {
    // export_constant_npc is #defined as export_constant_offset(a, 3).
    const names = parseConstants(`
      export_constant_npc(JT_HIDDEN_NPC);
      export_constant_npc(JT_WARPNPC);
    `).map((c) => c.name);
    expect(names).toEqual(['HIDDEN_NPC', 'WARPNPC']);
  });

  it('honours an explicit offset', () => {
    const [constant] = parseConstants('export_constant_offset(JT_SOMETHING,3);');
    expect(constant.name).toBe('SOMETHING');
  });

  it('ignores the #define lines that declare the macros', () => {
    const constants = parseConstants(`
      #define export_constant(a) script_set_constant(#a,a,false,false)
      #define export_constant2(a,b) script_set_constant(a,b,false,false)
      export_constant(REAL_ONE);
    `);
    expect(constants.map((c) => c.name)).toEqual(['REAL_ONE']);
  });
});

describe('parseDocumentation', () => {
  const doc = [
    '*getitem <item id>,<amount>{,<account ID>};',
    '*getitem "<item name>",<amount>{,<account ID>};',
    '',
    'This command will give an amount of specified items.',
    '',
    '---------------------------------------',
    '',
    '*end;',
    '',
    'Ends the script.'
  ].join('\n');

  const docs = parseDocumentation(doc);

  it('groups consecutive usage lines under one entry', () => {
    expect(docs.get('getitem')?.signatures).toHaveLength(2);
  });

  it('captures the prose after the signatures', () => {
    expect(docs.get('getitem')?.documentation).toContain('give an amount of specified items');
  });

  it('starts a new entry after a separator row', () => {
    expect(docs.get('end')?.documentation).toContain('Ends the script');
  });
});

describe('parseItemDb', () => {
  const yaml = `
Body:
  - Id: 501
    AegisName: Red_Potion
    Name: Red Potion
    Type: Healing
    Buy: 50
  - Id: 502
    AegisName: Orange_Potion
    Name: Orange Potion
    Type: Healing
`;

  it('extracts id, aegis name, display name and type', () => {
    const items = parseItemDb(yaml);
    expect(items).toEqual([
      { id: 501, aegisName: 'Red_Potion', name: 'Red Potion', type: 'Healing' },
      { id: 502, aegisName: 'Orange_Potion', name: 'Orange Potion', type: 'Healing' }
    ]);
  });

  it('does not lose the final entry', () => {
    expect(parseItemDb(yaml)).toHaveLength(2);
  });
});

describe('parseMobDb', () => {
  it('extracts mobs with their level', () => {
    const mobs = parseMobDb(`
  - Id: 1002
    AegisName: PORING
    Name: Poring
    Level: 1
`);
    expect(mobs).toEqual([{ id: 1002, aegisName: 'PORING', name: 'Poring', level: 1 }]);
  });
});
