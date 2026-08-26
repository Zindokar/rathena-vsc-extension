import { describe, expect, it } from 'vitest';

import { parseScriptBody, type ParserSymbols } from '../src/analysis/mapServerParser.js';

/**
 * A miniature symbol table. The real one comes from the indexed server, but
 * the parser only ever asks these three questions, so a handful of entries is
 * enough to exercise every branch.
 */
const BUILDINS: Record<string, string> = {
  mes: 's*',
  next: '',
  close: '',
  end: '',
  set: 'rv?',
  getitem: 'vi?',
  percentheal: 'ii?',
  warp: 'sii?',
  goto: 'l',
  callfunc: 's*',
  callsub: 'l*',
  select: 's*',
  getarg: 'i?',
  return: '?',
  jobchange: 'i??'
};

const CONSTANTS = new Set(['SC_INCREASEAGI', 'EF_HEAL2', 'JOB_NOVICE', 'Job_SuperNovice', 'true', 'false']);
const GLOBAL_FUNCTIONS = new Set(['F_Navi', 'seven_qset-3', '171_worker_talk']);

const symbols: ParserSymbols = {
  buildinArg: (name) => BUILDINS[name.toLowerCase()],
  isConstant: (name) => [...CONSTANTS].some((c) => c.toLowerCase() === name.toLowerCase()),
  isGlobalFunction: (name) => [...GLOBAL_FUNCTIONS].some((f) => f.toLowerCase() === name.toLowerCase())
};

/** Wraps statements in a script body and returns the error message, if any. */
function check(body: string): string | null {
  const source = `{\n${body}\n}`;
  return parseScriptBody(source, 0, symbols)?.message ?? null;
}

describe('scripts the map-server accepts', () => {
  it('accepts a plain dialogue', () => {
    expect(check('mes "[Test]";\nmes "Hello";\nnext;\nclose;')).toBeNull();
  });

  it('accepts if / else if / else', () => {
    expect(check('if (Zeny > 1) close;\nelse if (Zeny > 0) next;\nelse end;')).toBeNull();
  });

  it('accepts a for loop', () => {
    expect(check('for (.@i = 0; .@i < 3; .@i++) {\nmes "x";\n}\nend;')).toBeNull();
  });

  it('accepts a while loop', () => {
    expect(check('.@i = 0;\nwhile (.@i < 3) {\n.@i++;\n}\nend;')).toBeNull();
  });

  it('accepts do-while', () => {
    expect(check('.@i = 0;\ndo {\n.@i++;\n} while (.@i < 3);\nend;')).toBeNull();
  });

  it('accepts switch with case and default', () => {
    expect(
      check('switch (select("A:B")) {\ncase 1:\nbreak;\ncase 2:\nbreak;\ndefault:\nbreak;\n}\nend;')
    ).toBeNull();
  });

  it('accepts labels and goto', () => {
    expect(check('goto L_Skip;\nL_Skip:\nend;')).toBeNull();
  });

  it('accepts a forward-declared local function', () => {
    expect(check('function SF_A;\nSF_A();\nend;\nfunction SF_A {\nreturn;\n}')).toBeNull();
  });

  it('accepts a call to a global function object', () => {
    expect(check('F_Navi("prontera",150,180);\nend;')).toBeNull();
  });

  it('accepts a global function whose name starts with a digit', () => {
    expect(check('171_worker_talk(1,"x");\nend;')).toBeNull();
  });

  it('accepts every variable scope', () => {
    expect(
      check(
        [
          '.@a = 1;',
          '.b = 2;',
          "'c = 3;",
          '@d = 4;',
          'e = 5;',
          '#f = 6;',
          '##g = 7;',
          '$h = 8;',
          '$@i = 9;',
          '.@j$ = "text";',
          'end;'
        ].join('\n')
      )
    ).toBeNull();
  });

  it('accepts compound assignment and shifts', () => {
    expect(check('.@a = 1;\n.@a += 2;\n.@a <<= 3;\n.@a++;\n--.@a;\nend;')).toBeNull();
  });

  it('accepts a ternary', () => {
    expect(check('.@a = (1 < 2) ? 3 : 4;\nend;')).toBeNull();
  });

  it('accepts array subscripts', () => {
    expect(check('.@a[0] = 1;\n.@b = .@a[0];\nend;')).toBeNull();
  });

  it('accepts constants in any letter case', () => {
    expect(check('.@a = job_novice;\n.@b = JOB_NOVICE;\nend;')).toBeNull();
  });

  it('accepts a lone dash as the next-line label in a menu', () => {
    expect(check('select("A");\ncallsub -, 1;\nend;')).not.toBe("need '('");
  });
});

describe('errors, reported with the map-server’s own wording', () => {
  it('if without parentheses', () => {
    expect(check('if .@a == 1 end;')).toBe("need '('");
  });

  it('switch without parentheses', () => {
    expect(check('switch 1 {\n}')).toBe("need '('");
  });

  it('case outside a switch', () => {
    expect(check('case 1:\nend;')).toBe("parse_syntax: unexpected 'case' ");
  });

  it('default outside a switch', () => {
    expect(check('default:\nend;')).toBe("parse_syntax: unexpected 'default'");
  });

  it('break outside a loop', () => {
    expect(check('break;')).toBe("parse_syntax: unexpected 'break'");
  });

  it('continue outside a loop', () => {
    expect(check('continue;')).toBe("parse_syntax: unexpected 'continue'");
  });

  it('duplicate case label', () => {
    expect(check('switch (1) {\ncase 1:\ncase 1:\n}')).toBe("parse_syntax: dup 'case'");
  });

  it('duplicate default', () => {
    expect(check('switch (1) {\ndefault:\ndefault:\n}')).toBe("parse_syntax: dup 'default'");
  });

  it('duplicate label', () => {
    expect(check('L_A:\nend;\nL_A:\nend;')).toBe('set_label: dup label L_A');
  });

  it('too few arguments', () => {
    expect(check('percentheal 100;')).toBe("parse_callfunc: not enough arguments, expected ','");
  });

  it('unknown command', () => {
    expect(check('mees "hi";')).toBe(
      'parse_line: expect command, missing function name or calling undeclared function'
    );
  });

  it('missing semicolon', () => {
    expect(check('mes "a"\nnext;')).toBe("parse_line: expected ';'");
  });

  it('ternary without a colon', () => {
    expect(check('.@a = 1 ? 2;')).toBe("parse_subexpr: expected ':'");
  });

  it('do without while', () => {
    expect(check('do {\n.@i++;\n}\nend;')).toBe("parse_syntax: expected 'while'");
  });

  it('unterminated string', () => {
    expect(check('mes "abc;\nend;')).toBe('parse_simpleexpr: unexpected newline @ string');
  });

  it('function declared but never defined', () => {
    expect(check('function SF_X;\nend;')).toContain('unresolved function references');
  });

  it('function keyword with no name', () => {
    expect(check('function ;')).toBe('parse_syntax:function: function name is missing or invalid');
  });

  it('function name followed by neither ; nor {', () => {
    expect(check('function SF_A end;')).toBe("expect ';' or '{' at function syntax");
  });

  it('assigning to a command name', () => {
    expect(check('mes = 1;')).toBe('Cannot modify a variable which has the same name as a function or label.');
  });

  it('script body that never closes', () => {
    expect(parseScriptBody('{\nmes "a";', 0, symbols)?.message).toBe('unexpected end of script');
  });

  it('body that does not start with a brace', () => {
    expect(parseScriptBody('mes "a";', 0, symbols)?.message).toBe("not found '{'");
  });
});

describe('error positions', () => {
  it('points at the offending character', () => {
    const source = '{\nmes "a"\nnext;\n}';
    const error = parseScriptBody(source, 0, symbols);
    // The parser reports the missing ';' where the next token begins.
    expect(source.slice(error!.offset, error!.offset + 4)).toBe('next');
  });
});
