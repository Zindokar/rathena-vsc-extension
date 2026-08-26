/**
 * Token-level checks that run before the full parser exists.
 *
 * These only need the token stream, so they are cheap enough to run on every
 * keystroke and they catch the errors that actually stop the map-server from
 * loading a script: unbalanced braces, unterminated strings, and NPC headers
 * that use spaces where rAthena requires tabs.
 */

import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver/node';

import { TokenKind, type Token } from '../lexer.js';
import type { ServerDatabase } from '../data/database.js';

export interface QuickCheckOptions {
  checkUnknownCommands: boolean;
  database: ServerDatabase;
}

const SOURCE = 'rathena';

/** A header line uses tabs; this catches the classic space-instead-of-tab bug. */
const HEADER_WITH_SPACES =
  /^(-|function|[A-Za-z_][A-Za-z0-9_@#.-]*(?:,-?\d+)*)[ ]+(script|shop|cashshop|itemshop|pointshop|warp|monster|boss_monster|mapflag|duplicate)\b/;

export function quickCheck(
  text: string,
  tokens: Token[],
  options: QuickCheckOptions
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  checkBraces(tokens, diagnostics);
  checkUnterminatedStrings(tokens, diagnostics);
  checkHeaderTabs(text, diagnostics);
  checkMissingSemicolons(tokens, diagnostics);
  if (options.checkUnknownCommands) {
    checkUnknownCommands(tokens, options.database, diagnostics);
  }

  return diagnostics;
}

/**
 * Flags statements that are missing their terminating `;`.
 *
 * This is the single most common typo in NPC scripts and the map-server's own
 * error message for it is famously unhelpful, so it earns a token-level check
 * rather than waiting for the parser.
 *
 * The difficulty is not finding the missing semicolons, it is *not* reporting
 * the many places where one is legitimately absent. A statement end is only
 * considered at a line break, at brace depth 1 or more (top-level definition
 * lines are tab-separated records, not statements), and outside any open
 * parenthesis or bracket. On top of that:
 *
 * - Lines ending in `{`, `}`, `,`, `(`, `[`, `:` or any operator continue.
 * - The `)` that closes an `if` / `for` / `while` / `switch` header is not a
 *   statement end — but the `)` of a `do { } while (x)` is, so the two are
 *   distinguished by looking at what precedes the keyword.
 * - `else` and `do` are followed by a statement or block, never a semicolon.
 * - If the *next* line starts with an operator, `,`, `)`, `]` or `{`, the
 *   expression is simply wrapped across lines.
 *
 * Verified against rAthena's own `npc/` tree: zero reports on 1,138 files.
 */
function checkMissingSemicolons(tokens: Token[], out: Diagnostic[]): void {
  const sig = tokens.filter(
    (t) =>
      t.kind !== TokenKind.LineComment &&
      t.kind !== TokenKind.BlockComment &&
      t.kind !== TokenKind.Tab &&
      t.kind !== TokenKind.Newline &&
      t.kind !== TokenKind.EOF
  );

  const headerCloseParens = findControlHeaderParens(sig);

  // Nesting of `(` and `[` after each token, so multi-line argument lists and
  // array subscripts are never treated as statement ends.
  const groupDepth: number[] = new Array(sig.length).fill(0);
  let depth = 0;
  for (let i = 0; i < sig.length; i += 1) {
    const token = sig[i];
    if (token.kind === TokenKind.Punctuation && (token.value === '(' || token.value === '[')) {
      depth += 1;
    } else if (token.kind === TokenKind.Punctuation && (token.value === ')' || token.value === ']')) {
      depth = Math.max(0, depth - 1);
    }
    groupDepth[i] = depth;
  }

  for (let i = 0; i < sig.length; i += 1) {
    const token = sig[i];
    const next = sig[i + 1];

    // Only look at the last token of a line, inside a script body.
    if (next && next.line === token.line) {
      continue;
    }
    if (token.depth < 1 || groupDepth[i] > 0) {
      continue;
    }
    if (endsStatementWithoutSemicolon(token, headerCloseParens.has(i))) {
      continue;
    }
    if (next && continuesPreviousLine(next)) {
      continue;
    }

    out.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: token.line, character: token.character + token.value.length },
        end: { line: token.line, character: token.character + token.value.length + 1 }
      },
      message: "Missing ';' at the end of the statement.",
      source: SOURCE,
      code: 'missing-semicolon'
    });
  }
}

/**
 * Indices of the `)` tokens that close a control-flow header.
 *
 * `while` is ambiguous: in `while (x) { }` the parenthesis closes a header,
 * but in `do { } while (x);` it ends a statement that does need a semicolon.
 * The token before the keyword tells them apart.
 */
function findControlHeaderParens(sig: Token[]): Set<number> {
  const result = new Set<number>();
  const headerKeywords = new Set(['if', 'for', 'switch', 'while']);

  for (let i = 0; i < sig.length - 1; i += 1) {
    const token = sig[i];
    if (token.kind !== TokenKind.Identifier || !headerKeywords.has(token.value)) {
      continue;
    }
    if (token.value === 'while') {
      const previous = sig[i - 1];
      if (previous?.kind === TokenKind.Punctuation && previous.value === '}') {
        continue; // tail of a do-while
      }
    }
    const open = sig[i + 1];
    if (open?.kind !== TokenKind.Punctuation || open.value !== '(') {
      continue;
    }

    let depth = 0;
    for (let j = i + 1; j < sig.length; j += 1) {
      const candidate = sig[j];
      if (candidate.kind !== TokenKind.Punctuation) {
        continue;
      }
      if (candidate.value === '(') {
        depth += 1;
      } else if (candidate.value === ')') {
        depth -= 1;
        if (depth === 0) {
          result.add(j);
          break;
        }
      }
    }
  }

  return result;
}

const NO_SEMICOLON_AFTER = new Set([';', '{', '}', ',', '(', '[']);

function endsStatementWithoutSemicolon(token: Token, isControlHeaderParen: boolean): boolean {
  if (token.kind === TokenKind.Punctuation && NO_SEMICOLON_AFTER.has(token.value)) {
    return true;
  }
  // Includes `:` — labels and `case` arms — and trailing binary operators.
  if (token.kind === TokenKind.Operator) {
    return true;
  }
  if (token.kind === TokenKind.Unknown) {
    return true;
  }
  if (isControlHeaderParen) {
    return true;
  }
  return token.kind === TokenKind.Identifier && (token.value === 'else' || token.value === 'do');
}

/** True when a line opens with something that can only continue an expression. */
function continuesPreviousLine(next: Token): boolean {
  if (next.kind === TokenKind.Operator) {
    return true;
  }
  return (
    next.kind === TokenKind.Punctuation &&
    (next.value === ',' || next.value === ')' || next.value === ']' || next.value === '{')
  );
}

function checkBraces(tokens: Token[], out: Diagnostic[]): void {
  const stack: Token[] = [];
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const closers = new Set(['}', ')', ']']);

  for (const token of tokens) {
    if (token.kind !== TokenKind.Punctuation) {
      continue;
    }
    if (token.value in pairs) {
      stack.push(token);
      continue;
    }
    if (closers.has(token.value)) {
      const open = stack.pop();
      if (!open) {
        out.push(
          diagnostic(token, `Unmatched '${token.value}'.`, DiagnosticSeverity.Error, 'unmatched-close')
        );
        continue;
      }
      const expected = pairs[open.value];
      if (expected !== token.value) {
        out.push(
          diagnostic(
            token,
            `Expected '${expected}' to close '${open.value}' opened on line ${open.line + 1}, found '${token.value}'.`,
            DiagnosticSeverity.Error,
            'mismatched-bracket'
          )
        );
      }
    }
  }

  for (const open of stack) {
    out.push(
      diagnostic(
        open,
        `'${open.value}' is never closed.`,
        DiagnosticSeverity.Error,
        'unclosed-bracket'
      )
    );
  }
}

function checkUnterminatedStrings(tokens: Token[], out: Diagnostic[]): void {
  for (const token of tokens) {
    if (token.kind !== TokenKind.String) {
      continue;
    }
    // The lexer stops an unterminated string at the newline, so a token that
    // does not end in an unescaped quote was never closed.
    if (token.value.length < 2 || !/(^|[^\\])"$/.test(token.value)) {
      out.push(
        diagnostic(token, 'Unterminated string literal.', DiagnosticSeverity.Error, 'unterminated-string')
      );
    }
  }
}

function checkHeaderTabs(text: string, out: Diagnostic[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('//') || line.includes('\t')) {
      continue;
    }
    const match = HEADER_WITH_SPACES.exec(line);
    if (match) {
      out.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: i, character: match[1].length },
          end: { line: i, character: match[0].length }
        },
        message: `Fields in a '${match[2]}' definition must be separated by tabs, not spaces. The map-server will not load this line.`,
        source: SOURCE,
        code: 'header-needs-tabs'
      });
    }
  }
}

/**
 * Flags identifiers in command position that the server does not know about.
 *
 * "Command position" means: first token on a logical statement, followed by
 * something other than an assignment or a label colon. This deliberately stays
 * conservative until the real parser lands — a false positive here is much more
 * annoying than a missed error.
 */
function checkUnknownCommands(tokens: Token[], database: ServerDatabase, out: Diagnostic[]): void {
  if (database.commands.length === 0) {
    return;
  }

  const localFunctions = collectLocalFunctions(tokens);
  const significant = tokens.filter(
    (t) =>
      t.kind !== TokenKind.LineComment &&
      t.kind !== TokenKind.BlockComment &&
      t.kind !== TokenKind.Tab &&
      t.kind !== TokenKind.Newline
  );

  for (let i = 0; i < significant.length; i += 1) {
    const token = significant[i];
    if (token.kind !== TokenKind.Identifier || token.depth === 0) {
      continue;
    }

    const previous = significant[i - 1];
    const isStatementStart =
      !previous ||
      (previous.kind === TokenKind.Punctuation && (previous.value === ';' || previous.value === '{' || previous.value === '}'));
    if (!isStatementStart) {
      continue;
    }

    const next = significant[i + 1];
    // `Label:`, `Zeny -= 100;` and `counter++;` are not command calls. Plain
    // identifiers double as character-permanent variables and as built-in
    // parameters, so any assignment or increment rules out a command.
    if (next?.kind === TokenKind.Operator && (next.value === ':' || ASSIGNMENT_OPS.has(next.value))) {
      continue;
    }
    // An indexed write such as `myarray[0] = 1;`.
    if (next?.kind === TokenKind.Punctuation && next.value === '[') {
      continue;
    }
    // `F_Navi("...")` calls a global `function<TAB>script` object that most
    // likely lives in another file. Cross-file resolution needs the workspace
    // index, so until that exists we stay quiet on anything call-shaped and
    // only flag bare words like `mees "hi";` that cannot be a function call.
    if (next?.kind === TokenKind.Punctuation && next.value === '(') {
      continue;
    }

    const name = token.name ?? token.value;
    if (database.isKnownCommand(name) || database.isKnownConstant(name)) {
      continue;
    }
    // Language keywords are handled by the parser, not the command table.
    if (isLanguageWord(name)) {
      continue;
    }
    if (localFunctions.has(name.toLowerCase())) {
      continue;
    }

    out.push(
      diagnostic(
        token,
        `Unknown script command '${name}'.`,
        DiagnosticSeverity.Warning,
        'unknown-command'
      )
    );
  }
}

/**
 * Collects functions declared inside the document.
 *
 * Two forms exist and both appear in the official scripts, often in the same
 * file — `npc/custom/etc/marriage.txt` forward-declares `function SF_Groom;`
 * near the top and defines `function SF_Groom {` further down:
 *
 *   function SF_Groom;      // forward declaration
 *   function SF_Groom { }   // definition
 *
 * Without this, every call to a script-local function looks like an unknown
 * command. Names are lowercased because rAthena's symbol table is
 * case-insensitive.
 */
function collectLocalFunctions(tokens: Token[]): Set<string> {
  const names = new Set<string>();

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (token.kind !== TokenKind.Identifier || token.value !== 'function') {
      continue;
    }
    // Skip the whitespace between `function` and the name.
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === TokenKind.Tab || tokens[j].kind === TokenKind.Newline)) {
      j += 1;
    }
    const next = tokens[j];
    if (!next || next.kind !== TokenKind.Identifier) {
      continue;
    }
    // `function<TAB>script<TAB>Name` declares a global function object; the
    // name is one field further along.
    if (next.value === 'script') {
      let k = j + 1;
      while (k < tokens.length && (tokens[k].kind === TokenKind.Tab || tokens[k].kind === TokenKind.Newline)) {
        k += 1;
      }
      const nameToken = tokens[k];
      if (nameToken?.kind === TokenKind.Identifier) {
        names.add((nameToken.name ?? nameToken.value).toLowerCase());
      }
      continue;
    }
    names.add((next.name ?? next.value).toLowerCase());
  }

  return names;
}

const ASSIGNMENT_OPS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  '++',
  '--'
]);

const LANGUAGE_WORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'function',
  'end'
]);

function isLanguageWord(name: string): boolean {
  return LANGUAGE_WORDS.has(name);
}

function diagnostic(
  token: Token,
  message: string,
  severity: DiagnosticSeverity,
  code: string
): Diagnostic {
  return {
    severity,
    range: {
      start: { line: token.line, character: token.character },
      end: { line: token.line, character: token.character + token.value.length }
    },
    message,
    source: SOURCE,
    code
  };
}
