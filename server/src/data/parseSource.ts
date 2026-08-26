/**
 * Extractors that turn a checked-out rAthena tree into structured data.
 *
 * Design note: arity and constants are read from the C++ source rather than
 * from `doc/script_commands.txt`. The documentation is prose written for humans
 * and drifts from the implementation; `BUILDIN_DEF` and `export_constant` are
 * what the server actually compiles, so they cannot be wrong. The prose is used
 * only to attach descriptions.
 *
 * The YAML databases are scanned line by line instead of being parsed with a
 * real YAML parser: `item_db.yml` alone is well over 60,000 lines and we only
 * need three fields per entry. A full parse costs seconds and a lot of memory
 * for no benefit.
 */

import type { CommandDef, ConstantDef, ItemDef, MobDef, ParamType, SkillDef } from './types.js';

const BUILDIN_RE = /BUILDIN_DEF(2)?(_DEPRECATED)?\(([^)]*)\)/g;

/**
 * Parses the `buildin_func[]` table out of `src/map/script.cpp`.
 *
 * The four macro forms differ only in their argument count, so the arguments
 * are split positionally rather than matched with one big optional-group
 * regex — an optional group in the middle silently mis-assigns the signature
 * to the deprecation date on the `_DEPRECATED` forms.
 *
 *   BUILDIN_DEF(name, args)
 *   BUILDIN_DEF2(func, "name", args)
 *   BUILDIN_DEF_DEPRECATED(name, args, "date")
 *   BUILDIN_DEF2_DEPRECATED(func, "name", args, "date")
 */
export function parseBuildins(scriptCpp: string): CommandDef[] {
  const commands = new Map<string, CommandDef>();
  // The `#define BUILDIN_DEF(x,args)` lines are themselves matches; skipping
  // preprocessor directives keeps phantom commands named `x` and `x2` out.
  const source = stripDefines(scriptCpp);

  for (const match of source.matchAll(BUILDIN_RE)) {
    const isDef2 = match[1] === '2';
    const isDeprecated = match[2] === '_DEPRECATED';
    const parts = match[3].split(',').map((part) => unquote(part.trim()));

    // With BUILDIN_DEF2 the script-visible name is the quoted alias in slot 1;
    // with the plain form it is the C++ function name in slot 0.
    const name = isDef2 ? parts[1] : parts[0];
    const arg = (isDef2 ? parts[2] : parts[1]) ?? '';
    const deprecated = isDeprecated ? (isDef2 ? parts[3] : parts[2]) : undefined;

    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      continue;
    }

    const def: CommandDef = {
      name,
      arg,
      ...arityOf(arg)
    };
    if (deprecated) {
      def.deprecated = deprecated;
    }
    commands.set(name, def);
  }

  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/s, '$1');
}

/** Removes `#define` lines so macro declarations are not read as data. */
function stripDefines(source: string): string {
  return source.replace(/^[ \t]*#\s*define.*$/gm, '');
}

/** Derives min/max argument counts and parameter types from a signature. */
export function arityOf(arg: string): Pick<CommandDef, 'minArgs' | 'maxArgs' | 'paramTypes'> {
  const paramTypes: ParamType[] = [];
  let optional = 0;
  let variadic = false;

  for (const ch of arg) {
    if (ch === '*') {
      variadic = true;
    } else if (ch === '?') {
      optional += 1;
    } else if (ch === 'v' || ch === 's' || ch === 'i' || ch === 'r' || ch === 'l') {
      paramTypes.push(ch);
    }
  }

  const required = paramTypes.length;
  return {
    minArgs: required,
    maxArgs: variadic ? null : required + optional,
    paramTypes
  };
}

const EXPORT_CONSTANT_RE =
  /export_constant(2|_npc|_offset)?\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(?:,\s*([^)]*))?\)/g;

/**
 * Parses the `export_constant*` macros from `src/map/script_constants.hpp`.
 *
 * Four variants matter:
 *
 * - `export_constant(X)` — constant `X`. Its value is a C++ enum, so there is
 *   no numeric value to read from the text; `value` stays empty.
 * - `export_constant2("Name", X)` — an alias, `value` is the C++ symbol.
 * - `export_constant_offset(X, n)` — the name is `X` with its first `n`
 *   characters removed.
 * - `export_constant_npc(X)` — defined as `export_constant_offset(X, 3)`, so
 *   `JT_HIDDEN_NPC` is exported as `HIDDEN_NPC`. This covers the ~1300 NPC
 *   sprite constants used in shop and NPC definition lines; dropping them
 *   would make every sprite name look undefined.
 */
export function parseConstants(scriptConstantsHpp: string): ConstantDef[] {
  const constants = new Map<string, ConstantDef>();

  for (const match of scriptConstantsHpp.matchAll(EXPORT_CONSTANT_RE)) {
    const variant = match[1];
    let name = match[2];
    const rest = (match[3] ?? '').trim();

    // `a` is the parameter name in the `#define` lines at the top of the file.
    if (!name || name === 'a') {
      continue;
    }

    let value = '';
    let sprite = false;
    if (variant === '2') {
      value = rest;
    } else if (variant === '_npc') {
      name = name.slice(3);
      sprite = true;
    } else if (variant === '_offset') {
      const offset = Number.parseInt(rest, 10);
      if (Number.isFinite(offset) && offset > 0) {
        name = name.slice(offset);
      }
    }

    if (!name) {
      continue;
    }
    constants.set(name.toLowerCase(), { name, value, ...(sprite ? { sprite: true } : {}) });
  }

  return [...constants.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Parses the small set of extra constants defined in `db/const.yml`. */
export function parseConstYaml(constYml: string): ConstantDef[] {
  const constants: ConstantDef[] = [];
  const lines = constYml.split(/\r?\n/);
  let pending: string | null = null;

  for (const line of lines) {
    const nameMatch = /^\s*-\s*Name:\s*(\S+)/.exec(line);
    if (nameMatch) {
      pending = nameMatch[1];
      continue;
    }
    const valueMatch = /^\s*Value:\s*(\S+)/.exec(line);
    if (valueMatch && pending) {
      constants.push({ name: pending, value: valueMatch[1], fromDatabase: true });
      pending = null;
    }
  }

  return constants;
}

/**
 * Splits `doc/script_commands.txt` into per-command documentation.
 *
 * Entries begin with `*name` at column 0. A command may declare several usage
 * lines before the prose starts, and the same command can be documented under
 * multiple overloads, so entries are merged by name.
 */
export function parseDocumentation(docText: string): Map<string, { signatures: string[]; documentation: string }> {
  const result = new Map<string, { signatures: string[]; documentation: string }>();
  const lines = docText.split(/\r?\n/);

  let current: string | null = null;
  let signatures: string[] = [];
  let prose: string[] = [];
  let inSignatureRun = false;

  const flush = (): void => {
    if (!current) {
      return;
    }
    const existing = result.get(current);
    const documentation = prose
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 1200);

    if (existing) {
      existing.signatures.push(...signatures);
      if (!existing.documentation) {
        existing.documentation = documentation;
      }
    } else {
      result.set(current, { signatures: [...signatures], documentation });
    }
    signatures = [];
    prose = [];
  };

  for (const line of lines) {
    // A separator row ends the current entry.
    if (/^-{10,}\s*$/.test(line)) {
      flush();
      current = null;
      continue;
    }

    const header = /^\*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (header) {
      // Consecutive `*name` lines are overloads of the same entry.
      if (current !== header[1]) {
        flush();
        current = header[1];
      }
      signatures.push(line.slice(1).trim());
      inSignatureRun = true;
      continue;
    }

    if (!current) {
      continue;
    }
    if (inSignatureRun && line.trim() === '') {
      inSignatureRun = false;
      continue;
    }
    prose.push(line);
  }
  flush();

  return result;
}

/** Merges documentation into the command list produced from the C++ source. */
export function attachDocumentation(
  commands: CommandDef[],
  docs: Map<string, { signatures: string[]; documentation: string }>
): CommandDef[] {
  return commands.map((command) => {
    const doc = docs.get(command.name);
    if (!doc) {
      return command;
    }
    return {
      ...command,
      signatures: doc.signatures,
      documentation: doc.documentation
    };
  });
}

/**
 * Scans an `item_db*.yml` file for `Id` / `AegisName` / `Name` / `Type`.
 *
 * Entries look like:
 *   - Id: 501
 *     AegisName: Red_Potion
 *     Name: Red Potion
 *     Type: Healing
 */
export function parseItemDb(yamlText: string): ItemDef[] {
  const items: ItemDef[] = [];
  let current: Partial<ItemDef> | null = null;

  const push = (): void => {
    if (current?.id !== undefined && current.aegisName) {
      items.push({
        id: current.id,
        aegisName: current.aegisName,
        name: current.name ?? current.aegisName,
        ...(current.type ? { type: current.type } : {})
      });
    }
    current = null;
  };

  for (const line of yamlText.split(/\r?\n/)) {
    const idMatch = /^\s*-\s*Id:\s*(\d+)/.exec(line);
    if (idMatch) {
      push();
      current = { id: Number(idMatch[1]) };
      continue;
    }
    if (!current) {
      continue;
    }
    const aegis = /^\s+AegisName:\s*(\S+)/.exec(line);
    if (aegis) {
      current.aegisName = stripQuotes(aegis[1]);
      continue;
    }
    const name = /^\s+Name:\s*(.+?)\s*$/.exec(line);
    if (name) {
      current.name = stripQuotes(name[1]);
      continue;
    }
    const type = /^\s+Type:\s*(\S+)/.exec(line);
    if (type) {
      current.type = stripQuotes(type[1]);
    }
  }
  push();

  return items;
}

/** Scans `mob_db.yml` for `Id` / `AegisName` / `Name` / `Level`. */
export function parseMobDb(yamlText: string): MobDef[] {
  const mobs: MobDef[] = [];
  let current: Partial<MobDef> | null = null;

  const push = (): void => {
    if (current?.id !== undefined && current.aegisName) {
      mobs.push({
        id: current.id,
        aegisName: current.aegisName,
        name: current.name ?? current.aegisName,
        ...(current.level !== undefined ? { level: current.level } : {})
      });
    }
    current = null;
  };

  for (const line of yamlText.split(/\r?\n/)) {
    const idMatch = /^\s*-\s*Id:\s*(\d+)/.exec(line);
    if (idMatch) {
      push();
      current = { id: Number(idMatch[1]) };
      continue;
    }
    if (!current) {
      continue;
    }
    const aegis = /^\s+AegisName:\s*(\S+)/.exec(line);
    if (aegis) {
      current.aegisName = stripQuotes(aegis[1]);
      continue;
    }
    const name = /^\s+Name:\s*(.+?)\s*$/.exec(line);
    if (name) {
      current.name = stripQuotes(name[1]);
      continue;
    }
    const level = /^\s+Level:\s*(\d+)/.exec(line);
    if (level) {
      current.level = Number(level[1]);
    }
  }
  push();

  return mobs;
}

/**
 * Scans `skill_db.yml` for `Id` / `Name` / `Description`.
 *
 * `Name` is what scripts use (`SM_BASH`); `Description` is the readable label
 * shown in the client (`Bash`).
 */
export function parseSkillDb(yamlText: string): SkillDef[] {
  const skills: SkillDef[] = [];
  let current: Partial<SkillDef> | null = null;

  const push = (): void => {
    if (current?.id !== undefined && current.name) {
      skills.push({
        id: current.id,
        name: current.name,
        description: current.description ?? current.name
      });
    }
    current = null;
  };

  for (const line of yamlText.split(/\r?\n/)) {
    const idMatch = /^\s*-\s*Id:\s*(\d+)/.exec(line);
    if (idMatch) {
      push();
      current = { id: Number(idMatch[1]) };
      continue;
    }
    if (!current) {
      continue;
    }
    const name = /^\s+Name:\s*(\S+)/.exec(line);
    if (name) {
      current.name = stripQuotes(name[1]);
      continue;
    }
    const description = /^\s+Description:\s*(.+?)\s*$/.exec(line);
    if (description) {
      current.description = stripQuotes(description[1]);
    }
  }
  push();

  return skills;
}

/** Reads the map name list out of `db/map_index.txt`. */
export function parseMapIndex(text: string): string[] {
  const maps: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_@#.-]+)(?:\s+\d+)?\s*$/.exec(line.trim());
    if (match && !line.trim().startsWith('//')) {
      maps.push(match[1]);
    }
  }
  return maps;
}

/** Reads mapflag names and their one-line descriptions from `doc/mapflags.txt`. */
export function parseMapFlags(text: string): { name: string; description?: string }[] {
  const flags: { name: string; description?: string }[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/^\*?([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*$/gm)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      flags.push({ name });
    }
  }
  return flags;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}
