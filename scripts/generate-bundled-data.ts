/**
 * Generates the fallback dataset shipped inside the .vsix.
 *
 * Run against a local rAthena checkout:
 *   npm run gen:data -- --server ~/rathena --mode renewal
 *
 * The output is deliberately minimal. A full `item_db.yml` is tens of megabytes
 * of YAML; we keep only what completion and hover need (id, aegis name, display
 * name, type) which brings it down to a couple of megabytes of JSON. Anyone who
 * points the extension at their own server gets the full detail at runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  attachDocumentation,
  parseBuildins,
  parseConstYaml,
  parseConstants,
  parseDocumentation,
  parseItemDb,
  parseMapFlags,
  parseMapIndex,
  parseMobDb
} from '../server/src/data/parseSource.js';
import { emptyServerData, type ServerData } from '../server/src/data/types.js';

interface Args {
  server: string;
  mode: 'renewal' | 'pre-renewal';
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  const server = expandHome(get('--server', process.env.RATHENA_PATH ?? '../rathena'));
  const mode = get('--mode', 'renewal') as 'renewal' | 'pre-renewal';
  const out = get('--out', path.join('dist', 'server-data.json'));
  return { server: path.resolve(server), mode, out: path.resolve(out) };
}

function expandHome(input: string): string {
  return input.startsWith('~')
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', input.slice(1))
    : input;
}

function read(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function gitRevision(repo: string): string | undefined {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return undefined;
  }
}

function main(): void {
  const { server, mode, out } = parseArgs();

  if (!fs.existsSync(path.join(server, 'src', 'map', 'script.cpp'))) {
    console.error(`✘ Not an rAthena checkout: ${server}`);
    console.error('  Pass --server /path/to/rathena or set RATHENA_PATH.');
    process.exit(1);
  }

  const dbDir = path.join(server, 'db', mode === 'renewal' ? 're' : 'pre-re');
  const data: ServerData = emptyServerData();
  data.revision = gitRevision(server);

  const scriptCpp = read(path.join(server, 'src', 'map', 'script.cpp'));
  if (scriptCpp) {
    data.commands = parseBuildins(scriptCpp);
  }

  const doc = read(path.join(server, 'doc', 'script_commands.txt'));
  if (doc) {
    data.commands = attachDocumentation(data.commands, parseDocumentation(doc));
  }

  const constantsHpp = read(path.join(server, 'src', 'map', 'script_constants.hpp'));
  if (constantsHpp) {
    data.constants = parseConstants(constantsHpp);
  }

  const constYml = read(path.join(server, 'db', 'const.yml'));
  if (constYml) {
    data.constants.push(...parseConstYaml(constYml));
  }

  const seenItems = new Set<number>();
  for (const file of ['item_db.yml', 'item_db_equip.yml', 'item_db_etc.yml', 'item_db_usable.yml']) {
    const text = read(path.join(dbDir, file));
    if (!text) {
      continue;
    }
    for (const item of parseItemDb(text)) {
      if (!seenItems.has(item.id)) {
        seenItems.add(item.id);
        data.items.push(item);
      }
    }
  }

  const mobYaml = read(path.join(dbDir, 'mob_db.yml'));
  if (mobYaml) {
    data.mobs = parseMobDb(mobYaml);
  }

  const mapIndex = read(path.join(server, 'db', 'map_index.txt'));
  if (mapIndex) {
    data.maps = parseMapIndex(mapIndex);
  }

  const mapFlagDoc = read(path.join(server, 'doc', 'mapflags.txt'));
  if (mapFlagDoc) {
    data.mapFlags = parseMapFlags(mapFlagDoc);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data), 'utf8');

  const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
  console.log(`✔ ${out} (${sizeMb} MB)`);
  console.log(`  revision  ${data.revision ?? 'unknown'}`);
  console.log(`  commands  ${data.commands.length}`);
  console.log(`  constants ${data.constants.length}`);
  console.log(`  items     ${data.items.length}`);
  console.log(`  mobs      ${data.mobs.length}`);
  console.log(`  maps      ${data.maps.length}`);
  console.log(`  mapflags  ${data.mapFlags.length}`);

  const documented = data.commands.filter((c) => c.documentation).length;
  console.log(`  ${documented}/${data.commands.length} commands have documentation`);
}

main();
