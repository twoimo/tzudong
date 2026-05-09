import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const appRoot = resolve(import.meta.dir, '..');
const tempDirs: string[] = [];

const criticalDisplayUtilities = [
  ['lg:block', 'block'],
  ['lg:flex', 'flex'],
  ['lg:hidden', 'none'],
  ['lg:table-cell', 'table-cell'],
] as const;

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function escapeCssClass(className: string) {
  return className.replace(':', String.raw`\:`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('admin evaluation responsive CSS guard', () => {
  test('keeps desktop table display utilities in the generated app Tailwind CSS', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'tzudong-admin-css-'));
    tempDirs.push(workDir);

    const inputPath = join(workDir, 'input.css');
    const outputPath = join(workDir, 'output.css');
    writeFileSync(inputPath, '@tailwind utilities;\n');

    execFileSync(
      'node',
      [
        './node_modules/tailwindcss/lib/cli.js',
        '-i',
        inputPath,
        '-o',
        outputPath,
        '--config',
        './tailwind.config.ts',
      ],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
          BROWSERSLIST_IGNORE_OLD_DATA: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const css = readFileSync(outputPath, 'utf8');

    for (const [utility, displayValue] of criticalDisplayUtilities) {
      const escapedClass = escapeCssClass(utility);
      expect(css, `${utility} should be emitted`).toContain(`.${escapedClass}`);
      expect(css, `${utility} should set display: ${displayValue}`).toMatch(
        new RegExp(`${escapeRegExp(`.${escapedClass}`)}\\s*\\{[^}]*display:\\s*${displayValue}`),
      );
    }
  });
});
