#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'tests-unit/fixtures/ocr/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const reportLines = [
  '# OCR fixture manifest report',
  '',
  `- Generated: ${new Date().toISOString()}`,
  `- Manifest: ${path.relative(root, manifestPath)}`,
  `- Fixture count: ${manifest.fixtures.length}`,
  '',
  '| id | language | domain | redaction_status | committable | source |',
  '| --- | --- | --- | --- | --- | --- |',
];

let safeCount = 0;
let koreanRestaurantCount = 0;
for (const fixture of manifest.fixtures) {
  const goldPath = path.join(path.dirname(manifestPath), fixture.gold_path);
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const safe = ['redacted', 'no_sensitive_fields_detected'].includes(fixture.redaction_status)
    && fixture.redaction_status === gold.redaction_status;
  if (safe) safeCount += 1;
  if (fixture.language === 'ko' && String(fixture.domain).includes('restaurant')) koreanRestaurantCount += 1;
  reportLines.push(`| ${fixture.id} | ${fixture.language ?? ''} | ${fixture.domain ?? ''} | ${fixture.redaction_status} | ${fixture.committable} | ${fixture.source} |`);
}

reportLines.push(
  '',
  '## Promotion gate snapshot',
  '',
  `- Safe/redacted fixtures: ${safeCount}/${manifest.fixtures.length}`,
  `- Korean restaurant/order fixtures: ${koreanRestaurantCount}/5 minimum`,
  `- Production routing/prompt/preprocess promotion allowed: ${manifest.fixtures.length >= 10 && koreanRestaurantCount >= 5 && safeCount === manifest.fixtures.length ? 'yes' : 'no'}`,
  '',
);

const outDir = path.join(root, '.omx/reports/ocr-evaluation');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-manifest-report.md`);
await writeFile(outPath, `${reportLines.join('\n')}\n`);
console.log(outPath);
