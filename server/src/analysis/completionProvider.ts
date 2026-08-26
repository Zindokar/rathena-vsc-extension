/**
 * Builds the completion list for a given cursor context.
 *
 * The point of routing through `contextAt` first is that an unfiltered list is
 * useless here: there are 29,000 items, 10,690 constants and 671 commands. If
 * the cursor is on the first argument of `getitem`, offering anything other
 * than items is noise.
 */

import { CompletionItemKind, type CompletionItem } from 'vscode-languageserver/node';

import type { ServerDatabase } from '../data/database.js';
import type { CompletionContext } from './completionContext.js';
import { CONSTANT_PREFIX, kindsAt, variantsFor, type ValueKind } from './paramSemantics.js';

/** Enough to fill the list without making VS Code sluggish. */
const LIMIT = 300;

export function completionsFor(
  context: CompletionContext,
  database: ServerDatabase,
  documentLabels: string[]
): CompletionItem[] {
  switch (context.kind) {
    case 'header-map':
      return mapItems(database, context.prefix);
    case 'header-type':
      return objectTypeItems();
    case 'header-sprite':
      return spriteItems(database, context.prefix);
    case 'mapflag-name':
      return mapFlagItems(database, context.prefix);
    case 'command-arg':
      return argumentItems(context, database, documentLabels);
    default:
      return generalItems(database, context.prefix);
  }
}

function argumentItems(
  context: CompletionContext,
  database: ServerDatabase,
  documentLabels: string[]
): CompletionItem[] {
  const command = database.command(context.command ?? '');
  if (!command) {
    return generalItems(database, context.prefix);
  }

  const kinds = kindsAt(variantsFor(command.signatures), context.argIndex ?? 0, context.insideString);
  if (kinds.length === 0) {
    // A documented argument we cannot classify, or an undocumented command.
    return context.insideString ? [] : generalItems(database, context.prefix);
  }

  const items: CompletionItem[] = [];
  for (const kind of kinds) {
    items.push(...itemsForKind(kind, database, context, documentLabels));
  }
  return items.slice(0, LIMIT);
}

function itemsForKind(
  kind: ValueKind,
  database: ServerDatabase,
  context: CompletionContext,
  documentLabels: string[]
): CompletionItem[] {
  const prefix = context.prefix.toLowerCase();

  switch (kind) {
    case 'item-id':
      return filterAndMap(database.items, LIMIT, (item) => matches(prefix, item.aegisName, item.name, item.id), (item) => ({
        label: String(item.id),
        // Sort by ID rather than lexicographically, and show the name so the
        // list is readable — a column of bare numbers is not.
        filterText: `${item.id} ${item.aegisName} ${item.name}`,
        sortText: String(item.id).padStart(8, '0'),
        kind: CompletionItemKind.Value,
        detail: item.name,
        documentation: `\`${item.aegisName}\`${item.type ? ` · ${item.type}` : ''}`
      }));

    case 'item-name':
      return filterAndMap(database.items, LIMIT, (item) => matches(prefix, item.aegisName, item.name, item.id), (item) => ({
        label: item.aegisName,
        filterText: `${item.aegisName} ${item.name} ${item.id}`,
        kind: CompletionItemKind.Constant,
        detail: item.name,
        documentation: `ID ${item.id}${item.type ? ` · ${item.type}` : ''}`
      }));

    case 'mob-id':
      return filterAndMap(database.mobs, LIMIT, (mob) => matches(prefix, mob.aegisName, mob.name, mob.id), (mob) => ({
        label: String(mob.id),
        filterText: `${mob.id} ${mob.aegisName} ${mob.name}`,
        sortText: String(mob.id).padStart(8, '0'),
        kind: CompletionItemKind.Value,
        detail: mob.name,
        documentation: `\`${mob.aegisName}\`${mob.level ? ` · level ${mob.level}` : ''}`
      }));

    case 'mob-name':
      return filterAndMap(database.mobs, LIMIT, (mob) => matches(prefix, mob.aegisName, mob.name, mob.id), (mob) => ({
        label: mob.aegisName,
        filterText: `${mob.aegisName} ${mob.name} ${mob.id}`,
        kind: CompletionItemKind.Constant,
        detail: mob.name,
        documentation: `ID ${mob.id}${mob.level ? ` · level ${mob.level}` : ''}`
      }));

    case 'skill-id':
      return filterAndMap(database.skills, LIMIT, (skill) => matches(prefix, skill.name, skill.description, skill.id), (skill) => ({
        label: String(skill.id),
        filterText: `${skill.id} ${skill.name} ${skill.description}`,
        sortText: String(skill.id).padStart(8, '0'),
        kind: CompletionItemKind.Value,
        detail: skill.description,
        documentation: `\`${skill.name}\``
      }));

    case 'skill-name':
      return filterAndMap(database.skills, LIMIT, (skill) => matches(prefix, skill.name, skill.description, skill.id), (skill) => ({
        label: skill.name,
        filterText: `${skill.name} ${skill.description} ${skill.id}`,
        kind: CompletionItemKind.Constant,
        detail: skill.description,
        documentation: `ID ${skill.id}`
      }));

    case 'map-name':
      return mapItems(database, context.prefix);

    case 'sprite':
      return spriteItems(database, context.prefix);

    case 'event-label':
      return documentLabels.map((label) => ({
        label,
        kind: CompletionItemKind.Event,
        detail: 'label in this file'
      }));

    case 'status':
    case 'effect':
    case 'send-target':
    case 'bound-type':
    case 'size':
    case 'ai':
      return constantsWithPrefixes(database, CONSTANT_PREFIX[kind] ?? [], context.prefix);

    default:
      return [];
  }
}

function constantsWithPrefixes(
  database: ServerDatabase,
  prefixes: string[],
  typed: string
): CompletionItem[] {
  const lowerTyped = typed.toLowerCase();
  const out: CompletionItem[] = [];

  for (const constant of database.constants) {
    const name = constant.name;
    if (!prefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) {
      continue;
    }
    if (lowerTyped && !name.toLowerCase().includes(lowerTyped)) {
      continue;
    }
    out.push({
      label: name,
      kind: CompletionItemKind.EnumMember,
      detail: constant.value || 'constant'
    });
    if (out.length >= LIMIT) {
      break;
    }
  }
  return out;
}

function mapItems(database: ServerDatabase, typed: string): CompletionItem[] {
  const lower = typed.toLowerCase();
  const out: CompletionItem[] = [];
  for (const name of database.maps) {
    if (lower && !name.toLowerCase().includes(lower)) {
      continue;
    }
    out.push({ label: name, kind: CompletionItemKind.File, detail: 'map' });
    if (out.length >= LIMIT) {
      break;
    }
  }
  return out;
}

function spriteItems(database: ServerDatabase, typed: string): CompletionItem[] {
  const lower = typed.toLowerCase();
  const out: CompletionItem[] = [];

  // `-1` is the conventional sprite for a floating NPC with no visible body.
  if (!lower) {
    out.push({
      label: '-1',
      kind: CompletionItemKind.Value,
      detail: 'invisible (floating NPC)',
      sortText: '0000'
    });
    out.push({
      label: 'HIDDEN_NPC',
      kind: CompletionItemKind.EnumMember,
      detail: 'clickable but invisible',
      sortText: '0001'
    });
  }

  for (const constant of database.spriteConstants()) {
    if (lower && !constant.name.toLowerCase().includes(lower)) {
      continue;
    }
    out.push({
      label: constant.name,
      kind: CompletionItemKind.EnumMember,
      detail: 'NPC sprite',
      sortText: `1_${constant.name}`
    });
    if (out.length >= LIMIT) {
      break;
    }
  }
  return out;
}

function mapFlagItems(database: ServerDatabase, typed: string): CompletionItem[] {
  const lower = typed.toLowerCase();
  return database.mapFlags
    .filter((flag) => !lower || flag.name.toLowerCase().includes(lower))
    .slice(0, LIMIT)
    .map((flag) => ({
      label: flag.name,
      kind: CompletionItemKind.EnumMember,
      detail: 'mapflag',
      ...(flag.description ? { documentation: flag.description } : {})
    }));
}

function objectTypeItems(): CompletionItem[] {
  const types: [string, string][] = [
    ['script', 'A clickable NPC with a script body'],
    ['shop', 'Sells items for zeny'],
    ['cashshop', 'Sells items for cash points'],
    ['itemshop', 'Sells items for another item'],
    ['pointshop', 'Sells items for a variable'],
    ['warp', 'A portal to another map'],
    ['monster', 'A permanent monster spawn'],
    ['boss_monster', 'An MVP spawn, shown on the /mi radar'],
    ['mapflag', 'Applies a flag to a map'],
    ['duplicate', 'Copies an existing NPC to a new location']
  ];
  return types.map(([label, detail]) => ({
    label,
    kind: CompletionItemKind.Keyword,
    detail
  }));
}

function generalItems(database: ServerDatabase, typed: string): CompletionItem[] {
  const lower = typed.toLowerCase();
  const items: CompletionItem[] = [];

  for (const command of database.commands) {
    if (lower && !command.name.toLowerCase().startsWith(lower)) {
      continue;
    }
    items.push({
      label: command.name,
      kind: CompletionItemKind.Function,
      detail: command.signatures?.[0] ?? command.arg,
      ...(command.deprecated ? { tags: [1 as const] } : {}),
      data: { type: 'command', name: command.name }
    });
  }

  // Constants only once there is something to filter on: an unfiltered list of
  // 10,690 is not a useful thing to show anyone.
  if (typed.length >= 2) {
    for (const constant of database.constantsStartingWith(typed, LIMIT)) {
      items.push({
        label: constant.name,
        kind: CompletionItemKind.Constant,
        detail: constant.value || 'constant',
        data: { type: 'constant', name: constant.name }
      });
    }
  }

  return items;
}

/** Case-insensitive substring match against a name, a label and an ID. */
function matches(prefix: string, aegis: string, name: string, id: number): boolean {
  if (!prefix) {
    return true;
  }
  return (
    aegis.toLowerCase().includes(prefix) ||
    name.toLowerCase().includes(prefix) ||
    String(id).startsWith(prefix)
  );
}

function filterAndMap<T>(
  source: T[],
  limit: number,
  predicate: (value: T) => boolean,
  map: (value: T) => CompletionItem
): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const value of source) {
    if (!predicate(value)) {
      continue;
    }
    out.push(map(value));
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}
