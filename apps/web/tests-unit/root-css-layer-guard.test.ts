import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function compileRootCss(): string {
  const workDir = mkdtempSync(join(tmpdir(), 'tzudong-root-css-layer-'));
  tempDirs.push(workDir);
  const outputPath = join(workDir, 'root.css');

  execFileSync(
    'node',
    [
      './node_modules/@tailwindcss/cli/dist/index.mjs',
      '-i',
      join(appRoot, 'app', 'globals.css'),
      '-o',
      outputPath,
      '--cwd',
      appRoot,
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

  return readFileSync(outputPath, 'utf8');
}

type RuleLocation = { found: boolean; layer: string | null };

/**
 * Reports the cascade layer enclosing the first rule whose prelude equals
 * `selector`. `layer === null` means the rule is unlayered, and an unlayered
 * declaration outranks every `@layer` block regardless of specificity — which is
 * exactly how the root element reset used to beat Tailwind's `text-xs` on buttons.
 */
function locateRule(css: string, selector: string): RuleLocation {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const target = selector.replace(/\s+/g, ' ').trim();
  const openBlocks: string[] = [];
  let buffer = '';

  for (const character of source) {
    if (character === '{') {
      const prelude = buffer.replace(/\s+/g, ' ').trim();
      buffer = '';
      if (prelude === target) {
        const enclosingLayer = [...openBlocks]
          .reverse()
          .find((entry) => entry.startsWith('@layer'));
        return {
          found: true,
          layer: enclosingLayer
            ? enclosingLayer.slice('@layer'.length).trim() || null
            : null,
        };
      }
      openBlocks.push(prelude);
      continue;
    }

    if (character === '}') {
      openBlocks.pop();
      buffer = '';
      continue;
    }

    if (character === ';' && openBlocks.length === 0) {
      buffer = '';
      continue;
    }

    buffer += character;
  }

  return { found: false, layer: null };
}

describe('root CSS cascade layer guard', () => {
  test('declares the Tailwind layer order up front', () => {
    const css = compileRootCss();

    expect(css).toMatch(/@layer\s+theme,\s*base,\s*components,\s*utilities\s*;/);

    const orderIndex = css.search(/@layer\s+theme,\s*base,\s*components,\s*utilities\s*;/);
    const baseIndex = css.search(/@layer\s+base\s*\{/);
    expect(baseIndex).toBeGreaterThan(orderIndex);
  }, 30_000);

  test('keeps the element font reset inside @layer base so utilities can win', () => {
    const css = compileRootCss();

    expect(locateRule(css, 'button, input, textarea, select')).toEqual({
      found: true,
      layer: 'base',
    });
    expect(locateRule(css, 'button')).toEqual({ found: true, layer: 'base' });
  }, 30_000);

  test('still detects unlayered rules, so the layer assertion cannot pass vacuously', () => {
    const css = compileRootCss();

    expect(locateRule(css, ':root')).toEqual({ found: true, layer: null });
  }, 30_000);
});
