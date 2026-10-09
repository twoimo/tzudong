import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseline = '65bf3a584e55a849bdf5f3e8dcf5cc2e739f1fbb';
const files = ['styles/light-root-tokens.css', 'app/app-globals.css'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const readTokens = (light, css) => {
  const parse = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*(\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%);/g)].map((match) => [match[1], match[2]]));
  const base = parse(light);
  return { light: base, dark: { ...base, ...parse(css.match(/\.dark\s*\{([^}]+)\}/)?.[1] ?? '') } };
};
const rgb = (hsl) => {
  const [h, s, l] = hsl.replaceAll('%', '').split(/\s+/).map(Number);
  const saturation = s / 100, lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((n) => { const k = (n + h / 30) % 12; return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); });
};
const luminance = (value) => rgb(value).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (fg, bg) => { const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };
const pairs = [['--foreground', '--background'], ['--card-foreground', '--card'], ['--muted-foreground', '--card'], ['--primary', '--card'], ['--primary-foreground', '--primary'], ['--popover-foreground', '--popover']];
const beforeSource = files.map((file) => execFileSync('git', ['show', `${baseline}:apps/web/${file}`], { encoding: 'utf8' }));
const afterSource = files.map((file) => readFileSync(file, 'utf8'));
const before = readTokens(...beforeSource), after = readTokens(...afterSource);
const observations = Object.keys(after).flatMap((mode) => pairs.map(([foreground, background]) => {
  const oldRatio = contrast(before[mode][foreground], before[mode][background]);
  const ratio = contrast(after[mode][foreground], after[mode][background]);
  return { mode, foreground, background, before: oldRatio, after: ratio, absoluteDifference: ratio - oldRatio, relativePercent: (ratio / oldRatio - 1) * 100, meetsNormalText4_5: ratio >= 4.5, sampleSize: 1, confidenceInterval: null, reason: 'deterministic WCAG luminance calculation, not a sample estimate' };
}));
const result = { kind: 'source-token-contrast', baseline, environment: { node: process.version, method: 'WCAG 2 relative luminance and contrast ratio' }, beforeHashes: beforeSource.map(sha), afterHashes: afterSource.map(sha), observations, allNormalTextRolesPass: observations.every((row) => row.meetsNormalText4_5), limitations: ['Token pairs only; rendered translucency, imagery, graphs, and focus outlines require separate browser inspection.', 'Higher contrast is not a measured improvement in user task time.'] };
mkdirSync('performance/ui-renewal-20261003', { recursive: true });
writeFileSync('performance/ui-renewal-20261003/token-contrast.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ kind: result.kind, roles: observations.length, allNormalTextRolesPass: result.allNormalTextRolesPass, minimumAfter: Math.min(...observations.map((row) => row.after)) }));
if (!result.allNormalTextRolesPass) process.exitCode = 1;
