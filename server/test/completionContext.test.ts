import { describe, expect, it } from 'vitest';

import { contextAt } from '../src/analysis/completionContext.js';
import { tokenize } from '../src/lexer.js';

/** `|` marks the cursor. */
function ctx(withCursor: string) {
  const text = withCursor.replace('|', '');
  const offset = withCursor.indexOf('|');
  return contextAt(text, offset, tokenize(text).tokens);
}

/** Wraps statements in an NPC body so they sit at brace depth 1. */
function body(statements: string): string {
  return `-\tscript\tT\t-1,{\n\t${statements}`;
}

describe('command arguments', () => {
  it('finds argument 0 of a parenthesis-free call', () => {
    expect(ctx(body('getitem |'))).toMatchObject({ kind: 'command-arg', command: 'getitem', argIndex: 0 });
  });

  it('counts commas to find later arguments', () => {
    expect(ctx(body('getitem 501,|'))).toMatchObject({ command: 'getitem', argIndex: 1 });
    expect(ctx(body('monster "prt_fild00",0,0,"x",|'))).toMatchObject({ command: 'monster', argIndex: 4 });
  });

  it('handles the parenthesised call form', () => {
    expect(ctx(body('.@n = countitem(|'))).toMatchObject({ command: 'countitem', argIndex: 0 });
  });

  it('attributes nested calls to the outer command', () => {
    // The cursor is argument 1 of getitem, not an argument of getarg.
    expect(ctx(body('getitem getarg(0),|'))).toMatchObject({ command: 'getitem', argIndex: 1 });
  });

  it('does not treat the command name being typed as its own argument', () => {
    expect(ctx(body('ge|')).kind).toBe('general');
  });

  it('starts a fresh statement after a semicolon', () => {
    expect(ctx(body('mes "a";\n\tgetitem |'))).toMatchObject({ command: 'getitem', argIndex: 0 });
  });

  it('detects being inside a string literal', () => {
    expect(ctx(body('getitem "|')).insideString).toBe(true);
    expect(ctx(body('getitem |')).insideString).toBe(false);
  });

  it('captures the prefix typed so far', () => {
    expect(ctx(body('getitem "Red_|')).prefix).toBe('Red_');
  });
});

describe('definition lines', () => {
  it('offers maps in the location field, before any tab is typed', () => {
    expect(ctx('pro|').kind).toBe('header-map');
  });

  it('offers maps in the location field with coordinates', () => {
    expect(ctx('prontera,150,180,4|').kind).toBe('header-map');
  });

  it('recognises the object-type field', () => {
    expect(ctx('prontera,150,180,4\tscr|').kind).toBe('header-type');
  });

  it('recognises the sprite field of a script', () => {
    expect(ctx('prontera,150,180,4\tscript\tName\t|').kind).toBe('header-sprite');
  });

  it('recognises the sprite field of a shop', () => {
    expect(ctx('prontera,150,180,4\tshop\tName\t|').kind).toBe('header-sprite');
  });

  it('recognises the sprite field of a duplicate', () => {
    expect(ctx('prontera,150,180,4\tduplicate(Other)\tName\t|').kind).toBe('header-sprite');
  });

  it('recognises the mapflag name field', () => {
    expect(ctx('prontera\tmapflag\t|').kind).toBe('mapflag-name');
  });

  it('ignores comment lines', () => {
    expect(ctx('// prontera,150,180,4\tscript\t|').kind).not.toBe('header-sprite');
  });

  it('does not mistake a statement inside a body for a location field', () => {
    expect(ctx(body('mes|')).kind).toBe('general');
  });
});
