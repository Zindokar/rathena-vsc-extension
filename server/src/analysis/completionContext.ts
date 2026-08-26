/**
 * Works out what the cursor is sitting in, so completion can offer the right
 * thing instead of dumping every command and constant into the list.
 *
 * Two very different shapes have to be recognised:
 *
 * - **Definition lines**, at brace depth 0, which are tab-separated records:
 *   `prontera,150,180,4<TAB>script<TAB>Name<TAB>100,{`. Field 0 is the map,
 *   field 1 the object type, field 2 the name and field 3 the sprite.
 * - **Statements**, inside a body, where we need the enclosing command and how
 *   many arguments precede the cursor. Both call forms have to work:
 *   `getitem 501,1;` without parentheses and `countitem(501)` with them.
 */

import { TokenKind, type Token } from '../lexer.js';

export type ContextKind =
  | 'header-map'
  | 'header-type'
  | 'header-sprite'
  | 'mapflag-name'
  | 'command-arg'
  | 'general';

export interface CompletionContext {
  kind: ContextKind;
  /** For `command-arg`: the command the cursor is an argument of. */
  command?: string;
  /** For `command-arg`: zero-based index of the argument being typed. */
  argIndex?: number;
  /** True when the cursor is inside a string literal. */
  insideString: boolean;
  /** Word already typed at the cursor, used to filter. */
  prefix: string;
}

/** Object types that take a sprite in the fourth field. */
const SPRITE_TYPES = new Set([
  'script',
  'shop',
  'cashshop',
  'itemshop',
  'pointshop',
  'marketshop',
  'barbershop'
]);

export function contextAt(text: string, offset: number, tokens: Token[]): CompletionContext {
  const insideString = isInsideString(tokens, offset);
  const prefix = wordPrefix(text, offset);
  const atTopLevel = braceDepthAt(tokens, offset) === 0;

  const header = headerContext(text, offset, atTopLevel);
  if (header) {
    return { ...header, insideString, prefix };
  }

  const call = callContext(tokens, offset);
  if (call) {
    return { kind: 'command-arg', ...call, insideString, prefix };
  }

  return { kind: 'general', insideString, prefix };
}

/** Brace nesting immediately before the cursor. */
function braceDepthAt(tokens: Token[], offset: number): number {
  let depth = 0;
  for (const token of tokens) {
    if (token.start >= offset) {
      break;
    }
    depth = token.depth;
    if (token.kind === TokenKind.Punctuation && token.value === '{') {
      depth += 1;
    }
  }
  return depth;
}

/**
 * Classifies a position on a top-level definition line.
 *
 * Detection is textual rather than token-based because the fields are raw
 * tab-delimited text — an NPC named `Healer#alb` is one field, not an
 * identifier followed by an account variable.
 */
function headerContext(
  text: string,
  offset: number,
  atTopLevel: boolean
): { kind: ContextKind } | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let lineEnd = text.indexOf('\n', offset);
  if (lineEnd < 0) {
    lineEnd = text.length;
  }
  const line = text.slice(lineStart, lineEnd);

  if (line.startsWith('//')) {
    return null;
  }

  // A definition line being typed has no tab yet. Outside any script body, a
  // bare word at the start of a line can only be the location field.
  if (!line.includes('\t')) {
    const typedSoFar = text.slice(lineStart, offset);
    if (atTopLevel && /^[A-Za-z_][A-Za-z0-9_@#.-]*(?:,-?\d*)*$/.test(typedSoFar)) {
      return { kind: 'header-map' };
    }
    return null;
  }

  // A definition line starts with a location field: `-`, `function`, or a map
  // name optionally followed by coordinates.
  if (!/^(?:-|function|[A-Za-z_][A-Za-z0-9_@#.-]*(?:,-?\d+)*)\t/.test(line)) {
    return null;
  }

  const before = text.slice(lineStart, offset);
  const fieldIndex = before.split('\t').length - 1;
  const fields = line.split('\t');
  const type = (fields[1] ?? '').trim().toLowerCase();

  if (fieldIndex === 0) {
    return { kind: 'header-map' };
  }
  if (fieldIndex === 1) {
    return { kind: 'header-type' };
  }
  if (type === 'mapflag' && fieldIndex === 2) {
    return { kind: 'mapflag-name' };
  }
  if (fieldIndex === 3 && (SPRITE_TYPES.has(type) || type.startsWith('duplicate'))) {
    return { kind: 'header-sprite' };
  }

  return null;
}

/**
 * Walks backwards from the cursor to find the enclosing command and the
 * argument index.
 *
 * Nesting is tracked so that the cursor in `getitem getarg(0),|1` is seen as
 * argument 1 of `getitem`, not as an argument of `getarg`.
 */
function callContext(tokens: Token[], offset: number): { command: string; argIndex: number } | null {
  const significant = tokens.filter(
    (token) =>
      token.kind !== TokenKind.LineComment &&
      token.kind !== TokenKind.BlockComment &&
      token.kind !== TokenKind.Tab &&
      token.kind !== TokenKind.Newline &&
      token.kind !== TokenKind.EOF &&
      token.start < offset
  );

  let depth = 0;
  let commas = 0;

  for (let i = significant.length - 1; i >= 0; i -= 1) {
    const token = significant[i];

    if (token.kind === TokenKind.Punctuation) {
      if (token.value === ')' || token.value === ']') {
        depth += 1;
        continue;
      }
      if (token.value === '(' || token.value === '[') {
        if (depth === 0) {
          // Parenthesised call: the name sits immediately before the paren.
          const name = significant[i - 1];
          if (name?.kind === TokenKind.Identifier) {
            return { command: name.name ?? name.value, argIndex: commas };
          }
          return null;
        }
        depth -= 1;
        continue;
      }
      if (depth > 0) {
        continue;
      }
      if (token.value === ',') {
        commas += 1;
        continue;
      }
      if (token.value === ';' || token.value === '{' || token.value === '}') {
        // Statement boundary: the command is the next identifier forward.
        return commandFrom(significant[i + 1], commas, offset);
      }
    }
  }

  // Reached the start of the document without a boundary.
  return commandFrom(
    significant.find((token) => token.kind === TokenKind.Identifier),
    commas,
    offset
  );
}

/**
 * Accepts a token as the enclosing command, unless the cursor is still inside
 * it — typing `ge` at the start of a statement means the user is choosing a
 * command, not filling in argument zero of a command called `ge`.
 */
function commandFrom(
  token: Token | undefined,
  commas: number,
  offset: number
): { command: string; argIndex: number } | null {
  if (!token || token.kind !== TokenKind.Identifier || token.depth < 1) {
    return null;
  }
  if (commas === 0 && token.end >= offset) {
    return null;
  }
  return { command: token.name ?? token.value, argIndex: commas };
}

function isInsideString(tokens: Token[], offset: number): boolean {
  return tokens.some(
    (token) => token.kind === TokenKind.String && token.start < offset && offset <= token.end
  );
}

/** The identifier fragment immediately before the cursor. */
function wordPrefix(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) {
    start -= 1;
  }
  return text.slice(start, offset);
}
