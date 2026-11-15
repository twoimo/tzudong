import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const appDirectory = join(import.meta.dir, '..', '..', 'app');
const compiledOwners = new Map<string, Promise<string>>();

/** Preserve independent owner scans and stylesheet load order. A single combined
 * Tailwind compilation would let another entry accidentally supply missing rules. */
export async function compileResponsiveCss(entries: readonly string[]): Promise<string> {
  return (await Promise.all(entries.map((entry) => {
    let compiled = compiledOwners.get(entry);
    if (!compiled) {
      const from = join(appDirectory, entry);
      compiled = readFile(from, 'utf8').then(async (source) => {
        const result = await postcss([tailwind()]).process(source, { from });
        return result.css;
      });
      compiledOwners.set(entry, compiled);
    }
    return compiled;
  }))).join('\n');
}
