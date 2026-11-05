import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applicationInputName,
  captureRepositorySourceContract,
  trustedPackageInput,
} from '../scripts/typecheck-source-contract.mjs';

const temporaryDirectories: string[] = [];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'typecheck-source-contract-'));
  temporaryDirectories.push(directory);
  const repoRoot = join(directory, 'repo');
  const appRoot = join(repoRoot, 'apps', 'web');
  const sourcePath = join(repoRoot, 'backend', 'utils', 'provider-budget.mjs');
  await mkdir(join(repoRoot, 'backend', 'utils'), { recursive: true });
  await mkdir(appRoot, { recursive: true });
  await writeFile(sourcePath, 'export const providerBudget = true;\n');
  return { directory, repoRoot, appRoot, sourcePath };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('TypeScript repository source contract', () => {
  test('binds the one declared backend source to one canonical name and byte hash for both compilers', async () => {
    const { repoRoot, sourcePath } = await fixture();
    const contract = await captureRepositorySourceContract({
      repoRoot,
      entries: [{
        relativePath: 'backend/utils/provider-budget.mjs',
        logicalName: 'repo:backend/utils/provider-budget.mjs',
      }],
    });

    const canonicalSourcePath = await realpath(sourcePath);
    const native = contract.resolve(canonicalSourcePath, canonicalSourcePath, 'native');
    const compat = contract.resolve(canonicalSourcePath, canonicalSourcePath, 'compat');
    expect(native).toEqual(compat);
    expect(native).toEqual({
      name: 'repo:backend/utils/provider-budget.mjs',
      contentHash: sha256('export const providerBudget = true;\n'),
    });
    expect(contract.entries).toEqual([{
      relativePath: 'backend/utils/provider-budget.mjs',
      logicalName: 'repo:backend/utils/provider-budget.mjs',
      contentHash: native?.contentHash,
    }]);
    expect(() => contract.assertUsedBy(['native', 'compat'])).not.toThrow();
    await expect(contract.verifyUnchanged()).resolves.toBeUndefined();
  });

  test('rejects a neighboring checkout and repository credential or data paths', async () => {
    const { directory, repoRoot, appRoot, sourcePath } = await fixture();
    const contract = await captureRepositorySourceContract({
      repoRoot,
      entries: [{
        relativePath: 'backend/utils/provider-budget.mjs',
        logicalName: 'repo:backend/utils/provider-budget.mjs',
      }],
    });
    const neighbor = join(directory, 'neighbor', 'backend', 'utils', 'provider-budget.mjs');
    const credential = join(repoRoot, '.env');
    const data = join(repoRoot, 'backend', 'data', 'private.json');
    await mkdir(resolve(neighbor, '..'), { recursive: true });
    await mkdir(resolve(data, '..'), { recursive: true });
    await writeFile(neighbor, 'export const neighbor = true;\n');
    await writeFile(credential, 'TOKEN=fixture\n');
    await writeFile(data, '{}\n');

    expect(contract.resolve(neighbor, neighbor, 'native')).toBeNull();
    expect(contract.resolve(credential, credential, 'native')).toBeNull();
    expect(contract.resolve(data, data, 'native')).toBeNull();
    expect(() => applicationInputName({ resolvedPath: neighbor, appRoot })).toThrow('Compiler input escaped app root');
    expect(() => applicationInputName({ resolvedPath: credential, appRoot })).toThrow('Compiler input escaped app root');
    expect(() => applicationInputName({ resolvedPath: data, appRoot })).toThrow('Compiler input escaped app root');
    const canonicalSourcePath = await realpath(sourcePath);
    expect(contract.resolve(canonicalSourcePath, canonicalSourcePath, 'native')?.name).toBe('repo:backend/utils/provider-budget.mjs');
  });

  test.skipIf(process.platform === 'win32')('rejects a declared source replaced by a symlink escape', async () => {
    const { directory, repoRoot, sourcePath } = await fixture();
    const external = join(directory, 'external-provider-budget.mjs');
    await writeFile(external, 'export const external = true;\n');
    await rm(sourcePath);
    await symlink(external, sourcePath);

    await expect(captureRepositorySourceContract({
      repoRoot,
      entries: [{
        relativePath: 'backend/utils/provider-budget.mjs',
        logicalName: 'repo:backend/utils/provider-budget.mjs',
      }],
    })).rejects.toThrow('must not traverse a symlink');
  });

  test('detects source replacement even when the replacement has identical bytes', async () => {
    const { repoRoot, sourcePath } = await fixture();
    const contract = await captureRepositorySourceContract({
      repoRoot,
      entries: [{
        relativePath: 'backend/utils/provider-budget.mjs',
        logicalName: 'repo:backend/utils/provider-budget.mjs',
      }],
    });
    const replacement = `${sourcePath}.replacement`;
    await writeFile(replacement, 'export const providerBudget = true;\n');
    await rename(replacement, sourcePath);
    await expect(contract.verifyUnchanged()).rejects.toThrow('changed during typecheck');
  });

  test('accepts packages only from the configured node_modules tree', async () => {
    const { directory, appRoot } = await fixture();
    const trustedRoot = join(appRoot, 'node_modules');
    const trustedPackage = join(trustedRoot, '@fixture', 'types');
    const trustedInput = join(trustedPackage, 'index.d.ts');
    await mkdir(trustedPackage, { recursive: true });
    await writeFile(join(trustedPackage, 'package.json'), '{"name":"@fixture/types","version":"1.2.3"}\n');
    await writeFile(trustedInput, 'export declare const value: true;\n');
    const canonicalTrustedInput = await realpath(trustedInput);
    expect(await trustedPackageInput({
      requestedPath: trustedInput,
      resolvedPath: canonicalTrustedInput,
      nodeModulesRoot: trustedRoot,
    })).toEqual({
      metadata: { name: '@fixture/types', version: '1.2.3' },
      subpath: 'index.d.ts',
      contentHash: sha256('export declare const value: true;\n'),
    });

    const neighborPackage = join(directory, 'neighbor', 'node_modules', '@fixture', 'types');
    const neighborInput = join(neighborPackage, 'index.d.ts');
    await mkdir(neighborPackage, { recursive: true });
    await writeFile(join(neighborPackage, 'package.json'), '{"name":"@fixture/types","version":"1.2.3"}\n');
    await writeFile(neighborInput, 'export declare const value: false;\n');
    await expect(trustedPackageInput({
      requestedPath: neighborInput,
      resolvedPath: await realpath(neighborInput),
      nodeModulesRoot: trustedRoot,
    })).rejects.toThrow('untrusted node_modules root');
  });
});
