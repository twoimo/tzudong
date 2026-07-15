import fs from 'node:fs';
import path from 'node:path';
import { logCliError } from './privacy-safe-cli-log.mjs';

const args = process.argv.slice(2);

function readArg(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readRepeatedArg(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function hasFlag(name) {
  return args.includes(name);
}

function parseNumberArg(name, fallback) {
  const raw = readArg(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid numeric option');
  }
  return value;
}

function usage() {
  return `Usage: node scripts/compare-dev-route-reports.mjs --baseline <report.json> --candidate <report.json> [options]\n\nOptions:\n  --route <path>                  Compare only this route. Repeatable. Defaults to shared routes.\n  --median-regression-pct <n>     Allowed median regression percent. Default: 10\n  --p75-regression-pct <n>        Allowed p75 regression percent. Default: 10\n  --output <path>                 Write markdown report.\n  --label <text>                  Report title suffix.\n  --no-fail                       Do not set a non-zero exit code on regression.\n`;
}

function loadReport(filePath) {
  if (!filePath) throw new Error('Missing required report path');
  const resolved = path.resolve(filePath);
  const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!report.summaries?.by_route) {
    throw new Error('Invalid report structure');
  }
  return { resolved, report };
}

function percentDelta(candidate, baseline) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((candidate - baseline) / baseline) * 100;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(3)}s` : 'n/a';
}

function formatPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : 'n/a';
}

function routeSummary(report, route) {
  return report.summaries.by_route[route]?.elapsed_ms ?? null;
}

function getComparableRoutes(baseline, candidate, requestedRoutes) {
  if (requestedRoutes.length > 0) return requestedRoutes;
  const baselineRoutes = new Set(Object.keys(baseline.summaries.by_route));
  return Object.keys(candidate.summaries.by_route).filter((route) => baselineRoutes.has(route));
}

function compareReports({ baseline, candidate, routes, medianRegressionPct, p75RegressionPct }) {
  return routes.map((route) => {
    const base = routeSummary(baseline, route);
    const cand = routeSummary(candidate, route);
    const missing = !base || !cand;
    const medianDeltaPct = missing ? null : percentDelta(cand.median_ms, base.median_ms);
    const p75DeltaPct = missing ? null : percentDelta(cand.p75_ms, base.p75_ms);
    const medianPass = !missing && medianDeltaPct <= medianRegressionPct;
    const p75Pass = !missing && p75DeltaPct <= p75RegressionPct;
    return {
      route,
      missing,
      baseline_median_ms: base?.median_ms ?? null,
      baseline_p75_ms: base?.p75_ms ?? null,
      candidate_median_ms: cand?.median_ms ?? null,
      candidate_p75_ms: cand?.p75_ms ?? null,
      median_delta_pct: medianDeltaPct,
      p75_delta_pct: p75DeltaPct,
      status: !missing && medianPass && p75Pass ? 'pass' : 'fail',
      reason: missing
        ? 'missing route summary'
        : [
            medianPass ? null : `median regression ${formatPct(medianDeltaPct)} > +${medianRegressionPct}%`,
            p75Pass ? null : `p75 regression ${formatPct(p75DeltaPct)} > +${p75RegressionPct}%`,
          ].filter(Boolean).join('; '),
    };
  });
}

function buildMarkdown({ baselinePath, candidatePath, label, medianRegressionPct, p75RegressionPct, comparisons }) {
  const failures = comparisons.filter((row) => row.status === 'fail');
  const titleSuffix = label ? `: ${label}` : '';
  const lines = [
    `# Dev route report comparison${titleSuffix}`,
    '',
    `- Baseline: \`${baselinePath}\``,
    `- Candidate: \`${candidatePath}\``,
    `- Gate: median <= +${medianRegressionPct}%, p75 <= +${p75RegressionPct}%`,
    `- Result: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length} route(s))`}`,
    '',
    '| Route | Baseline median | Candidate median | Median delta | Baseline p75 | Candidate p75 | P75 delta | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const row of comparisons) {
    lines.push([
      `| \`${row.route}\``,
      formatMs(row.baseline_median_ms),
      formatMs(row.candidate_median_ms),
      formatPct(row.median_delta_pct),
      formatMs(row.baseline_p75_ms),
      formatMs(row.candidate_p75_ms),
      formatPct(row.p75_delta_pct),
      row.status === 'pass' ? 'PASS' : `FAIL${row.reason ? `: ${row.reason}` : ''}`,
    ].join(' | ') + ' |');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function ensureOutputPath(outputPath) {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(usage());
    return;
  }

  const baselinePath = readArg('--baseline');
  const candidatePath = readArg('--candidate');
  if (!baselinePath || !candidatePath) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const medianRegressionPct = parseNumberArg('--median-regression-pct', 10);
  const p75RegressionPct = parseNumberArg('--p75-regression-pct', 10);
  const label = readArg('--label', '');
  const outputPath = readArg('--output');
  const requestedRoutes = readRepeatedArg('--route');
  const failOnRegression = !hasFlag('--no-fail');

  const { resolved: baselineResolved, report: baseline } = loadReport(baselinePath);
  const { resolved: candidateResolved, report: candidate } = loadReport(candidatePath);
  const routes = getComparableRoutes(baseline, candidate, requestedRoutes);
  if (routes.length === 0) {
    throw new Error('No comparable routes found');
  }

  const comparisons = compareReports({ baseline, candidate, routes, medianRegressionPct, p75RegressionPct });
  const markdown = buildMarkdown({
    baselinePath: baselineResolved,
    candidatePath: candidateResolved,
    label,
    medianRegressionPct,
    p75RegressionPct,
    comparisons,
  });

  if (outputPath) {
    const resolvedOutput = ensureOutputPath(outputPath);
    fs.writeFileSync(resolvedOutput, markdown);
    console.log(JSON.stringify({ outputPath: resolvedOutput, result: comparisons.every((row) => row.status === 'pass') ? 'pass' : 'fail' }, null, 2));
  } else {
    process.stdout.write(markdown);
  }

  if (failOnRegression && comparisons.some((row) => row.status === 'fail')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[compare-dev-route-reports] ${line}`));
  process.exitCode = 1;
});
