import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(failures = 0) {
    const source = readFileSync(new URL('../lib/naver-map-loader.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const component = () => null;
    let calls = 0;
    const exports = {} as typeof import('../lib/naver-map-loader');
    vm.runInNewContext(compiled, { exports, require(name: string) {
        if (name !== '@/components/map/NaverMapView') throw new Error('UNEXPECTED_MODULE');
        calls++;
        if (calls <= failures) throw new Error('synthetic chunk failure');
        return { __esModule: true, default: component };
    } });
    return { loader: exports, component, calls: () => calls };
}

test('preload and lazy render share one module fetch', async () => {
    const f = fixture();
    f.loader.preloadNaverMap();
    const first = f.loader.loadNaverMap();
    expect(f.loader.loadNaverMap()).toBe(first);
    expect((await first).default).toBe(f.component);
    expect(f.calls()).toBe(1);
});

test('a failed speculative fetch does not poison a later render', async () => {
    const f = fixture(1);
    f.loader.preloadNaverMap();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await f.loader.loadNaverMap()).default).toBe(f.component);
    expect(f.calls()).toBe(2);
});
