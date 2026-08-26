import { describe, expect, it } from 'vitest';

import { TokenKind, VarScope, tokenize, type Token } from '../src/lexer.js';

/** Tokens that carry meaning, i.e. everything except comments and whitespace. */
function significant(source: string): Token[] {
  return tokenize(source).tokens.filter(
    (t) =>
      t.kind !== TokenKind.Newline &&
      t.kind !== TokenKind.Tab &&
      t.kind !== TokenKind.LineComment &&
      t.kind !== TokenKind.BlockComment &&
      t.kind !== TokenKind.EOF
  );
}

describe('variable scopes', () => {
  const cases: [string, VarScope, boolean][] = [
    ['.@amount', VarScope.ScopeLocal, false],
    ['.@name$', VarScope.ScopeLocal, true],
    ['.npcvar', VarScope.Npc, false],
    ["'instance", VarScope.Instance, false],
    ['@temp', VarScope.CharTemp, false],
    ['#accountlocal', VarScope.AccountLocal, false],
    ['##accountglobal', VarScope.AccountGlobal, false],
    ['$global', VarScope.GlobalPerm, false],
    ['$@globaltemp', VarScope.GlobalTemp, false],
    ['$@names$', VarScope.GlobalTemp, true]
  ];

  it.each(cases)('classifies %s', (source, scope, isString) => {
    const [token] = significant(source);
    expect(token.kind).toBe(TokenKind.Variable);
    expect(token.scope).toBe(scope);
    expect(token.isString).toBe(isString);
    expect(token.value).toBe(source);
  });

  it('strips the sigil and the $ suffix from the name', () => {
    const [token] = significant('$@player_names$');
    expect(token.name).toBe('player_names');
  });

  it('does not mistake ## for # when both could match', () => {
    const [token] = significant('##CASHPOINTS');
    expect(token.scope).toBe(VarScope.AccountGlobal);
    expect(token.name).toBe('CASHPOINTS');
  });
});

describe('strings', () => {
  it('keeps colour codes inside the literal', () => {
    const [token] = significant('"^0055FFHeal^000000"');
    expect(token.kind).toBe(TokenKind.String);
    expect(token.value).toBe('"^0055FFHeal^000000"');
  });

  it('handles escaped quotes', () => {
    const [token] = significant('"say \\"hi\\" now"');
    expect(token.kind).toBe(TokenKind.String);
    expect(token.value).toBe('"say \\"hi\\" now"');
  });

  it('stops an unterminated string at the newline', () => {
    const tokens = significant('mes "oops\nend;');
    expect(tokens[1].kind).toBe(TokenKind.String);
    expect(tokens[1].value).toBe('"oops');
    // The next line still lexes normally.
    expect(tokens[2].value).toBe('end');
  });
});

describe('brace depth', () => {
  it('reports depth 0 for a top-level header and 1 inside the body', () => {
    const source = '-\tscript\tHealer\t-1,{\n\tend;\n}';
    const tokens = tokenize(source).tokens;

    const script = tokens.find((t) => t.value === 'script');
    expect(script?.depth).toBe(0);

    const end = tokens.find((t) => t.value === 'end');
    expect(end?.depth).toBe(1);

    const close = tokens.find((t) => t.value === '}');
    expect(close?.depth).toBe(0);
  });

  it('never goes negative on an unbalanced closing brace', () => {
    const tokens = tokenize('}}}').tokens;
    expect(tokens.every((t) => t.depth >= 0)).toBe(true);
  });
});

describe('tabs and line starts', () => {
  it('emits tabs as their own tokens so headers stay parseable', () => {
    const tokens = tokenize('prontera,150,180,4\tscript\tName\t100,{').tokens;
    const tabs = tokens.filter((t) => t.kind === TokenKind.Tab);
    expect(tabs).toHaveLength(3);
  });

  it('marks the first token on a line', () => {
    const tokens = tokenize('mes "a";\n\tnext;').tokens;
    const mes = tokens.find((t) => t.value === 'mes');
    const next = tokens.find((t) => t.value === 'next');
    expect(mes?.atLineStart).toBe(true);
    expect(next?.atLineStart).toBe(true);
  });
});

describe('comments', () => {
  it('reads a line comment to end of line only', () => {
    const tokens = tokenize('// hola\nend;').tokens;
    const comment = tokens.find((t) => t.kind === TokenKind.LineComment);
    expect(comment?.value).toBe('// hola');
  });

  it('tracks lines through a block comment', () => {
    const tokens = tokenize('/* a\nb\nc */\nend;').tokens;
    const end = tokens.find((t) => t.value === 'end');
    expect(end?.line).toBe(3);
  });

  it('does not run off the end on an unterminated block comment', () => {
    const tokens = tokenize('/* never closed').tokens;
    expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF);
  });
});

describe('numbers and operators', () => {
  it('lexes hexadecimal literals', () => {
    const [token] = significant('0xFF00');
    expect(token.kind).toBe(TokenKind.Number);
    expect(token.value).toBe('0xFF00');
  });

  it('prefers the longest operator', () => {
    const tokens = significant('.@a <<= 2;');
    expect(tokens[1].value).toBe('<<=');
  });

  it('lexes a realistic statement', () => {
    const tokens = significant('sc_start SC_INCREASEAGI,240000,10;');
    expect(tokens.map((t) => t.value)).toEqual([
      'sc_start',
      'SC_INCREASEAGI',
      ',',
      '240000',
      ',',
      '10',
      ';'
    ]);
  });
});

describe('positions', () => {
  it('reports zero-based line and character for LSP ranges', () => {
    const tokens = tokenize('mes "a";\nnext;').tokens;
    const next = tokens.find((t) => t.value === 'next');
    expect(next?.line).toBe(1);
    expect(next?.character).toBe(0);
  });

  it('handles CRLF line endings', () => {
    const tokens = tokenize('mes "a";\r\nnext;').tokens;
    const next = tokens.find((t) => t.value === 'next');
    expect(next?.line).toBe(1);
    expect(next?.character).toBe(0);
  });
});
