import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_MAP_SHA256 = '0a1b4b209bb2698707d5e3d54bbcfdb8e2c5794d2bd1f5f62c8b69d3a8025725';
const RETIRED_PACKAGE_PATH = 'fixture-inputs/package.json';
const SNAPSHOT_PATH = 'fixture-inputs/package-manifest.snapshot';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(code, detail) { throw new Error(`${code}: ${detail}`); }
function containedPath(root, relativePath, code = 'PATH_ESCAPE') {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) fail(code, String(relativePath));
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail(code, relativePath);
  let real;
  try { real = fs.realpathSync(target); } catch { fail('ARTIFACT_MISSING', relativePath); }
  const realRel = path.relative(fs.realpathSync(root), real);
  if (!realRel || realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) fail(code, relativePath);
  return real;
}

export function verifyEvidence({ evidenceDir, repositoryRoot }) {
  const root = fs.realpathSync(evidenceDir);
  const repo = fs.realpathSync(repositoryRoot);
  if (fs.existsSync(path.join(root, RETIRED_PACKAGE_PATH))) fail('ACTIVE_PACKAGE_REINTRODUCED', RETIRED_PACKAGE_PATH);
  const mapPath = containedPath(root, 'artifact-map.json');
  const mapBytes = fs.readFileSync(mapPath);
  const actualMapSha = sha256(mapBytes);
  if (actualMapSha !== EXPECTED_MAP_SHA256) fail('ARTIFACT_MAP_HASH_MISMATCH', actualMapSha);
  const manifest = JSON.parse(mapBytes.toString('utf8'));
  if (!Array.isArray(manifest.artifacts)) fail('ARTIFACT_MAP_INVALID', 'artifacts');
  let checked = 0;
  for (const item of manifest.artifacts) {
    if (!item || typeof item.path !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('ARTIFACT_MAP_INVALID', JSON.stringify(item));
    const mapped = item.path === RETIRED_PACKAGE_PATH ? SNAPSHOT_PATH : item.path;
    const target = containedPath(root, mapped);
    const bytes = fs.readFileSync(target);
    if (bytes.length !== item.bytes) fail('ARTIFACT_SIZE_MISMATCH', item.path);
    const digest = sha256(bytes);
    if (digest !== item.sha256) fail('ARTIFACT_HASH_MISMATCH', item.path);
    checked++;
  }
  if (!manifest.artifacts.some(item => item.path === RETIRED_PACKAGE_PATH)) fail('ARTIFACT_MAP_INVALID', 'retired package entry absent');
  const bindingsPath = containedPath(root, 'source-bindings.json');
  const bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
  if (!Array.isArray(bindings.sources)) fail('SOURCE_BINDINGS_INVALID', 'sources');
  const sourceMismatches = [];
  for (const item of bindings.sources) {
    let target;
    try { target = containedPath(repo, item.path, 'SOURCE_PATH_ESCAPE'); }
    catch (error) { sourceMismatches.push({ path: item.path, reason: error.message.startsWith('ARTIFACT_MISSING') ? 'missing' : error.message }); continue; }
    const bytes = fs.readFileSync(target);
    const actualSha256 = sha256(bytes);
    if (bytes.length !== item.bytes || actualSha256 !== item.sha256) sourceMismatches.push({ path: item.path, expectedBytes: item.bytes, actualBytes: bytes.length, expectedSha256: item.sha256, actualSha256 });
  }
  return { verified: true, artifacts: checked, artifactMapSha256: actualMapSha,
    sourceBindings: { checked: bindings.sources.length, mismatches: sourceMismatches } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const evidenceDir = path.join(repo, 'apps/web/performance/overseas-map-startup-20261021-v1');
  try { console.log(JSON.stringify(verifyEvidence({ evidenceDir, repositoryRoot: repo }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
