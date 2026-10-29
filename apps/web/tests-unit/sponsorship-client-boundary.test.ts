import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const web = resolve(import.meta.dir, '..');
const analyzer = resolve(web, 'lib/sponsorship-disclosure.ts');
const state = resolve(web, 'lib/sponsorship-state.ts');
const components = ['SubmissionDetailView', 'MissingRestaurantForm', 'DbConflictResolutionPanel', 'AdminRestaurantModal', 'EvaluationDetailView'];

test('shared client state builds for the browser without the node crypto analyzer', async () => {
    const bundle = await Bun.build({ entrypoints: [state], target: 'browser', write: false });
    expect(bundle.success).toBe(true);
    expect(bundle.outputs.length).toBeGreaterThan(0);
    for (const output of bundle.outputs) {
        const code = await output.text();
        expect(code).not.toContain('node:crypto');
        expect(code).not.toContain('analyzeDisclosure');
        expect(code).not.toContain('createHash');
    }
});

test('the five client consumer runtime import graphs cannot reach the disclosure analyzer', () => {
    const transpiler = new Bun.Transpiler({ loader: 'tsx' });
    const seen = new Set<string>();
    const pending = components.map((name) => resolve(web, `components/admin/${name}.tsx`));
    const roots = new Set(pending);
    while (pending.length) {
        const file = pending.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        expect(file).not.toBe(analyzer);
        // scanImports uses emitted imports: type-only contracts do not become runtime dependencies.
        for (const imported of transpiler.scanImports(readFileSync(file, 'utf8'))) {
            if (roots.has(file)) expect(imported.path).not.toBe('node:crypto');
            const base = imported.path.startsWith('@/') ? resolve(web, imported.path.slice(2))
                : imported.path.startsWith('.') ? resolve(dirname(file), imported.path) : null;
            if (!base) continue; // Installed third-party code is not executed by this test.
            const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map((suffix) => base + suffix)]
                .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
            if (target && ['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(target))) pending.push(target);
        }
    }
    expect(seen.has(state)).toBe(true);
    expect(seen.size).toBeGreaterThan(components.length);
});
