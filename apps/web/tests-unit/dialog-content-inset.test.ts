import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cn } from '../lib/utils';

describe('dialog content inset', () => {
    for (const path of ['components/ui/dialog.tsx', 'components/ui/alert-dialog.tsx']) {
        const source = readFileSync(join(import.meta.dir, '..', path), 'utf8');
        const contentClasses = source.match(/"(fixed left-\[50%\][^"]+)"/)?.[1] ?? '';

        test(`${path} leaves viewport gutters with the default width cap`, () => {
            expect(contentClasses.split(' ')).toContain('w-[calc(100vw-2rem)]');
            expect(contentClasses.split(' ')).toContain('max-w-lg');
            expect(contentClasses.split(' ')).not.toContain('w-full');
        });

        test(`${path} preserves callers that change only the width cap`, () => {
            const classes = cn(contentClasses, 'max-w-2xl').split(' ');
            expect(classes).toContain('w-[calc(100vw-2rem)]');
            expect(classes).toContain('max-w-2xl');
            expect(classes).not.toContain('max-w-lg');
            expect(classes).not.toContain('w-[min(32rem,calc(100vw-2rem))]');
        });
    }
});
