import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const webRoot = resolve(dirname(scriptPath), '..');
const appRoot = join(webRoot, 'app');
const defaultOutput = join(webRoot, 'performance/admin-route-consistency-20261012/route-census.json');
const historicalPublicMatrixPath = join(webRoot, 'performance/public-cms-followthrough-20261009/accepted-route-matrix.json');
const historicalCapturePath = join(webRoot, 'performance/public-cms-followthrough-20261009/capture-results.json');
const currentAdminRenderPath = join(webRoot, 'performance/goal-delivery-20261012/final-source-bound-render.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function posix(value) {
  return value.split(sep).join('/');
}

function routeFromSource(sourcePath) {
  const directory = dirname(sourcePath).replace(/^app(?:\/|$)/, '');
  return directory === '.' || directory === '' ? '/' : `/${directory}`;
}

function walkPages(directory = appRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return walkPages(absolute);
    if (entry.name !== 'page.tsx') return [];
    return [posix(relative(webRoot, absolute))];
  }).sort();
}

function parameters(routePattern) {
  return [...routePattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sourceRecord(sourcePath) {
  const bytes = readFileSync(join(webRoot, sourcePath));
  return { sourcePath, sha256: sha256(bytes), bytes: bytes.byteLength };
}

function captureInputs(captures) {
  const byPattern = new Map();
  for (const capture of captures.captures ?? []) {
    if (!capture?.routePattern || !capture?.path) continue;
    const paths = byPattern.get(capture.routePattern) ?? new Set();
    paths.add(capture.path);
    byPattern.set(capture.routePattern, paths);
  }
  return new Map([...byPattern].map(([pattern, paths]) => [pattern, [...paths].sort()]));
}

function publicEvidence(routePattern, matrixByRoute, inputsByRoute) {
  const prior = matrixByRoute.get(routePattern);
  const recordedInputs = inputsByRoute.get(routePattern) ?? [];
  return {
    evidencePath: 'performance/public-cms-followthrough-20261009/accepted-route-matrix.json',
    evidenceFound: Boolean(prior),
    scope: prior ? 'historical anonymous or synthetic three-width matrix' : 'none',
    operatingAuthenticatedDataVerified: prior?.operatingAuthenticatedDataVerified === true,
    recordedState: prior?.currentEvidence ?? null,
    screenshots: prior?.screenshots ?? null,
    representativeInputs: parameters(routePattern).length > 0 ? recordedInputs : [routePattern],
    missing: prior
      ? ['current-source render binding', 'operating data', ...(parameters(routePattern).length > 0 && recordedInputs.length === 0 ? ['confirmed dynamic input'] : [])]
      : ['historical matrix row', 'current-source render binding', 'operating data'],
  };
}

function adminEvidence(routePattern, source, renderedModules) {
  if (routePattern === '/admin') {
    return {
      evidencePath: 'performance/goal-delivery-20261012/final-source-bound-render.json',
      scope: 'synthetic /admin sidebar module geometry and navigation only',
      representedModule: null,
      missing: ['OAuth', 'operating DB', 'save or apply', 'standalone admin subpaths'],
    };
  }
  const embeddedModule = routePattern === '/admin/banners'
    ? 'banners'
    : routePattern === '/admin/evaluations'
      ? 'restaurants'
      : routePattern === '/admin/submissions'
        ? 'submissions'
        : null;
  const isRedirect = source.includes("redirect('/admin?module=submissions')");
  const represented = embeddedModule ? renderedModules.has(embeddedModule) : false;
  return {
    evidencePath: represented ? 'performance/goal-delivery-20261012/final-source-bound-render.json' : null,
    scope: isRedirect
      ? 'source redirect plus synthetic canonical target only'
      : represented
        ? 'embedded canonical module only; standalone URL was not rendered'
        : 'no current source-bound render evidence',
    representedModule: represented ? embeddedModule : null,
    missing: isRedirect
      ? ['standalone redirect HTTP and auth readback']
      : ['standalone route render', 'OAuth', 'operating DB', 'save or apply'],
  };
}

export function buildRouteCensus() {
  const pageSources = walkPages();
  const pageRows = pageSources.map((sourcePath) => ({
    routePattern: routeFromSource(sourcePath),
    category: sourcePath.startsWith('app/admin/') ? 'admin-page' : 'public-or-account-page',
    ...sourceRecord(sourcePath),
  }));
  const shareSourcePath = 'app/s/[code]/route.ts';
  if (!existsSync(join(webRoot, shareSourcePath))) throw new Error('share-handler-missing');

  const matrix = readJson(historicalPublicMatrixPath);
  const matrixByRoute = new Map(matrix.map((row) => [row.routePattern, row]));
  const inputsByRoute = captureInputs(readJson(historicalCapturePath));
  const adminRender = readJson(currentAdminRenderPath);
  const renderedModules = new Set((adminRender.rows ?? []).map((row) => row.module));

  const routes = [
    ...pageRows.map((row) => ({
      ...row,
      dynamicParameters: parameters(row.routePattern),
      evidence: row.category === 'admin-page'
        ? adminEvidence(row.routePattern, readFileSync(join(webRoot, row.sourcePath), 'utf8'), renderedModules)
        : publicEvidence(row.routePattern, matrixByRoute, inputsByRoute),
    })),
    {
      routePattern: '/s/[code]',
      category: 'public-share-handler',
      ...sourceRecord(shareSourcePath),
      dynamicParameters: ['code'],
      evidence: publicEvidence('/s/[code]', matrixByRoute, inputsByRoute),
    },
  ].sort((left, right) => left.routePattern.localeCompare(right.routePattern) || left.category.localeCompare(right.category));

  const publicPages = routes.filter((route) => route.category === 'public-or-account-page');
  const shareHandlers = routes.filter((route) => route.category === 'public-share-handler');
  const adminPages = routes.filter((route) => route.category === 'admin-page');
  const manifest = routes.map(({ routePattern, sourcePath, sha256: sourceSha256 }) => ({ routePattern, sourcePath, sha256: sourceSha256 }));
  const sourceManifestSha256 = sha256(`${JSON.stringify(manifest)}\n`);
  const baseHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).trim();

  return {
    schema: 'tzudong-source-route-census/v1',
    kind: 'source-and-historical-evidence-inventory-only',
    baseHead,
    sourceManifestSha256,
    counts: {
      publicOrAccountPages: publicPages.length,
      publicShareHandlers: shareHandlers.length,
      adminPhysicalPages: adminPages.length,
      totalSurfaces: routes.length,
      historicalPublicMatrixRows: matrix.length,
      currentAdminSyntheticModules: renderedModules.size,
    },
    assertions: {
      expectedCurrentCounts: publicPages.length === 21 && shareHandlers.length === 1 && adminPages.length === 5 && routes.length === 27,
      historicalPublicMatrixCoversCurrentPublicPatterns: [...publicPages, ...shareHandlers].every((route) => matrixByRoute.has(route.routePattern)),
      historicalPublicOperatingVerificationCount: matrix.filter((row) => row.operatingAuthenticatedDataVerified === true).length,
    },
    evidenceInputs: [historicalPublicMatrixPath, historicalCapturePath, currentAdminRenderPath].map((path) => ({
      path: posix(relative(webRoot, path)),
      sha256: sha256(readFileSync(path)),
    })),
    limitations: [
      'No route was requested, rendered, authenticated, or mutated by this source census.',
      'Historical evidence labels retain their original source and environment scope.',
      'A route source file or historical matrix row does not prove runtime, OAuth, DB, save, approval, or production behavior.',
      'Dynamic inputs are reused only when recorded in the historical capture; absent inputs remain an empty list.',
    ],
    routes,
  };
}

const outputFlagIndex = process.argv.indexOf('--output');
const output = outputFlagIndex >= 0 && process.argv[outputFlagIndex + 1]
  ? resolve(process.argv[outputFlagIndex + 1])
  : defaultOutput;
const census = buildRouteCensus();
if (!census.assertions.expectedCurrentCounts || !census.assertions.historicalPublicMatrixCoversCurrentPublicPatterns) {
  throw new Error('route-census-contract-failed');
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(census, null, 2)}\n`);
console.log(JSON.stringify({ output: posix(relative(webRoot, output)), counts: census.counts, assertions: census.assertions }));
