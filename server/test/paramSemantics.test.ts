import { describe, expect, it } from 'vitest';

import { kindsAt, parseSignature, variantsFor } from '../src/analysis/paramSemantics.js';

describe('parseSignature', () => {
  it('splits a simple signature into positional parameters', () => {
    const params = parseSignature('getitem <item id>,<amount>{,<account ID>};');
    expect(params.map((p) => p.placeholder)).toEqual(['item id', 'amount', 'account ID']);
  });

  it('classifies the documented placeholders', () => {
    const params = parseSignature('getitem <item id>,<amount>;');
    expect(params[0].kind).toBe('item-id');
    expect(params[1].kind).toBe('unknown');
  });

  it('marks quoted parameters', () => {
    const params = parseSignature('getitem "<item name>",<amount>;');
    expect(params[0]).toMatchObject({ kind: 'item-name', quoted: true });
    expect(params[1].quoted).toBe(false);
  });

  it('handles the parenthesised function form', () => {
    const params = parseSignature('countitem(<item id>{,<accountID>})');
    expect(params[0].kind).toBe('item-id');
  });

  it('keeps positions correct across nested optional groups', () => {
    const params = parseSignature(
      'monster "<map name>",<x>,<y>,"<name to show>",<mob id>,<amount>{,"<event label>",<size>,<ai>};'
    );
    expect(params[0].kind).toBe('map-name');
    expect(params[4].kind).toBe('mob-id');
    expect(params[6].kind).toBe('event-label');
    expect(params[7].kind).toBe('size');
    expect(params[8].kind).toBe('ai');
  });

  it('recognises status and effect placeholders', () => {
    expect(parseSignature('sc_start <effect type>,<ticks>,<value 1>;')[0].kind).toBe('status');
    expect(parseSignature('specialeffect <effect number>;')[0].kind).toBe('effect');
  });

  it('recognises skill placeholders in both forms', () => {
    expect(parseSignature('skill <skill id>,<level>;')[0].kind).toBe('skill-id');
    expect(parseSignature('skill "<skill name>",<level>;')[0].kind).toBe('skill-name');
  });
});

describe('kindsAt', () => {
  const variants = variantsFor([
    'getitem <item id>,<amount>{,<account ID>};',
    'getitem "<item name>",<amount>{,<account ID>};'
  ]);

  it('prefers the numeric variant outside a string', () => {
    expect(kindsAt(variants, 0, false)).toEqual(['item-id']);
  });

  it('prefers the name variant inside a string', () => {
    expect(kindsAt(variants, 0, true)).toEqual(['item-name']);
  });

  it('returns nothing useful for an unclassified argument', () => {
    expect(kindsAt(variants, 1, false)).toEqual([]);
  });

  it('returns nothing past the end of every variant', () => {
    expect(kindsAt(variants, 9, false)).toEqual([]);
  });

  it('copes with a command that has no documentation', () => {
    expect(kindsAt(variantsFor(undefined), 0, false)).toEqual([]);
  });
});
