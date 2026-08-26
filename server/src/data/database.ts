/**
 * Loads and caches the rAthena server data used for completion, hover and
 * semantic diagnostics.
 *
 * Two sources, first one wins:
 *   1. A local rAthena checkout — always current, includes the user's own
 *      custom items and mobs.
 *   2. The JSON bundled with the extension — so the extension is useful the
 *      moment it is installed, before anything is configured.
 *
 * Indexing happens off the request path. Until it finishes, lookups fall back
 * to the bundled data rather than blocking the editor.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  attachDocumentation,
  parseBuildins,
  parseConstYaml,
  parseConstants,
  parseDocumentation,
  parseItemDb,
  parseMapFlags,
  parseMapIndex,
  parseMobDb,
  parseSkillDb
} from './parseSource.js';
import {
  emptyServerData,
  type CommandDef,
  type ConstantDef,
  type ItemDef,
  type MobDef,
  type ServerData,
  type SkillDef
} from './types.js';

export type Mode = 'renewal' | 'pre-renewal';

export interface IndexOptions {
  serverRoot: string;
  mode: Mode;
}

export class ServerDatabase {
  private data: ServerData = emptyServerData();
  private commandsByName = new Map<string, CommandDef>();
  private constantsByName = new Map<string, ConstantDef>();
  private itemsById = new Map<number, ItemDef>();
  private itemsByAegis = new Map<string, ItemDef>();
  private mobsById = new Map<number, MobDef>();
  private mobsByAegis = new Map<string, MobDef>();
  private constantNames = new Set<string>();
  private mapNames = new Set<string>();
  private globalFunctionNames = new Set<string>();

  private indexing = false;
  private lastRoot: string | undefined;

  /** Loads the JSON shipped inside the extension, if the generator has run. */
  loadBundled(bundledPath: string): void {
    try {
      const raw = fs.readFileSync(bundledPath, 'utf8');
      this.replace(JSON.parse(raw) as ServerData);
    } catch {
      // Missing bundled data is not fatal: the extension still works once a
      // server path is configured.
    }
  }

  get isIndexing(): boolean {
    return this.indexing;
  }

  get serverRoot(): string | undefined {
    return this.lastRoot;
  }

  get stats(): {
    commands: number;
    constants: number;
    items: number;
    mobs: number;
    skills: number;
    maps: number;
  } {
    return {
      commands: this.data.commands.length,
      constants: this.data.constants.length,
      items: this.data.items.length,
      mobs: this.data.mobs.length,
      skills: this.data.skills?.length ?? 0,
      maps: this.data.maps.length
    };
  }

  /** Re-reads everything from a local checkout. Safe to call repeatedly. */
  async index({ serverRoot, mode }: IndexOptions): Promise<void> {
    if (this.indexing) {
      return;
    }
    this.indexing = true;
    try {
      const dbDir = path.join(serverRoot, 'db', mode === 'renewal' ? 're' : 'pre-re');
      const data = emptyServerData();

      const scriptCpp = await readIfPresent(path.join(serverRoot, 'src', 'map', 'script.cpp'));
      if (scriptCpp) {
        data.commands = parseBuildins(scriptCpp);
      }

      const doc = await readIfPresent(path.join(serverRoot, 'doc', 'script_commands.txt'));
      if (doc && data.commands.length > 0) {
        data.commands = attachDocumentation(data.commands, parseDocumentation(doc));
      }

      const constantsHpp = await readIfPresent(path.join(serverRoot, 'src', 'map', 'script_constants.hpp'));
      if (constantsHpp) {
        data.constants = parseConstants(constantsHpp);
      }

      const constYml = await readIfPresent(path.join(serverRoot, 'db', 'const.yml'));
      if (constYml) {
        data.constants.push(...parseConstYaml(constYml));
      }

      // item_db is split across several files in renewal.
      const itemFiles = [
        'item_db.yml',
        'item_db_equip.yml',
        'item_db_etc.yml',
        'item_db_usable.yml'
      ].map((file) => path.join(dbDir, file));
      itemFiles.push(path.join(serverRoot, 'db', 'item_db.yml'));

      const seenItems = new Set<number>();
      for (const file of itemFiles) {
        const text = await readIfPresent(file);
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

      const mobYaml = await readIfPresent(path.join(dbDir, 'mob_db.yml'));
      if (mobYaml) {
        data.mobs = parseMobDb(mobYaml);
      }

      const skillYaml = await readIfPresent(path.join(dbDir, 'skill_db.yml'));
      if (skillYaml) {
        data.skills = parseSkillDb(skillYaml);
      }

      const mapIndex = await readIfPresent(path.join(serverRoot, 'db', 'map_index.txt'));
      if (mapIndex) {
        data.maps = parseMapIndex(mapIndex);
      }

      const mapFlagDoc = await readIfPresent(path.join(serverRoot, 'doc', 'mapflags.txt'));
      if (mapFlagDoc) {
        data.mapFlags = parseMapFlags(mapFlagDoc);
      }

      data.globalFunctions = await scanGlobalFunctions(path.join(serverRoot, 'npc'));

      data.generatedAt = new Date().toISOString();
      this.replace(data);
      this.lastRoot = serverRoot;
    } finally {
      this.indexing = false;
    }
  }

  /**
   * rAthena hashes script identifiers with `TOLOWER` (see `calc_hash` in
   * `src/map/script.cpp`), so its symbol table is case-insensitive. Scripts
   * lean on this heavily: `Job_Novice` appears 168 times in the official NPCs
   * while the exported constant is actually `JOB_NOVICE`. Every lookup here is
   * therefore keyed on the lowercased name.
   */
  private replace(data: ServerData): void {
    this.data = data;

    this.commandsByName = new Map(data.commands.map((c) => [c.name.toLowerCase(), c]));
    this.constantsByName = new Map(data.constants.map((c) => [c.name.toLowerCase(), c]));
    this.constantNames = new Set(data.constants.map((c) => c.name.toLowerCase()));

    this.itemsById = new Map(data.items.map((i) => [i.id, i]));
    this.itemsByAegis = new Map(data.items.map((i) => [i.aegisName.toLowerCase(), i]));
    this.mobsById = new Map(data.mobs.map((m) => [m.id, m]));
    this.mobsByAegis = new Map(data.mobs.map((m) => [m.aegisName.toLowerCase(), m]));
    this.mapNames = new Set(data.maps.map((m) => m.toLowerCase()));
    this.globalFunctionNames = new Set((data.globalFunctions ?? []).map((f) => f.toLowerCase()));
  }

  /**
   * Global `function<TAB>script<TAB>name` objects, rAthena's `userfunc_db`.
   *
   * The strict parser needs these: a call such as `F_Navi("...")` refers to a
   * function object that almost always lives in a different file, and without
   * this set every one of them would be reported as an undeclared function.
   */
  isGlobalFunction(name: string): boolean {
    return this.globalFunctionNames.has(name.toLowerCase());
  }

  // ---- Lookups -----------------------------------------------------------

  get commands(): CommandDef[] {
    return this.data.commands;
  }

  command(name: string): CommandDef | undefined {
    return this.commandsByName.get(name.toLowerCase());
  }

  isKnownCommand(name: string): boolean {
    return this.commandsByName.has(name.toLowerCase());
  }

  constant(name: string): ConstantDef | undefined {
    return this.constantsByName.get(name.toLowerCase());
  }

  isKnownConstant(name: string): boolean {
    return this.constantNames.has(name.toLowerCase());
  }

  item(idOrAegis: number | string): ItemDef | undefined {
    return typeof idOrAegis === 'number'
      ? this.itemsById.get(idOrAegis)
      : this.itemsByAegis.get(idOrAegis.toLowerCase());
  }

  mob(idOrAegis: number | string): MobDef | undefined {
    return typeof idOrAegis === 'number'
      ? this.mobsById.get(idOrAegis)
      : this.mobsByAegis.get(idOrAegis.toLowerCase());
  }

  /** Unknown when the map list failed to load, so absence is not an error. */
  isKnownMap(name: string): boolean {
    return this.mapNames.size === 0 || this.mapNames.has(name.toLowerCase());
  }

  get constants(): ConstantDef[] {
    return this.data.constants;
  }

  get items(): ItemDef[] {
    return this.data.items;
  }

  get mobs(): MobDef[] {
    return this.data.mobs;
  }

  get skills(): SkillDef[] {
    return this.data.skills ?? [];
  }

  get maps(): string[] {
    return this.data.maps;
  }

  get mapFlags(): { name: string; description?: string }[] {
    return this.data.mapFlags;
  }

  skill(idOrName: number | string): SkillDef | undefined {
    return typeof idOrName === 'number'
      ? this.skills.find((s) => s.id === idOrName)
      : this.skills.find((s) => s.name.toLowerCase() === idOrName.toLowerCase());
  }

  /**
   * NPC sprite constants — the `export_constant_npc` family, exported with the
   * `JT_` prefix stripped. These are what belongs in the fourth field of a
   * definition line.
   */
  spriteConstants(): ConstantDef[] {
    return this.data.constants.filter((c) => c.sprite);
  }

  /** Constants whose name starts with `prefix`, capped for completion lists. */
  constantsStartingWith(prefix: string, limit = 200): ConstantDef[] {
    const lower = prefix.toLowerCase();
    const out: ConstantDef[] = [];
    for (const constant of this.data.constants) {
      if (constant.name.toLowerCase().startsWith(lower)) {
        out.push(constant);
        if (out.length >= limit) {
          break;
        }
      }
    }
    return out;
  }
}

/**
 * Walks `npc/` collecting the names of global function objects.
 *
 * Reading the whole tree costs about a second on 26 MB, which is acceptable
 * inside the background index and gives the strict parser the cross-file
 * information it cannot otherwise have.
 */
async function scanGlobalFunctions(npcDir: string): Promise<string[]> {
  // The name is a whole tab-delimited field, not a C identifier. rAthena's own
  // scripts rely on that: `function<TAB>script<TAB>seven_qset-3` contains a
  // hyphen, and `171_worker_talk` starts with a digit. Capturing only an
  // identifier truncates the first at the hyphen — which then makes the
  // ordinary variable `seven_qset` look like a function call.
  const pattern = /^function[ \t]+script[ \t]+([^\t\r\n]+)/gm;
  const names = new Set<string>();

  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.txt')) {
        const text = await readIfPresent(full);
        if (!text) {
          continue;
        }
        for (const match of text.matchAll(pattern)) {
          const name = match[1].trim();
          if (name) {
            names.add(name);
          }
        }
      }
    }
  };

  await walk(npcDir);
  return [...names].sort();
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
