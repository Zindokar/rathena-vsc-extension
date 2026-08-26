/**
 * Searchable pickers for the big databases.
 *
 * Inline completion is the right tool when you already know roughly what you
 * want. Browsing 29,000 items to find "that red herb thing" is a different
 * task, and a quick pick — with its fuzzy matching, its wide layout and its
 * detail line — is much better at it.
 *
 * Which form gets inserted depends on where the cursor is: inside a string
 * literal the AegisName is what belongs there, outside one the numeric ID.
 */

import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

export type BrowseKind = 'item' | 'mob' | 'skill' | 'sprite' | 'map';

interface BrowseEntry {
  id: number | null;
  name: string;
  aegis: string;
  extra?: string;
}

const TITLES: Record<BrowseKind, string> = {
  item: 'Insert item',
  mob: 'Insert monster',
  skill: 'Insert skill',
  sprite: 'Insert NPC sprite',
  map: 'Insert map name'
};

const PLACEHOLDERS: Record<BrowseKind, string> = {
  item: 'Search by name, AegisName or ID — e.g. "red potion", "Red_Potion", 501',
  mob: 'Search by name, AegisName or ID — e.g. "poring", "PORING", 1002',
  skill: 'Search by name or ID — e.g. "bash", "SM_BASH", 5',
  sprite: 'Search sprite constants — e.g. "kafra", "hidden"',
  map: 'Search map names — e.g. "prontera", "prt_fild"'
};

/** Cached per kind: the lists never change while the server is indexed. */
const cache = new Map<BrowseKind, BrowseEntry[]>();

export function clearBrowseCache(): void {
  cache.clear();
}

export async function browseAndInsert(
  client: LanguageClient | undefined,
  kind: BrowseKind
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Open an rAthena script first.');
    return;
  }
  if (!client) {
    void vscode.window.showWarningMessage('The rAthena language server is not running.');
    return;
  }

  let entries = cache.get(kind);
  if (!entries) {
    entries = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Loading ${kind} database…` },
      () => client.sendRequest<BrowseEntry[]>('rathena/browse', { kind })
    );
    cache.set(kind, entries);
  }

  if (entries.length === 0) {
    void vscode.window.showWarningMessage(
      `No ${kind} data indexed. Check that "rathena.serverPath" points at your server.`
    );
    return;
  }

  const insertName = isInsideString(editor);

  const picks: (vscode.QuickPickItem & { entry: BrowseEntry })[] = entries.map((entry) => ({
    label: entry.name,
    description: entry.id !== null ? `${entry.id}` : '',
    detail: entry.aegis !== entry.name ? entry.aegis + (entry.extra ? ` · ${entry.extra}` : '') : entry.extra,
    entry
  }));

  const chosen = await vscode.window.showQuickPick(picks, {
    title: `${TITLES[kind]} — inserting ${insertName ? 'the name' : 'the ID'}`,
    placeHolder: PLACEHOLDERS[kind],
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!chosen) {
    return;
  }

  const text = textToInsert(chosen.entry, kind, insertName);
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}

/**
 * Sprites and maps have no numeric form worth inserting, so they always go in
 * by name. Items, mobs and skills follow the cursor.
 */
function textToInsert(entry: BrowseEntry, kind: BrowseKind, insideString: boolean): string {
  if (kind === 'sprite' || kind === 'map' || entry.id === null) {
    return entry.aegis;
  }
  return insideString ? entry.aegis : String(entry.id);
}

/**
 * Counts unescaped quotes before the cursor on the current line. An odd count
 * means the cursor is inside a string literal.
 */
function isInsideString(editor: vscode.TextEditor): boolean {
  const position = editor.selection.active;
  const before = editor.document.getText(
    new vscode.Range(position.with(undefined, 0), position)
  );

  let quotes = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === '\\') {
      i += 1;
      continue;
    }
    if (before[i] === '"') {
      quotes += 1;
    }
    if (before[i] === '/' && before[i + 1] === '/') {
      break; // a comment; anything after is not code
    }
  }
  return quotes % 2 === 1;
}
