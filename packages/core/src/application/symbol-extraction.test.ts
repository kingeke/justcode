import { describe, expect, it } from 'vitest';

import {
  extractSymbolBlock,
  listFileSymbols,
} from '@core/application/symbol-extraction';

describe('extractSymbolBlock', () => {
  it('locates a symbol declaration and captures its braced body', () => {
    const block = extractSymbolBlock(
      ['function a() {}', 'function target(x) {', '  return x + 1;', '}'].join(
        '\n'
      ),
      'target'
    );

    expect(block).toEqual({
      startLine: 2,
      lines: ['function target(x) {', '  return x + 1;', '}'],
    });
  });

  it('captures a method body inside a class with correct line numbers', () => {
    const block = extractSymbolBlock(
      [
        'export class Repo {',
        '  async findOne(id) {',
        '    return id;',
        '  }',
        '',
        '  async findMany(ids) {',
        '    return ids.map(toRow);',
        '  }',
        '}',
      ].join('\n'),
      'findMany'
    );

    expect(block).toEqual({
      startLine: 6,
      lines: ['  async findMany(ids) {', '    return ids.map(toRow);', '  }'],
    });
  });

  it('captures a body-less declaration up to its terminating semicolon', () => {
    const block = extractSymbolBlock(
      ['const a = 1;', 'type Boq = { id: string };', 'const b = 2;'].join('\n'),
      'Boq'
    );

    expect(block).toEqual({
      startLine: 2,
      lines: ['type Boq = { id: string };'],
    });
  });

  it('returns undefined when the symbol is not declared', () => {
    expect(extractSymbolBlock('const a = 1;', 'missing')).toBeUndefined();
  });

  it('ignores call sites and matches the definition', () => {
    const block = extractSymbolBlock(
      [
        'function caller() {',
        '  return target();',
        '}',
        'function target() {',
        '  return 1;',
        '}',
      ].join('\n'),
      'target'
    );

    // The call site `return target()` is mid-line, so the anchored member
    // pattern skips it and the actual definition (line 4) is captured.
    expect(block?.startLine).toBe(4);
  });
});

describe('listFileSymbols', () => {
  it('lists declared symbols in source order without duplicates', () => {
    const source = [
      'export function alpha() {}',
      'export const beta = () => {};',
      'class Gamma {',
      '  delta() {}',
      '  delta() {}', // overload-ish duplicate name
      '}',
      'type Epsilon = string;',
      'interface Zeta {}',
    ].join('\n');

    expect(listFileSymbols(source)).toEqual([
      'alpha',
      'beta',
      'Gamma',
      'delta',
      'Epsilon',
      'Zeta',
    ]);
  });

  it('does not list control-flow keywords as symbols', () => {
    const source = [
      'function run() {',
      '  if (x) {',
      '    for (let i = 0; i < 3; i++) {}',
      '  }',
      '  while (y) {}',
      '}',
    ].join('\n');

    expect(listFileSymbols(source)).toEqual(['run']);
  });
});
