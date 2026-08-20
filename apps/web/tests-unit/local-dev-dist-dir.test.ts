import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { localDevDistDirName, resolveLocalDevDistDir } from '../scripts/local-dev-dist-dir.mjs';

describe('local dev dist dir', () => {
    test('binds the cache directory to the effective port', () => {
        expect(localDevDistDirName(18123)).toBe('.next-local-18123');
        expect(resolveLocalDevDistDir('/fixture/web', 18123)).toBe(
            path.join('/fixture/web', '.next-local-18123'),
        );
    });

    test('rejects invalid ports before building a cleanup path', () => {
        for (const port of [0, -1, 65536, 1.5, 'not-a-port']) {
            expect(() => localDevDistDirName(port)).toThrow('LOCAL_DEV_DIST_DIR_INVALID_PORT');
        }
    });
});
