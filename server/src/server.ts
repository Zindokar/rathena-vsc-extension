import * as path from 'node:path';

import {
  MarkupKind,
  ProposedFeatures,
  SymbolKind,
  TextDocuments,
  TextDocumentSyncKind,
  createConnection,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type InitializeResult
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { completionsFor } from './analysis/completionProvider.js';
import { contextAt } from './analysis/completionContext.js';
import { quickCheck } from './analysis/quickCheck.js';
import { strictCheckDetailed } from './analysis/strictCheck.js';
import { ServerDatabase } from './data/database.js';
import { detectServerRoot, expandHome, isServerRoot } from './data/serverPath.js';
import type { CommandDef } from './data/types.js';
import { TokenKind, tokenize, type Token } from './lexer.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const database = new ServerDatabase();

/** Cached token streams, so completion and hover do not re-lex the document. */
const tokenCache = new Map<string, { version: number; tokens: Token[] }>();

let settings = {
  serverPath: '',
  mode: 'renewal' as 'renewal' | 'pre-renewal',
  diagnosticsEnabled: true,
  unknownIdDiagnostics: true,
  strictParser: 'onSave' as 'off' | 'onSave' | 'onType'
};

/**
 * Results of the last strict-parser run, per document.
 *
 * The strict parser is a full parse of every NPC in the file, so it is not run
 * on every keystroke by default. Its findings are cached here and merged into
 * whatever the fast checks produce, so the squiggles stay on screen while the
 * user keeps typing.
 */
const strictResults = new Map<string, Diagnostic[]>();

let workspaceRoots: string[] = [];

connection.onInitialize((params): InitializeResult => {
  const init = (params.initializationOptions ?? {}) as {
    serverPath?: string;
    workspaceFolders?: string[];
  };
  settings.serverPath = init.serverPath ?? '';
  workspaceRoots =
    init.workspaceFolders ??
    (params.workspaceFolders ?? []).map((folder) => folder.uri.replace('file://', ''));

  return {
    capabilities: {
      // The numeric shorthand (`TextDocumentSyncKind.Incremental`) does NOT
      // include the save notification — with it, `documents.onDidSave` never
      // fires and the strict parser's default `onSave` mode silently does
      // nothing. The object form with `save: true` is required.
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: true
      },
      completionProvider: {
        resolveProvider: true,
        // A comma or a space after a command name is exactly the moment the
        // user wants to see what belongs in that argument.
        triggerCharacters: ['.', '@', '$', '#', "'", ',', ' ', '\t', '"']
      },
      hoverProvider: true,
      documentSymbolProvider: true
    }
  };
});

connection.onInitialized(() => {
  // Produced by `npm run gen:data`, emitted next to the bundled server.
  database.loadBundled(path.join(__dirname, 'server-data.json'));
  void resolveAndIndex();
});

connection.onDidChangeConfiguration(async (change) => {
  const config = (change.settings as { rathena?: Record<string, unknown> })?.rathena ?? {};
  settings = {
    serverPath: (config.serverPath as string) ?? settings.serverPath,
    mode: (config.mode as 'renewal' | 'pre-renewal') ?? settings.mode,
    diagnosticsEnabled: (config['diagnostics.enable'] as boolean) ?? settings.diagnosticsEnabled,
    unknownIdDiagnostics: (config['diagnostics.unknownIds'] as boolean) ?? settings.unknownIdDiagnostics,
    strictParser: (config.strictParser as 'off' | 'onSave' | 'onType') ?? settings.strictParser
  };
  await resolveAndIndex();
  documents.all().forEach(validate);
});

connection.onRequest('rathena/reindex', async () => {
  await resolveAndIndex();
  documents.all().forEach(validate);
  return database.stats;
});

connection.onRequest('rathena/serverPath', () => database.serverRoot ?? null);

/**
 * Feeds the client's quick-pick browsers.
 *
 * The lists are sent whole rather than filtered server-side: VS Code's own
 * fuzzy matching in a quick pick is better than anything we would reimplement,
 * and 29,000 short records is a few megabytes at most.
 */
connection.onRequest('rathena/browse', (params: { kind: 'item' | 'mob' | 'skill' | 'sprite' | 'map' }) => {
  switch (params.kind) {
    case 'item':
      return database.items.map((i) => ({ id: i.id, name: i.name, aegis: i.aegisName, extra: i.type }));
    case 'mob':
      return database.mobs.map((m) => ({
        id: m.id,
        name: m.name,
        aegis: m.aegisName,
        extra: m.level ? `level ${m.level}` : undefined
      }));
    case 'skill':
      return database.skills.map((s) => ({ id: s.id, name: s.description, aegis: s.name }));
    case 'sprite':
      return database.spriteConstants().map((c) => ({ id: null, name: c.name, aegis: c.name }));
    case 'map':
      return database.maps.map((m) => ({ id: null, name: m, aegis: m }));
    default:
      return [];
  }
});

/** Runs the map-server parser on demand, regardless of the configured mode. */
connection.onRequest('rathena/strictCheck', (params: { uri: string }) => {
  const document = documents.get(params.uri);
  if (!document) {
    return { errors: 0, reports: [], line: null };
  }
  const { diagnostics, reports } = runStrictParser(document);
  validate(document);
  return {
    errors: diagnostics.length,
    reports,
    first: diagnostics[0]?.message.split('\n')[0],
    line: diagnostics[0] ? diagnostics[0].range.start.line : null,
    character: diagnostics[0] ? diagnostics[0].range.start.character : null
  };
});

/** Resolves the server root from settings or auto-detection, then indexes it. */
async function resolveAndIndex(): Promise<void> {
  const configured = settings.serverPath ? expandHome(settings.serverPath) : '';
  const root = configured && isServerRoot(configured) ? configured : detectServerRoot(workspaceRoots);

  if (!root) {
    connection.console.warn(
      'No rAthena server folder found. Set "rathena.serverPath" to enable database-aware features.'
    );
    return;
  }

  connection.console.info(`Indexing rAthena server at ${root} (${settings.mode})…`);
  const started = Date.now();
  await database.index({ serverRoot: root, mode: settings.mode });
  const { commands, constants, items, mobs } = database.stats;
  connection.console.info(
    `Indexed ${commands} commands, ${constants} constants, ${items} items and ${mobs} mobs in ${Date.now() - started} ms.`
  );
}

// ---- Document lifecycle ---------------------------------------------------

documents.onDidChangeContent((change) => {
  if (settings.strictParser === 'onType') {
    runStrictParser(change.document);
  }
  validate(change.document);
});

documents.onDidSave((event) => {
  if (settings.strictParser !== 'off') {
    runStrictParser(event.document);
  }
  validate(event.document);
});

documents.onDidClose((event) => {
  tokenCache.delete(event.document.uri);
  strictResults.delete(event.document.uri);
  void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

/** Runs the ported map-server parser and caches its diagnostics. */
function runStrictParser(document: TextDocument): { diagnostics: Diagnostic[]; reports: string[] } {
  if (document.languageId !== 'rathena-script') {
    return { diagnostics: [], reports: [] };
  }
  const result = strictCheckDetailed(document.getText(), database, displayPath(document.uri));
  strictResults.set(document.uri, result.diagnostics);
  return result;
}

/** Shortens a URI to the path rAthena itself would print, e.g. `npc/custom/x.txt`. */
function displayPath(uri: string): string {
  const fsPath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  const index = fsPath.lastIndexOf('/npc/');
  return index >= 0 ? fsPath.slice(index + 1) : fsPath;
}

function tokensFor(document: TextDocument): Token[] {
  const cached = tokenCache.get(document.uri);
  if (cached && cached.version === document.version) {
    return cached.tokens;
  }
  const { tokens } = tokenize(document.getText());
  tokenCache.set(document.uri, { version: document.version, tokens });
  return tokens;
}

function validate(document: TextDocument): void {
  if (document.languageId !== 'rathena-script') {
    return;
  }
  if (!settings.diagnosticsEnabled) {
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  const diagnostics = quickCheck(document.getText(), tokensFor(document), {
    checkUnknownCommands: settings.unknownIdDiagnostics,
    database
  });

  if (settings.strictParser !== 'off') {
    diagnostics.push(...(strictResults.get(document.uri) ?? []));
  }

  void connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// ---- Completion -----------------------------------------------------------

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const context = contextAt(text, offset, tokensFor(document));

  return completionsFor(context, database, labelsIn(text));
});

/** Event and user labels defined in the document, for `<event label>` arguments. */
function labelsIn(text: string): string[] {
  const labels = new Set<string>();
  for (const match of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) {
    labels.add(match[1]);
  }
  return [...labels].sort();
}

connection.onCompletionResolve((item): CompletionItem => {
  const data = item.data as { type?: string; name?: string } | undefined;
  if (data?.type === 'command' && data.name) {
    const command = database.command(data.name);
    if (command) {
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: commandMarkdown(command)
      };
    }
  }
  return item;
});

// ---- Hover ----------------------------------------------------------------

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const offset = document.offsetAt(params.position);
  const token = tokensFor(document).find((t) => t.start <= offset && offset < t.end);
  if (!token) {
    return null;
  }

  const range = {
    start: { line: token.line, character: token.character },
    end: { line: token.line, character: token.character + token.value.length }
  };

  if (token.kind === TokenKind.Identifier) {
    const name = token.name ?? token.value;

    const command = database.command(name);
    if (command) {
      return { contents: { kind: MarkupKind.Markdown, value: commandMarkdown(command) }, range };
    }

    const constant = database.constant(name);
    if (constant) {
      // Most constants come from `export_constant(X)`, whose value is a C++
      // enum with no textual form. Only show a value when there is one.
      const detail = constant.value ? `\n\n\`= ${constant.value}\`` : '';
      const canonical =
        constant.name === name ? '' : `\n\nDefined as \`${constant.name}\` (lookups are case-insensitive).`;
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${name}** — script constant${detail}${canonical}`
        },
        range
      };
    }

    const item = database.item(name);
    if (item) {
      return { contents: { kind: MarkupKind.Markdown, value: itemMarkdown(item.id, item.aegisName, item.name) }, range };
    }
  }

  if (token.kind === TokenKind.Number) {
    const id = Number(token.value);
    const item = database.item(id);
    const mob = database.mob(id);
    const parts: string[] = [];
    if (item) {
      parts.push(itemMarkdown(item.id, item.aegisName, item.name));
    }
    if (mob) {
      parts.push(`**Mob ${mob.id}** — ${mob.name} (\`${mob.aegisName}\`)${mob.level ? `, level ${mob.level}` : ''}`);
    }
    if (parts.length > 0) {
      return { contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n---\n\n') }, range };
    }
  }

  if (token.kind === TokenKind.Variable) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${token.value}**\n\nScope: \`${token.scope}\`\nType: ${token.isString ? 'string' : 'integer'}`
      },
      range
    };
  }

  return null;
});

// ---- Document symbols -----------------------------------------------------

/**
 * Outline built straight from the token stream: every top-level definition
 * line becomes a symbol, and every label inside a block becomes a child.
 * The real parser will replace this, but it already makes Ctrl+Shift+O usable.
 */
connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const symbols: DocumentSymbol[] = [];
  const lines = document.getText().split(/\r?\n/);

  const headerRe =
    /^(?:-|function|[A-Za-z_][A-Za-z0-9_@#.-]*(?:,-?\d+)*)\t+(script|shop|cashshop|itemshop|pointshop|marketshop|warp|monster|boss_monster|duplicate\([^)]*\))\t+([^\t]+)/;
  const labelRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/;

  let current: DocumentSymbol | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const header = headerRe.exec(line);
    if (header) {
      const range = { start: { line: i, character: 0 }, end: { line: i, character: line.length } };
      current = {
        name: header[2].trim(),
        detail: header[1],
        kind: header[1] === 'script' ? SymbolKind.Class : SymbolKind.Object,
        range,
        selectionRange: range,
        children: []
      };
      symbols.push(current);
      continue;
    }

    const label = labelRe.exec(line);
    if (label && current) {
      const range = { start: { line: i, character: 0 }, end: { line: i, character: line.length } };
      current.children?.push({
        name: label[1],
        kind: label[1].startsWith('On') ? SymbolKind.Event : SymbolKind.Method,
        range,
        selectionRange: range
      });
    }
  }

  // Stretch each symbol's range down to the line before the next one so that
  // breadcrumbs stay correct while scrolling through a file.
  for (let i = 0; i < symbols.length; i += 1) {
    const nextStart = symbols[i + 1]?.range.start.line ?? lines.length;
    symbols[i].range.end = { line: Math.max(symbols[i].range.start.line, nextStart - 1), character: 0 };
  }

  return symbols;
});

// ---- Formatting helpers ---------------------------------------------------

function signatureLine(command: CommandDef): string {
  const params = command.paramTypes.map(describeParam);
  const optional = command.maxArgs === null ? '...' : '';
  const optionalCount = command.maxArgs === null ? 0 : command.maxArgs - command.minArgs;
  for (let i = 0; i < optionalCount; i += 1) {
    params.push('optional');
  }
  if (optional) {
    params.push(optional);
  }
  return `${command.name}(${params.join(', ')})`;
}

function describeParam(type: string): string {
  switch (type) {
    case 'i':
      return 'int';
    case 's':
      return 'string';
    case 'v':
      return 'value';
    case 'r':
      return 'variable';
    case 'l':
      return 'label';
    default:
      return type;
  }
}

function commandMarkdown(command: CommandDef): string {
  const parts: string[] = [];

  if (command.signatures?.length) {
    parts.push('```rathena\n' + command.signatures.slice(0, 4).join('\n') + '\n```');
  } else {
    parts.push('```rathena\n' + signatureLine(command) + '\n```');
  }

  parts.push(
    `Arity: ${command.minArgs}${command.maxArgs === null ? '+' : command.maxArgs === command.minArgs ? '' : `–${command.maxArgs}`}` +
      ` · signature \`${command.arg || '(none)'}\``
  );

  if (command.deprecated) {
    parts.push(`> ⚠ Deprecated since ${command.deprecated}.`);
  }
  if (command.documentation) {
    parts.push(command.documentation);
  }

  return parts.join('\n\n');
}

function itemMarkdown(id: number, aegisName: string, name: string): string {
  return `**Item ${id}** — ${name}\n\n\`${aegisName}\``;
}

documents.listen(connection);
connection.listen();
