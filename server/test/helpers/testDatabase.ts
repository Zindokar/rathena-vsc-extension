/**
 * A small but realistic `ServerDatabase` for tests.
 *
 * `ServerDatabase` only ingests data through `loadBundled` (a JSON file) or
 * `index` (a full rAthena checkout), so tests write a fixture JSON to a temp
 * file and load it. The content mirrors the shapes of the real data closely
 * enough to exercise case-insensitivity, sprite flags and quoted names.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ServerDatabase } from '../../src/data/database.js';
import type { ServerData } from '../../src/data/types.js';

export function makeDatabase(overrides: Partial<ServerData> = {}): ServerDatabase {
  const data: ServerData = {
    generatedAt: new Date().toISOString(),
    commands: [
      {
        name: 'mes',
        arg: 's*',
        minArgs: 1,
        maxArgs: null,
        paramTypes: ['s'],
        signatures: ['mes "<string>"{,"<string>"{,...}};']
      },
      {
        name: 'getitem',
        arg: 'vi?',
        minArgs: 2,
        maxArgs: 3,
        paramTypes: ['v', 'i'],
        signatures: [
          'getitem <item id>,<amount>{,<account ID>};',
          'getitem "<item name>",<amount>{,<account ID>};'
        ]
      },
      {
        name: 'monster',
        arg: 'siisii???',
        minArgs: 6,
        maxArgs: 9,
        paramTypes: ['s', 'i', 'i', 's', 'i', 'i'],
        signatures: [
          'monster "<map name>",<x>,<y>,"<name to show>",<mob id>,<amount>{,"<event label>",<size>,<ai>};'
        ]
      },
      {
        name: 'sc_start',
        arg: 'iii???',
        minArgs: 3,
        maxArgs: 6,
        paramTypes: ['i', 'i', 'i'],
        signatures: ['sc_start <effect type>,<ticks>,<value 1>{,<rate>,<flag>{,<GID>}};']
      },
      { name: 'end', arg: '', minArgs: 0, maxArgs: 0, paramTypes: [] },
      { name: 'close', arg: '', minArgs: 0, maxArgs: 0, paramTypes: [] }
    ],
    constants: [
      { name: 'SC_INCREASEAGI', value: '' },
      { name: 'SC_BLESSING', value: '' },
      { name: 'EF_HEAL2', value: '' },
      { name: 'Job_SuperNovice', value: 'JOB_SUPER_NOVICE' },
      { name: 'HIDDEN_NPC', value: '', sprite: true },
      { name: 'KAFRA_01', value: '', sprite: true },
      { name: 'WARPNPC', value: '', sprite: true }
    ],
    items: [
      { id: 501, aegisName: 'Red_Potion', name: 'Red Potion', type: 'Healing' },
      { id: 502, aegisName: 'Orange_Potion', name: 'Orange Potion', type: 'Healing' },
      { id: 1101, aegisName: 'Sword', name: 'Sword', type: 'Weapon' }
    ],
    mobs: [
      { id: 1002, aegisName: 'PORING', name: 'Poring', level: 1 },
      { id: 1039, aegisName: 'BAPHOMET', name: 'Baphomet', level: 81 }
    ],
    skills: [
      { id: 1, name: 'NV_BASIC', description: 'Basic Skill' },
      { id: 5, name: 'SM_BASH', description: 'Bash' }
    ],
    maps: ['prontera', 'geffen', 'prt_fild00'],
    mapFlags: [{ name: 'nomemo' }, { name: 'noteleport' }, { name: 'pvp' }],
    globalFunctions: ['F_Navi', 'seven_qset-3'],
    ...overrides
  };

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rathena-test-')), 'data.json');
  fs.writeFileSync(file, JSON.stringify(data));

  const database = new ServerDatabase();
  database.loadBundled(file);
  return database;
}
