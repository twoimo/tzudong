// Local SSR render benchmark; it does not establish browser or production latency.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardDataTable } from '../../components/admin/DashboardDataTable';
import { cn } from '../../lib/utils';

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(directory, 'frozen-before/AdminConsoleOverview.tsx.txt');
const source = readFileSync(sourcePath, 'utf8');
const fn = source.slice(source.indexOf('function AdminDashboardScrollTable<Row>('), source.indexOf('function AdminDashboardKpiValueSkeleton('));
if (!fn.includes('rows.map(')) throw new Error('frozen_baseline_missing');
const compiled = ts.transpileModule(fn, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const Baseline = new Function('React', 'cn', 'formatNumber', `${compiled}; return AdminDashboardScrollTable;`)(React, cn, (n: number) => n.toLocaleString('ko-KR'));
const rows = Array.from({ length: 490 }, (_, i) => ({ id: `synthetic-${i}`, title: `합성 영상 ${i}`, views: 100000 + i * 719, likes: 1000 + i * 13, comments: i * 2 }));
const columns = [
  { key: 'title', header: '제목', cell: (row: typeof rows[number]) => <span className="truncate">{row.title}</span> },
  ...(['views', 'likes', 'comments'] as const).map(key => ({ key, header: key, cell: (row: typeof rows[number]) => <span>{row[key].toLocaleString('ko-KR')}</span> })),
];
const props = { rows, columns, getRowKey: (row: typeof rows[number]) => row.id, emptyText: '없음' };
const render = (component: typeof Baseline) => renderToStaticMarkup(React.createElement(component, props));
for (let i = 0; i < 5; i++) { render(Baseline); render(DashboardDataTable); }
const samples: { pair: number; variant: string; elapsedMs: number; renderedRows: number; bytes: number }[] = [];
for (let pair = 0; pair < 30; pair++) {
  for (const variant of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const started = performance.now();
    const html = render(variant === 'baseline' ? Baseline : DashboardDataTable);
    samples.push({ pair, variant, elapsedMs: performance.now() - started, renderedRows: (html.match(/<tr[ >]/g) ?? []).length - 1, bytes: Buffer.byteLength(html) });
  }
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summarize = (variant: string) => {
  const selected = samples.filter(row => row.variant === variant);
  const values = selected.map(row => row.elapsedMs);
  const median = percentile(values, .5);
  return { samples: values.length, medianMs: median, p75Ms: percentile(values, .75), madMs: percentile(values.map(n => Math.abs(n - median)), .5), renderedRows: selected[0].renderedRows, bytes: selected[0].bytes };
};
const baseline = summarize('baseline'), candidate = summarize('candidate');
const budgets = { absoluteCandidateP75Ms: 50, maximumRelativeP75Ratio: .8, absoluteNoiseFloorMs: 1, maximumNoiseMultiple: 2, maximumRenderedRows: 50 };
const gain = baseline.p75Ms - candidate.p75Ms;
const admitted = candidate.p75Ms <= budgets.absoluteCandidateP75Ms && candidate.p75Ms / baseline.p75Ms <= budgets.maximumRelativeP75Ratio && gain > Math.max(budgets.absoluteNoiseFloorMs, budgets.maximumNoiseMultiple * Math.max(baseline.madMs, candidate.madMs)) && candidate.renderedRows <= budgets.maximumRenderedRows;
const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
mkdirSync(resolve(directory, 'frozen-after'), { recursive: true });
const candidateSource = readFileSync(resolve(directory, '../../components/admin/DashboardDataTable.tsx'));
writeFileSync(resolve(directory, 'frozen-after/DashboardDataTable.tsx.txt'), candidateSource);
const raw = { scope: 'local-SSR-dashboard-table-first-page', syntheticInputRows: rows.length, inputSha256: sha(JSON.stringify(rows)), baselineSha256: sha(source), candidateSha256: sha(candidateSource), runtime: process.version, samples };
const scored = { scope: raw.scope, baseline, candidate, budgets, absoluteGainP75Ms: gain, relativeP75Ratio: candidate.p75Ms / baseline.p75Ms, admittedSlices: admitted ? 1 : 0, browserLatencyEstablished: false, productionLatencyEstablished: false, canonicalG003AdmissionEstablished: false };
writeFileSync(resolve(directory, 'table-render-raw.json'), JSON.stringify(raw, null, 2) + '\n');
writeFileSync(resolve(directory, 'table-render-scored.json'), JSON.stringify(scored, null, 2) + '\n');
console.log(JSON.stringify(scored));
