/**
 * A faithful port of rAthena's own script parser.
 *
 * ## Why this exists
 *
 * Our other diagnostics are heuristics: they are error-tolerant, they run on
 * every keystroke, and they deliberately stay quiet when unsure. That is the
 * right behaviour for an editor, but it can only ever approximate the question
 * the user actually cares about — *will the map-server load this file?*
 *
 * This module answers that question exactly, by reimplementing the parser in
 * `src/map/script.cpp` (functions `parse_script` through `parse_syntax_close`,
 * roughly lines 866-2226) statement for statement, with the same error
 * messages and the same error positions.
 *
 * ## Why it is feasible
 *
 * Three properties of the original make the port tractable:
 *
 * 1. **The parser has no runtime dependencies.** It never touches `item_db`,
 *    `mob_db`, the map cache or any other database. Its only external input is
 *    `str_data`, the symbol table, which we already build from `BUILDIN_DEF`
 *    and `export_constant`.
 * 2. **It is small and self-contained** — about 1,755 lines, and a large part
 *    of that is bytecode emission (`add_scriptc`, `add_scriptl`, `add_scripti`)
 *    which we drop entirely because we only validate, never execute.
 * 3. **All 45 of its error messages are purely syntactic.**
 *
 * ## The one behavioural difference worth knowing
 *
 * `disp_error_message` ends in `longjmp`, so the real parser reports exactly
 * one error and abandons the script. We keep that faithfully *per NPC block* —
 * reporting a second error inside the same block would mean inventing recovery
 * behaviour the server does not have, and the message would be a guess. But
 * because the server parses each NPC separately, a file with three broken NPCs
 * legitimately produces three errors.
 *
 * ## What is deliberately not ported
 *
 * Bytecode emission, backpatching, and the recursive `parse_line()` calls on
 * *synthesised* strings such as `"goto __IF3_FIN;"`. Those parse text the
 * compiler generated itself, which is valid by construction and cannot produce
 * a user-facing error. They are also net-zero on the curly stack, so skipping
 * them does not change the parser's state machine.
 */

/** Symbol kinds from `script.cpp`, limited to the ones the parser branches on. */
export enum SymbolKind {
  /** Unregistered, or a plain variable. */
  Nop = 'NOP',
  /** A built-in command (`BUILDIN_DEF`). */
  Func = 'FUNC',
  /** A script-local function declared with `function <name>;`. */
  UserFunc = 'USERFUNC',
  /** A script-local function that has been given a body. */
  UserFuncPos = 'USERFUNC_POS',
  /** A constant from `export_constant`. */
  Int = 'INT',
  /** A label defined in this script. */
  Pos = 'POS'
}

/** Everything the parser needs to know about the outside world. */
export interface ParserSymbols {
  /** `BUILDIN_DEF` signature for a command, or undefined if not a command. */
  buildinArg(name: string): string | undefined;
  /** True for anything exported by `export_constant*`. */
  isConstant(name: string): boolean;
  /**
   * True for a global `function<TAB>script<TAB>name` object — rAthena's
   * `userfunc_db`. Without this, every cross-file call such as `F_Navi("...")`
   * would be reported as an undeclared function.
   */
  isGlobalFunction(name: string): boolean;
}

export interface MapServerError {
  /** The message rAthena itself would print. */
  message: string;
  /** Absolute offset into the document the parser was given. */
  offset: number;
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

const CURLY_NULL = 'NULL';
const CURLY_IF = 'IF';
const CURLY_SWITCH = 'SWITCH';
const CURLY_WHILE = 'WHILE';
const CURLY_FOR = 'FOR';
const CURLY_DO = 'DO';
const CURLY_USERFUNC = 'USERFUNC';
const CURLY_ARGLIST = 'ARGLIST';

type CurlyType =
  | typeof CURLY_NULL
  | typeof CURLY_IF
  | typeof CURLY_SWITCH
  | typeof CURLY_WHILE
  | typeof CURLY_FOR
  | typeof CURLY_DO
  | typeof CURLY_USERFUNC
  | typeof CURLY_ARGLIST;

const ARGLIST_UNDEFINED = 0;
const ARGLIST_NO_PAREN = 1;
const ARGLIST_PAREN = 2;

interface Curly {
  type: CurlyType;
  count: number;
  index: number;
  flag: number;
  caseLabels: Set<number>;
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isXDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-fA-F]/.test(ch);
}

function isAlpha(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z]/.test(ch);
}

function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-zA-Z]/.test(ch);
}

/**
 * The parser proper. One instance per script body, mirroring the fact that the
 * original keeps `syntax`, `str_data` and `parse_syntax_for_flag` in globals
 * that are reset for each `parse_script` call.
 */
class Parser {
  private curly: Curly[] = [];
  private curlyCount = 0;
  private syntaxIndex = 0;
  private forFlag = false;

  /** Per-script symbol table, keyed lowercase because `calc_hash` uses TOLOWER. */
  private local = new Map<string, SymbolKind>();
  /** Original spelling of each local symbol, so messages echo what was typed. */
  private localNames = new Map<string, string>();

  constructor(
    private readonly src: string,
    private readonly symbols: ParserSymbols
  ) {}

  // ---- character helpers -------------------------------------------------

  private at(p: number): string | undefined {
    return this.src[p];
  }

  private error(message: string, p: number): never {
    throw new ParseError(message, p);
  }

  /** Port of `skip_space`: whitespace, `//` line comments and `/* *\/` blocks. */
  private skipSpace(p: number): number {
    for (;;) {
      while (isSpace(this.at(p))) {
        p += 1;
      }
      if (this.at(p) === '/' && this.at(p + 1) === '/') {
        while (p < this.src.length && this.at(p) !== '\n') {
          p += 1;
        }
      } else if (this.at(p) === '/' && this.at(p + 1) === '*') {
        p += 2;
        for (;;) {
          if (p >= this.src.length) {
            // The original only warns here and returns.
            return p;
          }
          if (this.at(p) === '*' && this.at(p + 1) === '/') {
            p += 2;
            break;
          }
          p += 1;
        }
      } else {
        break;
      }
    }
    return p;
  }

  /**
   * Port of `skip_word`. A word is optional variable sigil, then alphanumerics
   * and underscores, then an optional `$` postfix.
   */
  private skipWord(p: number): number {
    switch (this.at(p)) {
      case '@':
        p += 1;
        break;
      case '#':
        p += this.at(p + 1) === '#' ? 2 : 1;
        break;
      case "'":
        p += 1;
        break;
      case '.':
        p += this.at(p + 1) === '@' ? 2 : 1;
        break;
      case '$':
        p += this.at(p + 1) === '@' ? 2 : 1;
        break;
      default:
        break;
    }
    while (isAlnum(this.at(p)) || this.at(p) === '_') {
      p += 1;
    }
    if (this.at(p) === '$') {
      p += 1;
    }
    return p;
  }

  /** Port of `add_word`: returns the word, erroring on an empty one. */
  private addWord(p: number): string {
    const end = this.skipWord(p);
    if (end === p) {
      this.error(
        'script:add_word: invalid word. A word consists of undercores and/or alphanumeric characters, and valid variable prefixes/postfixes.',
        p
      );
    }
    return this.src.slice(p, end);
  }

  /** Port of `is_number`. */
  private isNumber(p: number): boolean {
    if (this.at(p) === '-' || this.at(p) === '+') {
      p += 1;
    }
    let np = p;
    if (this.at(p) === '0' && this.at(p + 1) === 'x') {
      p += 2;
      np = p;
      while (isXDigit(this.at(np))) {
        np += 1;
      }
    } else {
      while (isDigit(this.at(np))) {
        np += 1;
      }
    }
    return p !== np && this.at(np) !== '_' && !isAlpha(this.at(np));
  }

  private matchesWord(p: number, word: string): boolean {
    const end = this.skipWord(p);
    return end - p === word.length && this.src.slice(p, end).toLowerCase() === word;
  }

  // ---- symbol table ------------------------------------------------------

  private kindOf(name: string): SymbolKind {
    const key = name.toLowerCase();
    const localKind = this.local.get(key);
    if (localKind !== undefined) {
      return localKind;
    }
    if (this.symbols.buildinArg(name) !== undefined) {
      return SymbolKind.Func;
    }
    if (this.symbols.isConstant(name)) {
      return SymbolKind.Int;
    }
    return SymbolKind.Nop;
  }

  private setKind(name: string, kind: SymbolKind): void {
    this.local.set(name.toLowerCase(), kind);
    this.localNames.set(name.toLowerCase(), name);
  }

  /** Port of `set_label`, keeping only the duplicate check. */
  private setLabel(name: string, p: number): void {
    if (this.local.get(name.toLowerCase()) === SymbolKind.Pos) {
      this.error(`set_label: dup label ${name}`, p);
    }
    this.setKind(name, SymbolKind.Pos);
  }

  // ---- curly stack -------------------------------------------------------

  private push(type: CurlyType, count = -1, index = -1, flag = 0): void {
    this.curly[this.curlyCount] = { type, count, index, flag, caseLabels: new Set() };
    this.curlyCount += 1;
  }

  // ---- expressions -------------------------------------------------------

  /** Port of `parse_callfunc`, including its argument-count check. */
  private parseCallfunc(p: number, requireParen: boolean, isCustom: boolean): number {
    const funcName = this.addWord(p);
    const kind = this.kindOf(funcName);

    /** Remaining signature characters, consumed as arguments are parsed. */
    let arg: string;

    if (kind === SymbolKind.Func) {
      arg = this.symbols.buildinArg(funcName) ?? '';
    } else if (kind === SymbolKind.UserFunc || kind === SymbolKind.UserFuncPos) {
      // Rewritten to `callsub`, whose signature is "l*".
      arg = 'l*';
      if (arg[0] !== '*') {
        arg = arg.slice(1); // the function itself counts as an argument
      }
    } else if (!isCustom && !this.symbols.isGlobalFunction(funcName)) {
      this.error('parse_line: expect command, missing function name or calling undeclared function', p);
    } else {
      // Rewritten to `callfunc`, whose signature is "s*".
      arg = '*';
    }

    p = this.skipWord(p);
    p = this.skipSpace(p);

    this.curly[this.curlyCount] = {
      type: CURLY_ARGLIST,
      count: 0,
      index: -1,
      flag: ARGLIST_UNDEFINED,
      caseLabels: new Set()
    };

    let p2: number;
    if (this.at(p) === ';') {
      this.curly[this.curlyCount].flag = ARGLIST_NO_PAREN;
    } else if (this.at(p) === '(' && this.at((p2 = this.skipSpace(p + 1))) === ')') {
      this.curly[this.curlyCount].flag = ARGLIST_PAREN;
      p = p2;
    } else {
      if (requireParen) {
        if (this.at(p) !== '(') {
          this.error("need '('", p);
        }
        p += 1;
        this.curly[this.curlyCount].flag = ARGLIST_PAREN;
      } else if (this.at(p) === '(') {
        this.curly[this.curlyCount].flag = ARGLIST_UNDEFINED;
      } else {
        this.curly[this.curlyCount].flag = ARGLIST_NO_PAREN;
      }
      this.curlyCount += 1;
      while (arg.length > 0) {
        p2 = this.parseSubexpr(p, -1);
        if (p === p2) {
          break; // not an argument
        }
        if (arg[0] !== '*') {
          arg = arg.slice(1);
        }
        p = this.skipSpace(p2);
        if (arg.length === 0 || this.at(p) !== ',') {
          break;
        }
        p += 1; // skip comma
      }
      this.curlyCount -= 1;
    }

    if (arg.length > 0 && arg[0] !== '?' && arg[0] !== '*') {
      this.error("parse_callfunc: not enough arguments, expected ','", p);
    }
    if (this.curly[this.curlyCount]?.flag === ARGLIST_PAREN) {
      if (this.at(p) !== ')') {
        this.error("parse_callfunc: expected ')' to close argument list", p);
      }
      p += 1;
    }
    return p;
  }

  /**
   * Port of `parse_variable`. Returns -1 when `p` is not an assignment, which
   * is how the original signals "not a variable" by returning nullptr.
   */
  private parseVariable(p: number): number {
    let type = '';
    let varStart = p;

    if (this.at(p) === '+' && this.at(p + 1) === '+') {
      type = '++pre';
    } else if (this.at(p) === '-' && this.at(p + 1) === '-') {
      type = '--pre';
    }
    if (type !== '') {
      varStart = p = this.skipSpace(p + 2);
    }

    p = this.skipWord(p);
    p = this.skipSpace(p);

    if (this.at(p) === '[') {
      // Walk the (possibly nested) subscript.
      let depth = 1;
      p += 1;
      while (p < this.src.length && depth > 0) {
        if (this.at(p) === '[') {
          depth += 1;
        } else if (this.at(p) === ']') {
          depth -= 1;
        }
        p += 1;
      }
      if (depth > 0) {
        this.error('Missing right expression or closing bracket for variable.', p);
      }
      p = this.skipSpace(p);
    }

    let skip = 2;
    if (type === '') {
      const a = this.at(p);
      const b = this.at(p + 1);
      const c = this.at(p + 2);
      if (a === '=' && b !== '=') {
        type = '=';
        skip = 1;
      } else if (b === '=' && (a === '+' || a === '-' || a === '^' || a === '|' || a === '&' || a === '*' || a === '/' || a === '%' || a === '~')) {
        type = `${a}=`;
      } else if (a === '+' && b === '+') {
        type = '++post';
      } else if (a === '-' && b === '-') {
        type = '--post';
      } else if (a === '<' && b === '<' && c === '=') {
        type = '<<=';
        skip = 3;
      } else if (a === '>' && b === '>' && c === '=') {
        type = '>>=';
        skip = 3;
      } else {
        return -1; // not an assignment
      }
    } else {
      skip = 0; // pre ++/--: nothing more to skip
    }

    if (skip > 0) {
      p = this.skipSpace(p + skip);
    }

    const word = this.addWord(varStart);
    const kind = this.kindOf(word);
    if (kind === SymbolKind.Func || kind === SymbolKind.UserFunc || kind === SymbolKind.UserFuncPos) {
      this.error('Cannot modify a variable which has the same name as a function or label.', p);
    }

    if (type === '++post' || type === '--post' || type === '++pre' || type === '--pre') {
      return p;
    }
    return this.parseSubexpr(p, -1);
  }

  /** Port of `parse_simpleexpr`. */
  private parseSimpleexpr(p: number): number {
    p = this.skipSpace(p);

    if (this.at(p) === ';' || this.at(p) === ',') {
      this.error('parse_simpleexpr: unexpected end of expression', p);
    }

    if (this.at(p) === '(') {
      const i = this.curlyCount - 1;
      if (i >= 0 && this.curly[i].type === CURLY_ARGLIST) {
        this.curly[i].count += 1;
      }
      p = this.parseSubexpr(p + 1, -1);
      p = this.skipSpace(p);
      if (
        i >= 0 &&
        this.curly[i]?.type === CURLY_ARGLIST &&
        this.curly[i].flag === ARGLIST_UNDEFINED &&
        --this.curly[i].count === 0
      ) {
        if (this.at(p) === ',') {
          this.curly[i].flag = ARGLIST_PAREN;
          return p;
        }
        this.curly[i].flag = ARGLIST_NO_PAREN;
      }
      if (this.at(p) !== ')') {
        this.error("parse_simpleexpr: unmatched ')'", p);
      }
      return p + 1;
    }

    if (this.isNumber(p)) {
      if (this.at(p) === '-' || this.at(p) === '+') {
        p += 1;
      }
      if (this.at(p) === '0' && this.at(p + 1) === 'x') {
        p += 2;
        while (isXDigit(this.at(p))) {
          p += 1;
        }
      } else {
        while (isDigit(this.at(p))) {
          p += 1;
        }
      }
      return p;
    }

    if (this.at(p) === '"') {
      p += 1;
      while (p < this.src.length && this.at(p) !== '"') {
        if (this.at(p) === '\\') {
          p += 2;
          continue;
        }
        if (this.at(p) === '\n') {
          this.error('parse_simpleexpr: unexpected newline @ string', p);
        }
        p += 1;
      }
      if (p >= this.src.length) {
        this.error('parse_simpleexpr: unexpected eof @ string', p);
      }
      return p + 1; // closing quote
    }

    // label, register, function, constant…
    if (this.skipWord(p) === p) {
      this.error('parse_simpleexpr: unexpected character', p);
    }

    const word = this.addWord(p);
    const kind = this.kindOf(word);
    if (kind === SymbolKind.Func || kind === SymbolKind.UserFunc || kind === SymbolKind.UserFuncPos) {
      return this.parseCallfunc(p, true, false);
    }
    if (this.symbols.isGlobalFunction(word)) {
      return this.parseCallfunc(p, true, true);
    }

    const assigned = this.parseVariable(p);
    if (assigned >= 0) {
      return assigned;
    }

    p = this.skipWord(p);
    if (this.at(p) === '[') {
      p = this.parseSubexpr(p + 1, -1);
      p = this.skipSpace(p);
      if (this.at(p) !== ']') {
        this.error("parse_simpleexpr: unmatched ']'", p);
      }
      p += 1;
    }
    return p;
  }

  /**
   * Port of `parse_subexpr`, including rAthena's exact precedence table.
   * The levels are, from loosest to tightest: `?:` 0, `||` 1, `&&` 2, `|` 3,
   * `^` 4, `&` 5, `== !=` 6, `< <= > >=` 7, `<< >>` 8, `+ -` 9, `* / %` 10,
   * and unary `- ! ~` 11.
   */
  private parseSubexpr(p: number, limit: number): number {
    p = this.skipSpace(p);

    if (this.at(p) === '-') {
      const tmp = this.skipSpace(p + 1);
      if (this.at(tmp) === ';' || this.at(tmp) === ',') {
        // A lone `-` is the "next line" label, used by shops and menus.
        return p + 1;
      }
    }

    if (
      (this.at(p) === '+' && this.at(p + 1) === '+') ||
      (this.at(p) === '-' && this.at(p + 1) === '-')
    ) {
      const result = this.parseVariable(p);
      p = result >= 0 ? result : p + 2;
    } else if (this.at(p) === '-' || this.at(p) === '!' || this.at(p) === '~') {
      p = this.parseSubexpr(p + 1, 11);
    } else {
      p = this.parseSimpleexpr(p);
    }
    p = this.skipSpace(p);

    for (;;) {
      const a = this.at(p);
      const b = this.at(p + 1);
      let opl = -1;
      let len = 1;
      let ternary = false;

      if (a === '?') {
        opl = 0;
        ternary = true;
      } else if (a === '+' && b !== '+') {
        opl = 9;
      } else if (a === '-' && b !== '-') {
        opl = 9;
      } else if (a === '*' || a === '/' || a === '%') {
        opl = 10;
      } else if (a === '&' && b === '&') {
        opl = 2;
        len = 2;
      } else if (a === '&') {
        opl = 5;
      } else if (a === '|' && b === '|') {
        opl = 1;
        len = 2;
      } else if (a === '|') {
        opl = 3;
      } else if (a === '^') {
        opl = 4;
      } else if (a === '=' && b === '=') {
        opl = 6;
        len = 2;
      } else if (a === '!' && b === '=') {
        opl = 6;
        len = 2;
      } else if (a === '>' && b === '>') {
        opl = 8;
        len = 2;
      } else if (a === '>' && b === '=') {
        opl = 7;
        len = 2;
      } else if (a === '>') {
        opl = 7;
      } else if (a === '<' && b === '<') {
        opl = 8;
        len = 2;
      } else if (a === '<' && b === '=') {
        opl = 7;
        len = 2;
      } else if (a === '<') {
        opl = 7;
      }

      if (opl <= limit) {
        break;
      }

      p += len;
      if (ternary) {
        p = this.parseSubexpr(p, -1);
        p = this.skipSpace(p);
        if (this.at(p) !== ':') {
          this.error("parse_subexpr: expected ':'", p);
        }
        p += 1;
        p = this.parseSubexpr(p, -1);
      } else {
        p = this.parseSubexpr(p, opl);
      }
      p = this.skipSpace(p);
    }

    return p;
  }

  /** Port of `parse_expr`. */
  private parseExpr(p: number): number {
    const ch = this.at(p);
    if (ch === ')' || ch === ';' || ch === ':' || ch === '[' || ch === ']' || ch === '}') {
      this.error('parse_expr: unexpected character', p);
    }
    return this.parseSubexpr(p, -1);
  }

  // ---- statements --------------------------------------------------------

  /** Port of `parse_line`. */
  private parseLine(p: number): number {
    p = this.skipSpace(p);
    if (this.at(p) === ';') {
      return this.parseSyntaxClose(p + 1);
    }
    if (this.at(p) === ')' && this.forFlag) {
      return p + 1;
    }

    if (this.at(p) === '{') {
      this.push(CURLY_NULL, -1, -1);
      return p + 1;
    }
    if (this.at(p) === '}') {
      return this.parseCurlyClose(p);
    }

    const p2 = this.parseSyntax(p);
    if (p2 >= 0) {
      return p2;
    }

    const assigned = this.parseVariable(p);
    if (assigned >= 0) {
      return this.parseSyntaxClose(assigned + 1);
    }

    p = this.parseCallfunc(p, false, false);
    p = this.skipSpace(p);

    if (this.forFlag) {
      if (this.at(p) !== ')') {
        this.error("parse_line: expected ')'", p);
      }
    } else if (this.at(p) !== ';') {
      this.error("parse_line: expected ';'", p);
    }

    return this.parseSyntaxClose(p + 1);
  }

  /** Port of `parse_curly_close`. */
  private parseCurlyClose(p: number): number {
    if (this.curlyCount <= 0) {
      this.error('parse_curly_close: unexpected string', p);
    }
    const top = this.curly[this.curlyCount - 1];
    if (top.type === CURLY_NULL) {
      this.curlyCount -= 1;
      return this.parseSyntaxClose(p + 1);
    }
    if (top.type === CURLY_SWITCH) {
      this.curlyCount -= 1;
      return this.parseSyntaxClose(p + 1);
    }
    this.error('parse_curly_close: unexpected string', p);
  }

  /**
   * Port of `parse_syntax`. Returns -1 when the word at `p` is not a syntax
   * keyword, mirroring the original's nullptr.
   */
  private parseSyntax(p: number): number {
    const p2 = this.skipWord(p);
    const first = this.at(p);

    switch (first) {
      case 'b':
      case 'B':
        if (this.matchesWord(p, 'break')) {
          let pos = this.curlyCount - 1;
          while (pos >= 0) {
            const t = this.curly[pos].type;
            if (t === CURLY_DO || t === CURLY_FOR || t === CURLY_WHILE || t === CURLY_SWITCH) {
              break;
            }
            pos -= 1;
          }
          if (pos < 0) {
            this.error("parse_syntax: unexpected 'break'", p);
          }
          p = this.skipSpace(p2);
          if (this.at(p) !== ';') {
            this.error("parse_syntax: expected ';'", p);
          }
          return this.parseSyntaxClose(p + 1);
        }
        break;

      case 'c':
      case 'C':
        if (this.matchesWord(p, 'case')) {
          const pos = this.curlyCount - 1;
          if (pos < 0 || this.curly[pos].type !== CURLY_SWITCH) {
            this.error("parse_syntax: unexpected 'case' ", p);
          }
          let value: number;
          p = this.skipSpace(p2);
          if (p === p2) {
            this.error("parse_syntax: expected a space ' '", p);
          }
          if (this.isNumber(p)) {
            const start = p;
            if ((this.at(p) === '-' || this.at(p) === '+') && isDigit(this.at(p + 1))) {
              p += 1;
            }
            const wordEnd = this.skipWord(p);
            const text = this.src.slice(start, wordEnd);
            value = Number.parseInt(text, text.includes('0x') ? 16 : 10);
            if (Number.isNaN(value)) {
              this.error("parse_syntax: 'case' label is not an integer", start);
            }
            p = wordEnd;
          } else {
            const wordEnd = this.skipWord(p);
            const name = this.src.slice(p, wordEnd);
            if (!this.symbols.isConstant(name)) {
              this.error("parse_syntax: 'case' label is not an integer", p);
            }
            // Constant values are C++ enums with no textual form, so the
            // duplicate check below can only use the name.
            value = Number.NaN;
            this.curly[pos].caseLabels.add(name.toLowerCase() as unknown as number);
            p = wordEnd;
          }
          p = this.skipSpace(p);
          if (this.at(p) !== ':') {
            this.error("parse_syntax: expect ':'", p);
          }
          if (!Number.isNaN(value)) {
            if (this.curly[pos].caseLabels.has(value)) {
              this.error("parse_syntax: dup 'case'", p);
            }
            this.curly[pos].caseLabels.add(value);
          }
          this.curly[pos].count += 1;
          return p + 1;
        }
        if (this.matchesWord(p, 'continue')) {
          let pos = this.curlyCount - 1;
          while (pos >= 0) {
            const t = this.curly[pos].type;
            if (t === CURLY_DO || t === CURLY_FOR || t === CURLY_WHILE) {
              break;
            }
            pos -= 1;
          }
          if (pos < 0) {
            this.error("parse_syntax: unexpected 'continue'", p);
          }
          p = this.skipSpace(p2);
          if (this.at(p) !== ';') {
            this.error("parse_syntax: expected ';'", p);
          }
          return this.parseSyntaxClose(p + 1);
        }
        break;

      case 'd':
      case 'D':
        if (this.matchesWord(p, 'default')) {
          const pos = this.curlyCount - 1;
          if (pos < 0 || this.curly[pos].type !== CURLY_SWITCH) {
            this.error("parse_syntax: unexpected 'default'", p);
          }
          if (this.curly[pos].flag) {
            this.error("parse_syntax: dup 'default'", p);
          }
          p = this.skipSpace(p2);
          if (this.at(p) !== ':') {
            this.error("parse_syntax: expected ':'", p);
          }
          this.curly[pos].flag = 1;
          this.curly[pos].count += 1;
          return p + 1;
        }
        if (this.matchesWord(p, 'do')) {
          p = this.skipSpace(p2);
          this.push(CURLY_DO, 1, this.syntaxIndex++, 0);
          return p;
        }
        break;

      case 'f':
      case 'F':
        if (this.matchesWord(p, 'for')) {
          this.push(CURLY_FOR, 1, this.syntaxIndex++, 0);
          p = this.skipSpace(p2);
          if (this.at(p) !== '(') {
            this.error("parse_syntax: expected '('", p);
          }
          p += 1;

          // initialiser
          this.push(CURLY_NULL);
          p = this.parseLine(p);
          this.curlyCount -= 1;

          p = this.skipSpace(p);
          if (this.at(p) !== ';') {
            p = this.parseExpr(p);
            p = this.skipSpace(p);
          }
          if (this.at(p) !== ';') {
            this.error("parse_syntax: expected ';'", p);
          }
          p += 1;

          // increment; a trailing `)` closes it instead of a `;`
          this.forFlag = true;
          this.push(CURLY_NULL);
          p = this.parseLine(p);
          this.curlyCount -= 1;
          this.forFlag = false;

          return p;
        }
        if (this.matchesWord(p, 'function')) {
          const funcNameStart = this.skipSpace(p2);
          p = this.skipWord(funcNameStart);
          if (p === funcNameStart) {
            this.error('parse_syntax:function: function name is missing or invalid', p);
          }
          const name = this.src.slice(funcNameStart, p);
          const after = this.skipSpace(p);

          if (this.at(after) === ';') {
            // Forward declaration: `function <name>;`
            const kind = this.kindOf(name);
            if (kind === SymbolKind.Nop) {
              this.setKind(name, SymbolKind.UserFunc);
            } else if (kind !== SymbolKind.UserFunc) {
              this.error('parse_syntax:function: function name is invalid', funcNameStart);
            }
            return this.parseSyntaxClose(after + 1);
          }
          if (this.at(after) === '{') {
            this.push(CURLY_USERFUNC, 1, this.syntaxIndex++, 0);
            const kind = this.kindOf(name);
            if (kind === SymbolKind.Nop || kind === SymbolKind.UserFunc) {
              this.setKind(name, SymbolKind.UserFuncPos);
            } else {
              this.error('parse_syntax:function: function name is invalid', funcNameStart);
            }
            return this.skipSpace(p);
          }
          this.error("expect ';' or '{' at function syntax", after);
        }
        break;

      case 'i':
      case 'I':
        if (this.matchesWord(p, 'if')) {
          p = this.skipSpace(p2);
          if (this.at(p) !== '(') {
            this.error("need '('", p);
          }
          this.push(CURLY_IF, 1, this.syntaxIndex++, 0);
          p = this.parseExpr(p);
          return this.skipSpace(p);
        }
        break;

      case 's':
      case 'S':
        if (this.matchesWord(p, 'switch')) {
          p = this.skipSpace(p2);
          if (this.at(p) !== '(') {
            this.error("need '('", p);
          }
          this.push(CURLY_SWITCH, 1, this.syntaxIndex++, 0);
          p = this.parseExpr(p);
          p = this.skipSpace(p);
          if (this.at(p) !== '{') {
            this.error("parse_syntax: expected '{'", p);
          }
          return p + 1;
        }
        break;

      case 'w':
      case 'W':
        if (this.matchesWord(p, 'while')) {
          p = this.skipSpace(p2);
          if (this.at(p) !== '(') {
            this.error("need '('", p);
          }
          this.push(CURLY_WHILE, 1, this.syntaxIndex++, 0);
          p = this.parseExpr(p);
          return this.skipSpace(p);
        }
        break;

      default:
        break;
    }

    return -1;
  }

  /** Port of `parse_syntax_close`. */
  private parseSyntaxClose(p: number): number {
    let again = true;
    while (again) {
      const result = this.parseSyntaxCloseSub(p);
      p = result.p;
      again = result.flag;
    }
    return p;
  }

  /** Port of `parse_syntax_close_sub`. */
  private parseSyntaxCloseSub(p: number): { p: number; flag: boolean } {
    const pos = this.curlyCount - 1;
    if (this.curlyCount <= 0) {
      return { p, flag: false };
    }

    const top = this.curly[pos];

    if (top.type === CURLY_IF) {
      const bp = p;
      top.count += 1;
      p = this.skipSpace(p);
      if (!top.flag && this.matchesWord(p, 'else')) {
        const afterElse = this.skipSpace(this.skipWord(p));
        if (this.matchesWord(afterElse, 'if')) {
          p = this.skipSpace(this.skipWord(afterElse));
          if (this.at(p) !== '(') {
            this.error("need '('", p);
          }
          p = this.parseExpr(p);
          p = this.skipSpace(p);
          return { p, flag: false };
        }
        // plain `else`
        top.flag = 1;
        return { p: afterElse, flag: false };
      }
      this.curlyCount -= 1;
      // Without an `else`, the position must not move: the caller has not
      // consumed anything yet.
      return { p: top.flag === 1 ? bp : p, flag: true };
    }

    if (top.type === CURLY_DO) {
      p = this.skipSpace(p);
      if (!this.matchesWord(p, 'while')) {
        this.error("parse_syntax: expected 'while'", p);
      }
      p = this.skipSpace(this.skipWord(p));
      if (this.at(p) !== '(') {
        this.error("need '('", p);
      }
      p = this.parseExpr(p);
      p = this.skipSpace(p);
      if (this.at(p) !== ';') {
        this.error("parse_syntax: expected ';'", p);
      }
      p += 1;
      this.curlyCount -= 1;
      return { p, flag: true };
    }

    if (top.type === CURLY_FOR || top.type === CURLY_WHILE || top.type === CURLY_USERFUNC) {
      this.curlyCount -= 1;
      return { p, flag: true };
    }

    return { p, flag: false };
  }

  // ---- entry point -------------------------------------------------------

  /**
   * Port of the `parse_script` main loop. `p` must point at the opening `{`
   * of the script body.
   */
  parse(p: number): void {
    if (this.at(p) !== '{') {
      this.error("not found '{'", p);
    }
    p = this.skipSpace(p + 1);
    if (this.at(p) === '}') {
      return; // empty script
    }

    while (this.curlyCount !== 0 || this.at(p) !== '}') {
      if (p >= this.src.length) {
        this.error('unexpected end of script', p);
      }

      // Labels get special handling before anything else, but `default:`
      // belongs to the switch statement.
      const tmpp = this.skipSpace(this.skipWord(p));
      if (this.at(tmpp) === ':' && !(this.matchesWord(p, 'default') && this.skipWord(p) === tmpp)) {
        const name = this.addWord(p);
        this.setLabel(name, p);
        p = this.skipSpace(tmpp + 1);
        continue;
      }

      const before = p;
      p = this.parseLine(p);
      p = this.skipSpace(p);
      if (p <= before) {
        // Defensive: the original cannot loop forever because every branch
        // consumes input, but a porting slip must not hang the editor.
        this.error('parse_line: expected ;', before);
      }
    }

    for (const [key, kind] of this.local) {
      if (kind === SymbolKind.UserFunc) {
        const name = this.localNames.get(key) ?? key;
        this.error(
          `parse_script: unresolved function references (function '${name}' declared but not defined)`,
          p
        );
      }
    }
  }
}

/** Runs the ported parser over one script body starting at the `{`. */
export function parseScriptBody(
  source: string,
  bodyStart: number,
  symbols: ParserSymbols
): MapServerError | null {
  const parser = new Parser(source, symbols);
  try {
    parser.parse(bodyStart);
    return null;
  } catch (error) {
    if (error instanceof ParseError) {
      return { message: error.message, offset: error.offset };
    }
    if (error instanceof RangeError) {
      // Runaway recursion on pathological input; report rather than crash.
      return { message: 'parse_script: expression nested too deeply', offset: bodyStart };
    }
    throw error;
  }
}
