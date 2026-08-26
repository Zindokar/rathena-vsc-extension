# rAthenaExtension

Language support for [rAthena](https://github.com/rathena/rathena) inside Visual Studio Code: NPC scripts, YAML databases and server configuration files.

> Status: **v0.4.0.** Highlighting, snippets, context-aware completion, hover, outline, two independent diagnostic engines and searchable database pickers. 184 unit tests and a regression corpus over every official rAthena script. Go-to-definition, rename and formatting are next — see [PLAN.md](PLAN.md).

## Features

- **Syntax highlighting** for NPC scripts and `.conf` files, including tab-separated definition lines, `^RRGGBB` colour codes and every variable scope sigil.
- **Context-aware completion** — on `getitem` you get items, on `monster` you get maps then mobs, on `sc_start` you get `SC_` constants, in the fourth field of a definition line you get NPC sprites.
- **Searchable pickers** for the big databases, one keystroke away: 29,356 items, 2,675 monsters, 1,635 skills, 1,312 sprites and 1,295 maps.
- **Hover** showing a command's real signature and arity plus its documentation, and resolving item, mob and skill IDs to their names.
- **Outline** listing every NPC in a file and its labels.
- **Fast diagnostics** for missing semicolons, unbalanced brackets, unterminated strings, spaces used where rAthena requires tabs, and unknown commands.
- **Map-server parser** — a faithful port of rAthena's own `parse_script`, checking the file you have open and reporting the exact error the server would print, in the exact format it would print it. Entirely offline: nothing to compile, no database to run.
- **21 snippets** for NPCs, warps, shops, monster spawns, mapflags, function objects, event labels and dialogue menus.

---

## Keyboard shortcuts

All of the extension's own bindings use <kbd>Ctrl</kbd>+<kbd>Alt</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd> on macOS) and only fire when an rAthena script has focus, so they stay out of the way in your other files.

### Insert from the databases

Each opens a searchable list. What gets inserted depends on where the cursor is: **inside a string literal you get the AegisName, outside one you get the numeric ID.** The picker title tells you which before you commit.

| Shortcut (Win/Linux) | macOS | Command | Inserts |
|---|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd> | rAthena: Insert Item… | `501` or `Red_Potion` |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | rAthena: Insert Monster… | `1002` or `PORING` |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | rAthena: Insert Skill… | `5` or `SM_BASH` |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> | rAthena: Insert NPC Sprite… | `HIDDEN_NPC` |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> | rAthena: Insert Map Name… | `prontera` |

Every picker matches on all three fields at once, so `red potion`, `Red_Potion` and `501` all find the same entry. Sprites and map names have no numeric form worth inserting, so they always go in by name.

The first invocation of each loads its list; after that it is instant. **rAthena: Re-index Server Database** clears the caches.

### Check the script

| Shortcut (Win/Linux) | macOS | Command | What it does |
|---|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> | rAthena: Check Syntax (map-server parser) | Parses the open file exactly as the map-server would |

It runs in milliseconds, reads only the file you have open, and its notification carries the file and line with a **Go to error** button.

### Built-in VS Code keys worth knowing

These are not ours, but they are where the extension does most of its work:

| Shortcut | macOS | What it does here |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Space</kbd> | <kbd>Ctrl</kbd>+<kbd>Space</kbd> | Force completion. Contents depend on the cursor position |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | Jump to an NPC or a label in this file |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | Problems panel — every diagnostic in one list |
| <kbd>F8</kbd> | <kbd>F8</kbd> | Next diagnostic in the file |
| <kbd>Tab</kbd> | <kbd>Tab</kbd> | Expand a snippet, then move between its placeholders |

Completion also triggers on its own after a comma, a space or a quote — the moments you are about to type an argument.

### Rebinding

If one of these collides with something you already use, open *Keyboard Shortcuts* (<kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd> <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd>) and search for `rathena`. Every binding is guarded by `editorLangId == rathena-script`, so a conflict only matters while you are actually editing a script.

### Everything in the command palette

Not all of these have a shortcut. <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, then type `rathena`:

- **Insert Item… / Insert Monster… / Insert Skill… / Insert NPC Sprite… / Insert Map Name…**
- **Check Syntax (map-server parser)** — parse the current file
- **Re-index Server Database** — after editing `db/` or adding custom items
- **Show Detected Server Path** — what the extension thinks your server folder is
- **Restart Language Server** — when something looks stuck

---

## Getting started

```bash
git clone https://github.com/Zindokar/rathena-vsc-extension.git
cd rathena-vsc-extension
npm install
npm run package:full
code --install-extension rathena-extension-0.4.0.vsix
```

For development instead, open `rathena-extension.code-workspace` — which loads this project alongside your rAthena checkout — and press <kbd>F5</kbd>.

The extension finds your server automatically by walking up from the open folder and checking sibling directories for one containing `conf/`, `db/`, `npc/` and `src/`. To be explicit:

```jsonc
{
  "rathena.serverPath": "~/rathena",
  "rathena.mode": "renewal"
}
```

## Where the data comes from

Arity and constants are read from the **C++ source**, not from `doc/script_commands.txt`:

| Source | Provides |
|---|---|
| `src/map/script.cpp` | `BUILDIN_DEF(name, "args")` — 671 commands with authoritative signatures |
| `src/map/script_constants.hpp` | `export_constant*` — 10,690 constants, including 1,312 NPC sprites |
| `doc/script_commands.txt` | Prose descriptions, and the parameter semantics behind completion |
| `doc/mapflags.txt` | 70 mapflags |
| `db/<mode>/item_db*.yml` | 29,356 items |
| `db/<mode>/mob_db.yml` | 2,675 monsters |
| `db/<mode>/skill_db.yml` | 1,635 skills |
| `db/map_index.txt` | 1,295 map names |
| `npc/**/*.txt` | Names of global `function script` objects |

The documentation file is prose written for humans and drifts from the implementation; `BUILDIN_DEF` is what the server actually compiles, so it cannot disagree with the running code. The signature grammar is `(v|s|i|r|l)*\?*\*?` — `v` value, `s` string, `i` int, `r` variable reference, `l` label, `?` one optional parameter, `*` any number more.

Three details that are easy to get wrong and that this extension handles:

- **Lookups are case-insensitive.** rAthena hashes identifiers through `TOLOWER` (`calc_hash` in `script.cpp`), which is why scripts write `Job_Novice` 168 times while the exported constant is `JOB_NOVICE`.
- **NPC sprite constants lose a prefix.** `export_constant_npc(JT_HIDDEN_NPC)` expands to `export_constant_offset(a, 3)`, so the usable name is `HIDDEN_NPC`. That is 1,312 constants a naive parser drops.
- **Function names are tab-delimited fields, not identifiers.** rAthena has one called `seven_qset-3`, with a hyphen, and another called `171_worker_talk`, starting with a digit. Capturing only an identifier truncates the first at the hyphen — which then makes the ordinary variable `seven_qset` look like a function call.

## How completion knows what you mean

`BUILDIN_DEF` gives types but not meaning: `getitem` has signature `vi?`, which says the first argument is a value and the second an int, but not that the first is an item ID.

Rather than hand-maintaining a table of several hundred commands, the meaning is derived from the usage lines in the documentation, which use a remarkably consistent placeholder vocabulary — `<item id>` appears 49 times, `<map name>` 56, `<amount>` 53:

```
*getitem <item id>,<amount>{,<account ID>};
*getitem "<item name>",<amount>{,<account ID>};
*monster "<map name>",<x>,<y>,"<name to show>",<mob id>,<amount>{...};
```

Mapping that vocabulary once covers every documented command. The two `getitem` forms are also what let the extension offer numeric IDs outside a string and AegisNames inside one — the choice is documented, not guessed.

## Two checkers, on purpose

The extension runs two independent analyses of **the file you have open**, and they answer different questions.

**The fast checks** (`quickCheck`) are heuristics over the token stream. They are error-tolerant, run on every keystroke, and deliberately stay quiet when unsure. They answer *"does this look wrong?"*

**The map-server parser** (`mapServerParser`) is a port of `parse_script` from `src/map/script.cpp`, statement for statement, with the same error messages and positions. It answers *"will the server parse this?"*

The port is viable because of three properties of the original:

1. **It has no runtime dependencies.** The parser never touches `item_db`, `mob_db` or the map cache. Its only external input is the symbol table, which we already build from `BUILDIN_DEF` and `export_constant`.
2. **It is small** — roughly 1,755 lines, much of which is bytecode emission that a validator does not need.
3. **All 45 of its error messages are purely syntactic.**

One faithful behaviour is worth knowing about: `disp_error_message` ends in `longjmp`, so the real parser reports one error and abandons the script. We keep that per NPC block — reporting a second error inside a block would mean inventing recovery the server does not have. Since the server parses each NPC separately, a file with three broken NPCs still produces three errors.

Because it is a full parse, it runs on save rather than on every keystroke. `rathena.strictParser` accepts `onSave` (default), `onType` or `off`.

Its diagnostics carry the complete error block in the map-server's own format — a port of `script_errorwarning_sub`, down to the `printf("% 5d")` column alignment and the single quotes around the offending character:

```
script error on npc/custom/test.txt line 15
    parse_line: expected ';'
    12 : prontera,150,180,4	script	Roto Uno	100,{
    13 :
    14 : 	mes "[^0055FFZindokar^000000]"
*   15 : 	'm'es "Esta linea si esta bien.";
    16 : 	next;
```

### Scope: the open file, and only the open file

Both analyses read the buffer you are editing and nothing else. No compiled server, no database, no other script.

The one input from outside is the symbol table — commands, constants and the names of global `function script` objects — built once when the extension indexes your server. Without the function names, every cross-file call such as `F_Navi("...")` would be reported as undeclared. That is a lookup table, not analysis of other files: the parse itself never leaves the buffer.

The trade-off is deliberate. Problems that only appear when the whole server loads — duplicate NPC names across files, a warp pointing at a map missing from the map cache — are out of scope by design. Catching those means running the actual server, and the cost of that (a compiled binary, a live database, seconds per run) is not worth paying for a syntax check you want to fire on every save.

### When the two disagree

`npc/quests/quests_moscovia.txt:9923` has an extra closing parenthesis. The fast checks flag it; the map-server parser does not — and the map-server parser is right about what the server does. In `parse_line`, a successful variable assignment returns via:

```c
return parse_syntax_close(p2 + 1);
```

That `+ 1` consumes one character without checking that it is a `;`. The stray `)` lands in that slot and is silently swallowed. rAthena loads the file.

So both are correct: it is a typo worth fixing, and the server does not care. That disagreement is the reason to keep both analyses rather than replacing one with the other.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `rathena.serverPath` | *(auto-detect)* | Your rAthena folder |
| `rathena.mode` | `renewal` | Which `db/` folder to index |
| `rathena.strictParser` | `onSave` | When to run the ported parser: `onSave`, `onType`, `off` |
| `rathena.diagnostics.enable` | `true` | All diagnostics |
| `rathena.diagnostics.unknownIds` | `true` | The unknown-command warning |
| `rathena.trace.server` | `off` | LSP traffic logging |
| `rathena.format.indentStyle` | `tab` | Reserved. The formatter is not implemented yet, so this currently does nothing |

## Development

```bash
npm run watch        # rebuild client and server on change
npm run check        # tsc --noEmit
npm run lint         # eslint
npm run test         # unit tests (184)
npm run verify       # run the analysers over every official rAthena script
npm run gen:data     # regenerate the bundled fallback dataset
npm run package:full # generate data, then build a .vsix
```

The client and the server are bundled separately by esbuild into `dist/client.js` and `dist/server.js`, with `vscode` as the only external. Everything the server needs at runtime is inlined, which is why `node_modules` is excluded from the `.vsix`.

### Testing

| Document | What it is |
|---|---|
| [TEST-PLAN.md](TEST-PLAN.md) | The strategy: coverage matrix per module, acceptance criteria, procedures, known gaps |
| [TESTING.md](TESTING.md) | The manual checklist, section by section |
| [test-fixtures/COPY-PASTE.md](test-fixtures/COPY-PASTE.md) | Twenty paste-ready snippets with their verified expected output |

`test-fixtures/npc/` holds three files used throughout: `smoke-test.txt` (must produce zero diagnostics), `errors-test.txt` (six isolated faults) and `broken-test.txt` (thirteen faults deliberately mixed with correct code, so it tests both directions at once).

### The corpus check

`npm run verify` runs the lexer and every diagnostic over rAthena's own `npc/` tree — about 26 MB across 1,139 files, five million tokens, roughly 3 seconds. The bar is zero diagnostics.

At rAthena `0c3ca757a` it reports three, and all three are genuine defects upstream rather than analyser bugs:

```
npc/quests/quests_moscovia.txt:9923 — Expected '}' to close '{' opened on line 9920, found ')'
npc/quests/quests_moscovia.txt:9993 — Unmatched '}'          (cascade from the above)
npc/pre-re/jobs/novice/novice.txt:2741 — Missing ';'
```

Line 9923 has five opening and six closing parentheses; the otherwise identical line 9924 has five of each. And `novice.txt:2741` is a bare `return` with no semicolon sitting directly above an `end;`.

That corpus is what keeps the checks honest. Missing-semicolon detection in particular is easy to write and hard to write *well* — the difficulty is not finding the omissions but staying silent on the many places a semicolon legitimately does not belong: labels, `case` arms, control-flow headers, and expressions wrapped across lines. Every rule in `checkMissingSemicolons` earned its place by removing a false positive from this corpus.

The threshold is baked into the `--max 3` flag and the script exits non-zero when it is exceeded, ready for CI. If a change makes the count go up, the fix is the analyser — never the threshold.

## Contributing

Bug reports and pull requests are welcome at [rathena-vsc-extension](https://github.com/Zindokar/rathena-vsc-extension).

Before opening a PR:

```bash
npm run check && npm run lint && npm test && npm run verify
```

Every bug fixed so far left a regression test behind, and [TEST-PLAN.md](TEST-PLAN.md) keeps a table linking each one to the test that would have caught it. New diagnostics need both the positive cases and the exemptions — the places they must stay quiet — plus a clean corpus run.

## Licence

MIT
