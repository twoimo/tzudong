import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const appRoot = resolve(import.meta.dir, '..');
const tempDirs: string[] = [];

const criticalDisplayUtilities = [
  ['md:block', 'block'],
  ['md:flex', 'flex'],
  ['md:hidden', 'none'],
  ['md:inline-flex', 'inline-flex'],
  ['lg:table-cell', 'table-cell'],
] as const;

const criticalAdminConsoleLayoutUtilities = [
  'md:m-0',
  'md:px-1.5',
  'md:w-14',
  'md:w-48',
  'lg:grid',
  'lg:place-items-center',
] as const;

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function escapeCssClass(className: string) {
  return className.replace(/[:.]/g, '\\$&');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('admin responsive CSS guard', () => {
  test('keeps desktop admin display and sidebar layout utilities in the generated app Tailwind CSS', () => {
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

    for (const utility of criticalAdminConsoleLayoutUtilities) {
      expect(css, `${utility} should be emitted`).toContain(`.${escapeCssClass(utility)}`);
    }
  }, 20_000);
});
