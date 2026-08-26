/**
 * Runs the ported map-server parser over a document and turns its output into
 * LSP diagnostics.
 *
 * A `.txt` file under `npc/` is not one script: it is a sequence of top-level
 * definition records, some of which carry a `{ ... }` body. `npc_parsesrcfile`
 * hands each body to `parse_script` separately, so a syntax error in one NPC
 * does not hide an error in the next. This module reproduces that: it splits
 * the file into script bodies and parses each one independently.
 */

import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver/node';

import type { ServerDatabase } from '../data/database.js';
import { TokenKind, tokenize, type Token } from '../lexer.js';
import { parseScriptBody, type ParserSymbols } from './mapServerParser.js';
import { formatRathenaError } from './rathenaReport.js';

const SOURCE = 'rathena (map-server)';

export interface ScriptBlock {
  /** Offset of the opening `{`. */
  start: number;
  /** Offset just past the matching `}`, or the end of file if unclosed. */
  end: number;
  /** Name from the definition line, for the diagnostic message. */
  name: string;
}

/**
 * Finds the `{ ... }` bodies in a document.
 *
 * Every brace that the lexer records at depth 0 opens a top-level body — only
 * `script`, `function script` and `duplicate` definitions have one, while
 * shops, warps, monster spawns and mapflags are single-line records.
 */
export function findScriptBlocks(text: string, tokens: Token[]): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== TokenKind.Punctuation || token.value !== '{' || token.depth !== 0) {
      continue;
    }

    let end = text.length;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const candidate = tokens[j];
      if (candidate.kind === TokenKind.Punctuation && candidate.value === '}' && candidate.depth === 0) {
        end = candidate.end;
        i = j;
        break;
      }
    }

    blocks.push({ start: token.start, end, name: nameOfDefinitionLine(text, token.start) });
  }

  return blocks;
}

/** Reads the NPC name out of the tab-separated definition line above a body. */
function nameOfDefinitionLine(text: string, braceOffset: number): string {
  const lineStart = text.lastIndexOf('\n', braceOffset) + 1;
  const line = text.slice(lineStart, braceOffset);
  const fields = line.split('\t').filter((field) => field.length > 0);
  // <location> <type> <name> <sprite>
  return fields[2]?.trim() || 'script';
}

/** Adapts the indexed server data to what the ported parser expects. */
export function symbolsFrom(database: ServerDatabase): ParserSymbols {
  return {
    buildinArg: (name) => database.command(name)?.arg,
    isConstant: (name) => database.isKnownConstant(name),
    isGlobalFunction: (name) => database.isGlobalFunction(name)
  };
}

/**
 * Produces at most one diagnostic per script body — matching the fact that
 * `disp_error_message` aborts the whole `parse_script` call via `longjmp`.
 */
export interface StrictResult {
  diagnostics: Diagnostic[];
  /** The full rAthena-style report for each failing NPC, for the output panel. */
  reports: string[];
}

export function strictCheck(text: string, database: ServerDatabase, fileName = 'script'): Diagnostic[] {
  return strictCheckDetailed(text, database, fileName).diagnostics;
}

/**
 * Produces at most one diagnostic per script body — matching the fact that
 * `disp_error_message` aborts the whole `parse_script` call via `longjmp`.
 *
 * Each diagnostic message carries the complete error block in the map-server's
 * own format, so hovering the squiggle shows what the server console would.
 */
export function strictCheckDetailed(
  text: string,
  database: ServerDatabase,
  fileName = 'script'
): StrictResult {
  if (database.commands.length === 0) {
    return { diagnostics: [], reports: [] }; // no symbol table yet
  }

  const { tokens } = tokenize(text);
  const symbols = symbolsFrom(database);
  const diagnostics: Diagnostic[] = [];
  const reports: string[] = [];

  for (const block of findScriptBlocks(text, tokens)) {
    const body = text.slice(0, block.end);
    const error = parseScriptBody(body, block.start, symbols);
    if (!error) {
      continue;
    }

    const report = formatRathenaError({
      source: text,
      file: fileName,
      offset: Math.min(error.offset, text.length),
      message: error.message
    });

    reports.push(report.text);
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: report.line, character: report.character },
        end: { line: report.line, character: report.character + 1 }
      },
      message: `${error.message}\n\nThe map-server would refuse to load '${block.name}'.\n\n${report.text}`,
      source: SOURCE,
      code: 'map-server-parse-error'
    });
  }

  return { diagnostics, reports };
}
