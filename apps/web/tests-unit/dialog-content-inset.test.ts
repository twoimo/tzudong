import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8');

describe('dialog content inset', () => {
    test('keeps modal and alert widths inside the viewport gutter', () => {
        for (const path of ['components/ui/dialog.tsx', 'components/ui/alert-dialog.tsx']) {
            const file = source(path);
            expect(file).toContain('w-[min(32rem,calc(100vw-2rem))]');
            expect(file).toContain('max-w-lg');
            expect(file).not.toContain('grid w-full max-w-lg');
        }
    });
});
