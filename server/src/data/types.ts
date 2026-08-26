/** Shapes shared by the runtime indexer and the bundled-data generator. */

/**
 * A script command as declared by `BUILDIN_DEF` in `src/map/script.cpp`.
 *
 * The `arg` string is the authoritative source of arity information. Its
 * grammar, per `add_buildin_func`, is `(v|s|i|r|l)*\?*\*?`:
 *
 * | char | meaning                                        |
 * |------|------------------------------------------------|
 * | `v`  | value — string, int or reference                |
 * | `s`  | string                                          |
 * | `i`  | int                                             |
 * | `r`  | reference to a variable                         |
 * | `l`  | label                                           |
 * | `?`  | one optional parameter                          |
 * | `*`  | any number of further optional parameters       |
 */
export interface CommandDef {
  /** Name as written in a script, e.g. `getitem`. */
  name: string;
  /** Raw signature string, e.g. `"ii?"`. */
  arg: string;
  /** Number of parameters that must be supplied. */
  minArgs: number;
  /** Maximum accepted, or `null` when the command is variadic. */
  maxArgs: number | null;
  /** Per-parameter type letters, excluding `?` and `*`. */
  paramTypes: ParamType[];
  /** Deprecation date declared in the source, when present. */
  deprecated?: string;
  /** First lines of the entry in `doc/script_commands.txt`. */
  documentation?: string;
  /** Usage lines (the `*command <args>;` forms) from the documentation. */
  signatures?: string[];
}

export type ParamType = 'v' | 's' | 'i' | 'r' | 'l';

export interface ConstantDef {
  name: string;
  value: string;
  /** Set for constants defined in `db/const.yml` rather than the C++ source. */
  fromDatabase?: boolean;
  /**
   * Set for the `export_constant_npc` family — NPC sprite IDs. Marked at parse
   * time because the `JT_` prefix is stripped on export, which leaves them
   * indistinguishable from ordinary constants afterwards.
   */
  sprite?: boolean;
}

export interface ItemDef {
  id: number;
  aegisName: string;
  name: string;
  type?: string;
}

export interface MobDef {
  id: number;
  aegisName: string;
  name: string;
  level?: number;
}

export interface SkillDef {
  id: number;
  name: string;
  description: string;
}

export interface MapFlagDef {
  name: string;
  description?: string;
}

/** Everything the language server needs to answer semantic questions. */
export interface ServerData {
  /** rAthena git commit the data was produced from, when known. */
  revision?: string;
  generatedAt: string;
  commands: CommandDef[];
  constants: ConstantDef[];
  items: ItemDef[];
  mobs: MobDef[];
  skills: SkillDef[];
  maps: string[];
  mapFlags: MapFlagDef[];
  /** Names of global `function script` objects found in the npc/ tree. */
  globalFunctions?: string[];
}

export function emptyServerData(): ServerData {
  return {
    generatedAt: new Date().toISOString(),
    commands: [],
    constants: [],
    items: [],
    mobs: [],
    skills: [],
    maps: [],
    mapFlags: []
  };
}
