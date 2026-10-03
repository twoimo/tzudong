import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const braces = require('../vendor/braces');

describe('private brace parser resource boundary', () => {
  test('retains ordinary path alternatives, ranges, escapes and AST consumption', () => {
    expect(braces.expand('src/{app,components}/**/*.{ts,tsx}')).toEqual([
      'src/app/**/*.ts','src/app/**/*.tsx','src/components/**/*.ts','src/components/**/*.tsx',
    ]);
    expect(braces.expand('part-{01..03}')).toEqual(['part-01','part-02','part-03']);
    expect(braces.expand('literal\\{x\\}')).toEqual(['literal{x}']);
    const ast = braces.parse('a/{b,c}/d');
    expect(braces.compile(ast)).toBe('a/(b|c)/d');
    expect(braces.expand(ast)).toEqual(['a/b/d','a/c/d']);
    expect(braces.stringify(ast)).toBe('a/{b,c}/d');
  });

  test('rejects deep brace and parentheses input before recursive walkers', () => {
    for (const input of ['{'.repeat(3500)+'a,b'+'}'.repeat(3500),'('.repeat(3500)+'x'+')'.repeat(3500)]) {
      for (const method of ['compile','expand','parse','stringify']) {
        expect(() => braces[method](input)).toThrow('BRACES_NESTING_LIMIT');
      }
    }
    expect(braces.compile('{'.repeat(100)+'a,b'+'}'.repeat(100))).toBeDefined();
  });

  test('bounds direct AST depth and rejects cycles without following parent references', () => {
    const cycle: {type:string;nodes:unknown[]}={type:'root',nodes:[]}; cycle.nodes.push(cycle);
    let nested: unknown={type:'text',value:'x'};
    for(let i=0;i<150;i++)nested={type:'root',nodes:[nested]};
    for(const ast of [cycle,nested]) {
      for(const method of ['compile','expand','stringify'])expect(()=>braces[method](ast)).toThrow('BRACES_NESTING_LIMIT');
    }
  });
});
