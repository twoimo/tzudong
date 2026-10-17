import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORYBOARD_RUNTIME_SOURCE_BINDING_SCHEMA_VERSION = 1 as const;

/**
 * Every executable storyboard boundary that can admit a provider, model or worker.
 * The build hashes these exact source bytes before Next bundles the public readback.
 */
export const STORYBOARD_RUNTIME_SOURCE_PATHS = Object.freeze([
  'apps/web/scripts/storyboard-gemini-worker.ts',
  'apps/web/lib/admin/storyboard/gemini-models.ts',
  'apps/web/lib/admin/storyboard/production-contract.ts',
  'apps/web/lib/admin/storyboard/production-worker-auth.ts',
  'apps/web/lib/admin/storyboard/production-store.ts',
  'apps/web/lib/admin/storyboard/production-api.ts',
  'apps/web/lib/admin/storyboard/gemini-client.ts',
  'apps/web/lib/admin/storyboard/outbound-worker-contract.ts',
  'apps/web/lib/admin/storyboard/outbound-worker.ts',
  'apps/web/lib/runtime-feature-readiness-contract.ts',
  'apps/web/lib/server/runtime-feature-readiness.ts',
  'apps/web/app/api/admin/storyboard/production/route.ts',
  'apps/web/app/api/admin/storyboard/production/[id]/route.ts',
  'apps/web/app/api/admin/storyboard/production/[id]/images/route.ts',
  'apps/web/app/api/admin/storyboard/production/[id]/export/route.ts',
  'apps/web/app/api/admin/storyboard/production/[id]/assets/[assetId]/route.ts',
  'apps/web/app/api/admin/operating-readback/storyboard-policy/route.ts',
  'apps/web/app/api/admin/operating-readback/storyboard-policy/readback-response.ts',
  'apps/web/app/api/runtime-compatibility/storyboard/route.ts',
  'apps/web/app/api/runtime-compatibility/storyboard/runtime-response.ts',
  'apps/web/app/api/runtime-compatibility/features/route.ts',
  'apps/web/lib/admin/storyboard/runtime-policy.ts',
  'apps/web/lib/admin/storyboard/runtime-source-binding.ts',
] as const);

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function defaultRepositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
}

function readBoundedSource(repositoryRoot: string, sourcePath: string) {
  const root = realpathSync(repositoryRoot);
  const absolute = resolve(root, sourcePath);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || fromRoot.startsWith(sep)) {
    throw new Error('storyboard_runtime_source_path_invalid');
  }
  const status = lstatSync(absolute);
  if (!status.isFile() || status.isSymbolicLink() || status.size < 1 || status.size > MAX_SOURCE_BYTES
    || realpathSync(absolute) !== absolute) {
    throw new Error('storyboard_runtime_source_invalid');
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_SOURCE_BYTES)) {
      throw new Error('storyboard_runtime_source_invalid');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (bytes.length !== status.size
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
      throw new Error('storyboard_runtime_source_changed');
    }
    return Object.freeze({
      bytes: bytes.length,
      path: sourcePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } finally {
    closeSync(descriptor);
  }
}

export function calculateStoryboardRuntimeSourceBinding({
  repositoryRoot = defaultRepositoryRoot(),
}: { repositoryRoot?: string } = {}) {
  const sources = STORYBOARD_RUNTIME_SOURCE_PATHS.map((sourcePath) =>
    readBoundedSource(repositoryRoot, sourcePath));
  const document = Object.freeze({
    algorithm: 'storyboard-runtime-source-binding/v1',
    schemaVersion: STORYBOARD_RUNTIME_SOURCE_BINDING_SCHEMA_VERSION,
    sources,
  });
  const sha256 = createHash('sha256').update(canonicalJson(document), 'utf8').digest('hex');
  if (!SHA256.test(sha256)) throw new Error('storyboard_runtime_source_binding_invalid');
  return Object.freeze({ ...document, sha256 });
}
