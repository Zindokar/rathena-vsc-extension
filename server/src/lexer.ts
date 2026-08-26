/**
 * Lexer for the rAthena NPC scripting language.
 *
 * The language is line-and-tab oriented at the top level (NPC/shop/warp/monster
 * definitions are tab-separated records) but C-like inside `{ ... }` blocks.
 * Rather than running two separate scanners, this lexer emits `Tab` and
 * `Newline` tokens unconditionally and records the current brace depth on every
 * token. The parser then decides what is significant: at depth 0 tabs and
 * newlines are structural separators, inside a block they are plain whitespace.
 *
 * The lexer never throws. Anything it cannot classify becomes an `Unknown`
 * token so that a half-typed document still produces a usable token stream.
 */

export enum TokenKind {
  // Trivia and structure
  Newline = 'Newline',
  Tab = 'Tab',
  LineComment = 'LineComment',
  BlockComment = 'BlockComment',

  // Literals
  Number = 'Number',
  String = 'String',

  // Names
  Identifier = 'Identifier',
  Variable = 'Variable',

  // Symbols
  Operator = 'Operator',
  Punctuation = 'Punctuation',

  Unknown = 'Unknown',
  EOF = 'EOF'
}

/** Where a variable lives and how long it survives. */
export enum VarScope {
  /** `.@name` — local to the running script instance. Cleared when it ends. */
  ScopeLocal = 'scope',
  /** `.name` — attached to the NPC object, shared by everyone touching it. */
  Npc = 'npc',
  /** `'name` — attached to the instance (see `instance_create`). */
  Instance = 'instance',
  /** `@name` — temporary, attached to the character until logout. */
  CharTemp = 'char-temp',
  /** `name` — permanent, stored per character in SQL. */
  CharPerm = 'char-perm',
  /** `#name` — permanent, per account on this map-server group. */
  AccountLocal = 'account-local',
  /** `##name` — permanent, per account across the whole login-server. */
  AccountGlobal = 'account-global',
  /** `$name` — permanent, global to the server. */
  GlobalPerm = 'global-perm',
  /** `$@name` — temporary, global to the server. Cleared on restart. */
  GlobalTemp = 'global-temp'
}

export interface Token {
  kind: TokenKind;
  /** Raw source text of the token. */
  value: string;
  /** Absolute offset of the first character. */
  start: number;
  /** Absolute offset one past the last character. */
  end: number;
  /** Zero-based line, for LSP ranges. */
  line: number;
  /** Zero-based UTF-16 offset within the line. */
  character: number;
  /** Brace nesting depth at the moment this token was produced. */
  depth: number;
  /** True when this token is the first non-tab token on its line. */
  atLineStart: boolean;
  /** Only set on `Variable` tokens. */
  scope?: VarScope;
  /** Only set on `Variable` tokens: `true` when the name ends in `$`. */
  isString?: boolean;
  /** Only set on `Variable` tokens: the name without sigil or `$` suffix. */
  name?: string;
}

/** Multi-character operators, longest first so that `<<=` wins over `<<`. */
const OPERATORS = [
  '<<=',
  '>>=',
  '===',
  '!==',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '<<',
  '>>',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '~=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '&',
  '|',
  '^',
  '~',
  '?',
  ':'
];

const PUNCTUATION = new Set(['(', ')', '{', '}', '[', ']', ',', ';']);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

export interface LexResult {
  tokens: Token[];
  /** Offset of the first character of each line; used to map offsets to positions. */
  lineStarts: number[];
}

export function tokenize(text: string): LexResult {
  const tokens: Token[] = [];
  const lineStarts: number[] = [0];

  let pos = 0;
  let line = 0;
  let lineStart = 0;
  let depth = 0;
  let sawContentOnLine = false;

  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    extra?: Partial<Token>
  ): void => {
    const atLineStart = !sawContentOnLine;
    if (kind !== TokenKind.Tab && kind !== TokenKind.Newline) {
      sawContentOnLine = true;
    }
    tokens.push({
      kind,
      value: text.slice(start, end),
      start,
      end,
      line,
      character: start - lineStart,
      depth,
      atLineStart,
      ...extra
    });
  };

  while (pos < text.length) {
    const ch = text[pos];

    // ---- Newlines -------------------------------------------------------
    if (ch === '\r' || ch === '\n') {
      const start = pos;
      if (ch === '\r' && text[pos + 1] === '\n') {
        pos += 2;
      } else {
        pos += 1;
      }
      push(TokenKind.Newline, start, pos);
      line += 1;
      lineStart = pos;
      lineStarts.push(pos);
      sawContentOnLine = false;
      continue;
    }

    // ---- Tabs are structural at depth 0, whitespace elsewhere -----------
    if (ch === '\t') {
      const start = pos;
      while (text[pos] === '\t') {
        pos += 1;
      }
      push(TokenKind.Tab, start, pos);
      continue;
    }

    // ---- Insignificant whitespace ---------------------------------------
    if (ch === ' ' || ch === '\f' || ch === '\v') {
      pos += 1;
      continue;
    }

    // ---- Comments --------------------------------------------------------
    if (ch === '/' && text[pos + 1] === '/') {
      const start = pos;
      while (pos < text.length && text[pos] !== '\n' && text[pos] !== '\r') {
        pos += 1;
      }
      push(TokenKind.LineComment, start, pos);
      continue;
    }

    if (ch === '/' && text[pos + 1] === '*') {
      const start = pos;
      const startLine = line;
      const startLineStart = lineStart;
      pos += 2;
      while (pos < text.length && !(text[pos] === '*' && text[pos + 1] === '/')) {
        if (text[pos] === '\n') {
          line += 1;
          lineStart = pos + 1;
          lineStarts.push(pos + 1);
        }
        pos += 1;
      }
      // Unterminated block comments run to end of file rather than failing.
      if (pos < text.length) {
        pos += 2;
      }
      tokens.push({
        kind: TokenKind.BlockComment,
        value: text.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        character: start - startLineStart,
        depth,
        atLineStart: !sawContentOnLine
      });
      sawContentOnLine = true;
      continue;
    }

    // ---- Strings ---------------------------------------------------------
    if (ch === '"') {
      const start = pos;
      pos += 1;
      while (pos < text.length) {
        const c = text[pos];
        if (c === '\\') {
          pos += 2;
          continue;
        }
        if (c === '"') {
          pos += 1;
          break;
        }
        // An unterminated string stops at the newline so one bad quote does
        // not swallow the rest of the file.
        if (c === '\n' || c === '\r') {
          break;
        }
        pos += 1;
      }
      push(TokenKind.String, start, pos);
      continue;
    }

    // ---- Numbers ---------------------------------------------------------
    if (isDigit(ch)) {
      const start = pos;
      if (ch === '0' && (text[pos + 1] === 'x' || text[pos + 1] === 'X')) {
        pos += 2;
        while (pos < text.length && /[0-9a-fA-F]/.test(text[pos])) {
          pos += 1;
        }
      } else {
        while (pos < text.length && isDigit(text[pos])) {
          pos += 1;
        }
      }
      push(TokenKind.Number, start, pos);
      continue;
    }

    // ---- Variables with a scope sigil ------------------------------------
    const sigil = readSigil(text, pos);
    if (sigil) {
      const start = pos;
      pos += sigil.length;
      while (pos < text.length && isIdentPart(text[pos])) {
        pos += 1;
      }
      let isString = false;
      if (text[pos] === '$') {
        isString = true;
        pos += 1;
      }
      const raw = text.slice(start, pos);
      const name = raw.slice(sigil.length).replace(/\$$/, '');
      push(TokenKind.Variable, start, pos, {
        scope: sigil.scope,
        isString,
        name
      });
      continue;
    }

    // ---- Identifiers (commands, constants, labels, char-perm variables) ---
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < text.length && isIdentPart(text[pos])) {
        pos += 1;
      }
      let isString = false;
      if (text[pos] === '$') {
        isString = true;
        pos += 1;
      }
      push(TokenKind.Identifier, start, pos, {
        isString,
        name: text.slice(start, pos).replace(/\$$/, '')
      });
      continue;
    }

    // ---- Punctuation (tracks brace depth) --------------------------------
    if (PUNCTUATION.has(ch)) {
      const start = pos;
      pos += 1;
      if (ch === '{') {
        push(TokenKind.Punctuation, start, pos);
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth = Math.max(0, depth - 1);
        // Emit the closing brace at the *outer* depth so that a block's
        // opening and closing tokens are symmetric.
        push(TokenKind.Punctuation, start, pos);
        continue;
      }
      push(TokenKind.Punctuation, start, pos);
      continue;
    }

    // ---- Operators --------------------------------------------------------
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, pos));
    if (op) {
      const start = pos;
      pos += op.length;
      push(TokenKind.Operator, start, pos);
      continue;
    }

    // ---- Anything else ----------------------------------------------------
    const start = pos;
    pos += 1;
    push(TokenKind.Unknown, start, pos);
  }

  tokens.push({
    kind: TokenKind.EOF,
    value: '',
    start: pos,
    end: pos,
    line,
    character: pos - lineStart,
    depth,
    atLineStart: !sawContentOnLine
  });

  return { tokens, lineStarts };
}

interface Sigil {
  length: number;
  scope: VarScope;
}

/**
 * Matches a variable sigil at `pos`. Order matters: the two-character sigils
 * (`$@`, `##`, `.@`) must be tested before their single-character prefixes.
 *
 * A sigil only counts when followed by an identifier start, so that `.` in a
 * decimal context or a bare `@` in a comment is not mistaken for a variable.
 */
function readSigil(text: string, pos: number): Sigil | null {
  const two = text.slice(pos, pos + 2);
  const next2 = text[pos + 2];

  if (two === '$@' && next2 && isIdentStart(next2)) {
    return { length: 2, scope: VarScope.GlobalTemp };
  }
  if (two === '##' && next2 && isIdentStart(next2)) {
    return { length: 2, scope: VarScope.AccountGlobal };
  }
  if (two === '.@' && next2 && isIdentStart(next2)) {
    return { length: 2, scope: VarScope.ScopeLocal };
  }

  const one = text[pos];
  const next1 = text[pos + 1];
  if (!next1 || !isIdentStart(next1)) {
    return null;
  }
  switch (one) {
    case '$':
      return { length: 1, scope: VarScope.GlobalPerm };
    case '#':
      return { length: 1, scope: VarScope.AccountLocal };
    case '.':
      return { length: 1, scope: VarScope.Npc };
    case '@':
      return { length: 1, scope: VarScope.CharTemp };
    case "'":
      return { length: 1, scope: VarScope.Instance };
    default:
      return null;
  }
}

