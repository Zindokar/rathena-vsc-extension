import { describe, expect, it } from 'vitest';

import { contextAt } from '../src/analysis/completionContext.js';
import { completionsFor } from '../src/analysis/completionProvider.js';
import { tokenize } from '../src/lexer.js';
import { makeDatabase } from './helpers/testDatabase.js';

const database = makeDatabase();

/** `|` marks the cursor; returns the labels offered there. */
function labelsAt(withCursor: string, documentLabels: string[] = []): string[] {
  const text = withCursor.replace('|', '');
  const offset = withCursor.indexOf('|');
  const context = contextAt(text, offset, tokenize(text).tokens);
  return completionsFor(context, database, documentLabels).map((item) => item.label);
}

function body(statements: string): string {
  return `-\tscript\tT\t-1,{\n\t${statements}`;
}

describe('argument-aware completion', () => {
  it('offers item IDs on the first argument of getitem', () => {
    const labels = labelsAt(body('getitem |'));
    expect(labels).toContain('501');
    expect(labels).not.toContain('Red_Potion');
  });

  it('offers AegisNames inside a string', () => {
    const labels = labelsAt(body('getitem "|'));
    expect(labels).toContain('Red_Potion');
    expect(labels).not.toContain('501');
  });

  it('filters by what has been typed', () => {
    const labels = labelsAt(body('getitem "Red|'));
    expect(labels).toContain('Red_Potion');
    expect(labels).not.toContain('Orange_Potion');
  });

  it('finds items by their display name too', () => {
    // "orange" only appears in the display name, not the AegisName casing.
    expect(labelsAt(body('getitem "orange|'))).toContain('Orange_Potion');
  });

  it('offers map names on the first argument of monster', () => {
    expect(labelsAt(body('monster "|'))).toContain('prt_fild00');
  });

  it('offers mob IDs on the fifth argument of monster', () => {
    const labels = labelsAt(body('monster "prt_fild00",0,0,"x",|'));
    expect(labels).toContain('1002');
    expect(labels).toContain('1039');
  });

  it('offers document labels for the event-label argument', () => {
    const labels = labelsAt(body('monster "prt_fild00",0,0,"x",1002,5,"|'), ['OnMyMobDead']);
    expect(labels).toContain('OnMyMobDead');
  });

  it('offers SC_ constants on sc_start', () => {
    const labels = labelsAt(body('sc_start |'));
    expect(labels).toContain('SC_INCREASEAGI');
    expect(labels).not.toContain('EF_HEAL2');
  });

  it('falls back to the general list on an argument with no semantics', () => {
    // Argument 1 of getitem is an amount; the generic command list applies.
    expect(labelsAt(body('getitem 501,|'))).toContain('mes');
  });
});

describe('definition-line completion', () => {
  it('offers maps in the location field', () => {
    expect(labelsAt('pron|')).toContain('prontera');
  });

  it('offers object types in the second field', () => {
    const labels = labelsAt('prontera,150,180,4\t|');
    expect(labels).toContain('script');
    expect(labels).toContain('mapflag');
  });

  it('offers sprites in the fourth field, with the invisible ones first', () => {
    const labels = labelsAt('prontera,150,180,4\tscript\tName\t|');
    expect(labels[0]).toBe('-1');
    expect(labels[1]).toBe('HIDDEN_NPC');
    expect(labels).toContain('KAFRA_01');
  });

  it('offers mapflags after the mapflag keyword', () => {
    const labels = labelsAt('prontera\tmapflag\t|');
    expect(labels).toContain('nomemo');
    expect(labels).not.toContain('script');
  });
});

describe('general completion', () => {
  it('offers commands while typing a statement', () => {
    expect(labelsAt(body('me|'))).toContain('mes');
  });

  it('holds constants back until two characters are typed', () => {
    expect(labelsAt(body('S|'))).not.toContain('SC_INCREASEAGI');
    expect(labelsAt(body('SC|'))).toContain('SC_INCREASEAGI');
  });
});
