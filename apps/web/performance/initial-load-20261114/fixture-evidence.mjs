// Shared artifact I/O only. Metric extraction, eligibility and statistics live
// separately in fixture-score.mjs and fixture-validate.mjs.
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTOCOL_SHA256 = '74eac221fb10a5f0cdc23d8e825ef68f318eb2aabbc4cda8793531c6ef0f5af1';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const requireThat = (condition, message) => { if (!condition) throw new Error(`frontend fixture: ${message}`); };
export const same = isDeepStrictEqual;
export const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

function safe(path) {
  requireThat(typeof path === 'string' && /^[A-Za-z0-9._/-]+$/.test(path)
    && !path.startsWith('/') && !path.endsWith('/') && !path.includes('//')
    && !path.split('/').some(part => part === '.' || part === '..'), 'unsafe artifact path');
  return path;
}
async function bytesAt(root, path) {
  const resolved = resolve(root, safe(path));
  const actual = await realpath(resolved);
  const inside = relative(await realpath(root), actual);
  const info = await lstat(resolved);
  requireThat(actual === resolved && !isAbsolute(inside) && !inside.startsWith('..')
    && info.isFile() && !info.isSymbolicLink() && info.size <= 512 * 1024 * 1024, 'invalid artifact file');
  return readFile(resolved);
}
const parse = bytes => JSON.parse(bytes.toString('utf8'));
export const trialPath = (runPath, path) => safe(path.startsWith(dirname(runPath) + '/') ? path : dirname(runPath) + '/' + path);
export const codeFiles = {
  sourceScorer: 'score.mjs', sourceValidator: 'validate.mjs', fixtureScorer: 'fixture-score.mjs',
  fixtureValidator: 'fixture-validate.mjs', fixtureEvidence: 'fixture-evidence.mjs',
};

async function graph(read, input) {
  const names = new Set([safe(input)]);
  const take = async path => { names.add(safe(path)); return parse(await read(path)); };
  const experiment = await take(input);
  for (const key of ['protocol', 'collector', 'sanitizer', 'toolLock', 'toolManifest']) names.add(safe(experiment[key]));
  for (const key of Object.keys(codeFiles)) names.add(safe(experiment.evidenceSources?.[key]));
  const fixture = await take(experiment.fixtureManifest);
  names.add(safe(fixture.bundlePath));
  for (const item of fixture.sourceFiles ?? []) names.add(safe(item.artifactPath));
  const builds = {}, phases = {};
  for (const phase of ['before', 'after']) {
    builds[phase] = await take(experiment.builds?.[phase]);
    const entry = experiment.phases?.[phase];
    if (!entry) { phases[phase] = null; continue; }
    const run = await take(entry.run);
    const trials = [];
    for (const trial of run.trials ?? []) {
      const record = await take(trialPath(entry.run, trial.attemptId + '/trial.json'));
      requireThat(same(record, trial), 'trial record differs from run');
      for (const path of Object.values(trial.paths ?? {})) if (path !== null) names.add(trialPath(entry.run, path));
      const readTrial = kind => trial.paths?.[kind] ? take(trialPath(entry.run, trial.paths[kind])) : null;
      trials.push({ trial, observation: await readTrial('observations'), lhr: await readTrial('lhr') });
    }
    phases[phase] = { run, trials };
  }
  return { names: [...names].sort(), experiment, fixture, builds, phases };
}

export async function createFixtureMap({ root = HERE, input = 'experiment.json', output = 'fixture-artifact-map.json' } = {}) {
  root = resolve(root);
  const loaded = await graph(path => bytesAt(root, path), input);
  const files = [];
  for (const path of loaded.names) {
    const bytes = await bytesAt(root, path);
    files.push({ path, sha256: digest(bytes), sizeBytes: bytes.length });
  }
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 'frontend-fixture-artifact-map.v1', files }, null, 2) + '\n');
  await writeFile(resolve(root, safe(output)), bytes, { flag: 'wx' });
  return { artifactMap: output, artifactMapSha256: digest(bytes), files: files.length };
}

export async function loadFixtureEvidence({ root = HERE, input = 'experiment.json', artifactMap = 'fixture-artifact-map.json', artifactMapSha256 } = {}) {
  root = resolve(root);
  requireThat(hex(artifactMapSha256), 'detached artifact-map SHA-256 required');
  const mapBytes = await bytesAt(root, artifactMap);
  requireThat(digest(mapBytes) === artifactMapSha256, 'artifact-map hash mismatch');
  const map = parse(mapBytes), content = new Map(), hashes = new Map();
  requireThat(map.schemaVersion === 'frontend-fixture-artifact-map.v1' && Array.isArray(map.files), 'artifact-map schema');
  for (const file of map.files) {
    requireThat(!content.has(file.path) && hex(file.sha256) && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0, 'artifact-map entry');
    const bytes = await bytesAt(root, file.path);
    requireThat(bytes.length === file.sizeBytes && digest(bytes) === file.sha256, 'artifact hash mismatch');
    content.set(file.path, bytes); hashes.set(file.path, file.sha256);
  }
  const read = async path => { requireThat(content.has(path), 'unmapped input'); return content.get(path); };
  const loaded = await graph(read, input);
  requireThat(loaded.names.every(path => content.has(path)), 'incomplete artifact map');
  const protocolBytes = await read(loaded.experiment.protocol);
  requireThat(digest(protocolBytes) === PROTOCOL_SHA256, 'fixture protocol is not the predeclared revision');
  for (const [key, name] of Object.entries(codeFiles)) {
    requireThat(digest(await readFile(resolve(HERE, name))) === hashes.get(loaded.experiment.evidenceSources[key]), 'executing evidence source differs from frozen source');
  }
  return { ...loaded, protocol: parse(protocolBytes), root, hashes, content, artifactMapSha256 };
}

export function argumentsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    requireThat(/^--[a-z][a-z0-9-]*$/.test(argv[index]) && typeof argv[index + 1] === 'string', 'CLI arguments');
    const key = argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    requireThat(!Object.hasOwn(options, key), 'duplicate CLI argument'); options[key] = argv[index + 1];
  }
  return options;
}
export async function writeResult(root, path, value) {
  await writeFile(resolve(root, safe(path)), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
