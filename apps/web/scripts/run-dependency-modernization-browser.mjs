import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logCliError } from './privacy-safe-cli-log.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeCli = process.env.TZUDONG_NODE24_EXECUTABLE?.trim() || process.execPath;
const npmAuthorityCli = process.env.TZUDONG_NPM_11_EXECUTABLE?.trim();
const npmCli = npmAuthorityCli || process.env.npm_execpath?.trim();
const npmUsesExecutable = Boolean(npmAuthorityCli);
const MAX_CAPTURED_OUTPUT_LENGTH = 1_048_576;
const packageOnly = process.argv.slice(2).includes('--package-only');
const proofPort = process.env.TZUDONG_DEPENDENCY_PROOF_PORT?.trim() || '8080';
const proofOrigin = `http://localhost:${proofPort}`;
const proofEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://dependency-proof.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dependency-modernization-browser-proof-anon-key',
    PLAYWRIGHT_WEB_SERVER_COMMAND: `node scripts/start-standalone.mjs --port ${proofPort} --hostname localhost`,
    PLAYWRIGHT_BASE_URL: proofOrigin,
    PLAYWRIGHT_WEB_SERVER_URL: `${proofOrigin}/api/health`,
    PLAYWRIGHT_REUSE_EXISTING_SERVER: '0',
};

class OperationFailure extends Error {
    constructor(code) {
        super();
        this.code = code;
    }
}

function isOperationFailure(error) {
    try {
        return error instanceof OperationFailure;
    } catch {
        return false;
    }
}

function stopChild(child) {
    try {
        child.kill();
    } catch {
        // Child shutdown failures are already represented by the fixed operation code.
    }
}

function digest(source) {
    return createHash('sha256').update(source).digest('hex');
}

function run(command, args, { cwd, env = proofEnvironment, timeoutMs }) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(command, args, { cwd, env, shell: false, stdio: 'ignore' });
        } catch {
            reject(new OperationFailure('DEPENDENCY_MODERNIZATION_STEP_LAUNCH_FAILED'));
            return;
        }

        let settled = false;
        let timer;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        const fail = (code) => finish(reject, new OperationFailure(code));

        timer = setTimeout(() => {
            stopChild(child);
            fail('DEPENDENCY_MODERNIZATION_STEP_TIMEOUT');
        }, timeoutMs);
        child.once('error', () => {
            fail('DEPENDENCY_MODERNIZATION_STEP_LAUNCH_FAILED');
        });
        child.once('exit', (code, signal) => {
            if (signal) {
                fail('DEPENDENCY_MODERNIZATION_STEP_INTERRUPTED');
                return;
            }
            if (code !== 0) {
                fail('DEPENDENCY_MODERNIZATION_STEP_FAILED');
                return;
            }
            finish(resolve);
        });
    });
}

function capture(command, args, options) {
    return new Promise((resolve, reject) => {
        const {
            acceptedExitCodes = [0],
            timeoutMs,
            ...spawnOptions
        } = options;
        let child;
        try {
            child = spawn(command, args, {
                ...spawnOptions,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            reject(new OperationFailure('DEPENDENCY_MODERNIZATION_PROOF_LAUNCH_FAILED'));
            return;
        }

        let stdout = '';
        let hasStderr = false;
        let settled = false;
        let timer;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        const fail = (code) => finish(reject, new OperationFailure(code));

        if (!child.stdout || !child.stderr) {
            stopChild(child);
            fail('DEPENDENCY_MODERNIZATION_PROOF_OUTPUT_UNAVAILABLE');
            return;
        }

        child.stdout.setEncoding('utf8').on('data', (chunk) => {
            if (settled) return;
            if (stdout.length + chunk.length > MAX_CAPTURED_OUTPUT_LENGTH) {
                stopChild(child);
                fail('DEPENDENCY_MODERNIZATION_PROOF_OUTPUT_LIMIT');
                return;
            }
            stdout += chunk;
        });
        child.stderr.on('data', () => {
            hasStderr = true;
        });
        child.stdout.once('error', () => {
            fail('DEPENDENCY_MODERNIZATION_PROOF_OUTPUT_UNAVAILABLE');
        });
        child.stderr.once('error', () => {
            fail('DEPENDENCY_MODERNIZATION_PROOF_OUTPUT_UNAVAILABLE');
        });
        timer = setTimeout(() => {
            stopChild(child);
            fail('DEPENDENCY_MODERNIZATION_PROOF_TIMEOUT');
        }, timeoutMs);
        child.once('error', () => {
            fail('DEPENDENCY_MODERNIZATION_PROOF_LAUNCH_FAILED');
        });
        child.once('exit', (code, signal) => {
            if (signal) {
                fail('DEPENDENCY_MODERNIZATION_PROOF_INTERRUPTED');
                return;
            }
            if (!acceptedExitCodes.includes(code)) {
                fail('DEPENDENCY_MODERNIZATION_PROOF_FAILED');
                return;
            }
            if (hasStderr) {
                fail('DEPENDENCY_MODERNIZATION_PROOF_DIAGNOSTIC');
                return;
            }
            finish(resolve, stdout.trim());
        });
    });
}
function npmCommand(args) {
    return npmUsesExecutable ? [npmCli, args] : [nodeCli, [npmCli, ...args]];
}


async function proveCandidateDependencyGraph() {
    if (!isAbsolute(nodeCli) || !/^v24\./.test(await capture(nodeCli, ['--version'], {
        cwd: appRoot,
        env: proofEnvironment,
        timeoutMs: 30_000,
    }))) {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_NODE_VERSION_UNSUPPORTED');
    }
    if (!npmCli || !isAbsolute(npmCli)) {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_NPM_EXEC_PATH_UNAVAILABLE');
    }

    const [npmCommandPath, npmVersionArgs] = npmCommand(['--version']);
    const npmVersion = await capture(npmCommandPath, npmVersionArgs, {
        cwd: appRoot,
        env: proofEnvironment,
        timeoutMs: 30_000,
    });
    if (npmVersion !== '11.6.2') {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_NPM_VERSION_UNSUPPORTED');
    }

    const [packageSource, lockSource] = await Promise.all([
        readFile(join(appRoot, 'package.json'), 'utf8'),
        readFile(join(appRoot, 'package-lock.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(packageSource);
    if (manifest.packageManager !== 'npm@11.6.2' || manifest.engines?.node !== '24.x') {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_PACKAGE_METADATA_INVALID');
    }
    const lock = JSON.parse(lockSource);
    const forbiddenLockPaths = Object.keys(lock.packages ?? {}).filter((path) =>
        /(?:^|\/)node_modules\/(?:lodash|sonner)$/.test(path),
    );
    if (forbiddenLockPaths.length > 0) {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_FORBIDDEN_PACKAGE_PRESENT');
    }

    const proofRoot = await mkdtemp(join(tmpdir(), 'tzudong-dependency-proof-'));
    try {
        await Promise.all([
            writeFile(join(proofRoot, 'package.json'), packageSource),
            writeFile(join(proofRoot, 'package-lock.json'), lockSource),
        ]);
        const [copiedPackage, copiedLock] = await Promise.all([
            readFile(join(proofRoot, 'package.json'), 'utf8'),
            readFile(join(proofRoot, 'package-lock.json'), 'utf8'),
        ]);
        if (digest(copiedPackage) !== digest(packageSource) || digest(copiedLock) !== digest(lockSource)) {
            throw new OperationFailure('DEPENDENCY_MODERNIZATION_PROOF_COPY_MISMATCH');
        }

        const [npmInstallCommandPath, npmInstallArgs] = npmCommand(['ci', '--ignore-scripts', '--no-audit', '--fund=false']);
        await run(npmInstallCommandPath, npmInstallArgs, {
            cwd: proofRoot,
            timeoutMs: 8 * 60_000,
        });
        const receipt = await readFile(join(proofRoot, 'node_modules', '.package-lock.json'), 'utf8');
        if (!receipt) {
            throw new OperationFailure('DEPENDENCY_MODERNIZATION_INSTALL_RECEIPT_MISSING');
        }

        const [npmListCommandPath, npmListArgs] = npmCommand(['ls', 'lodash', 'sonner', '--all', '--json']);
        const removedGraph = JSON.parse(await capture(
            npmListCommandPath,
            npmListArgs,
            {
                cwd: proofRoot,
                env: proofEnvironment,
                timeoutMs: 30_000,
                acceptedExitCodes: [0, 1],
            },
        ));
        if (
            Object.keys(removedGraph).sort().join(',') !== 'name,version' ||
            removedGraph.name !== manifest.name ||
            removedGraph.version !== manifest.version
        ) {
            throw new OperationFailure('DEPENDENCY_MODERNIZATION_REMOVED_PACKAGES_PRESENT');
        }
    } finally {
        await rm(proofRoot, { recursive: true, force: true });
    }
}

try {
    if (!/^[1-9][0-9]{3,4}$/.test(proofPort) || Number(proofPort) < 1024 || Number(proofPort) > 65535) {
        throw new OperationFailure('DEPENDENCY_MODERNIZATION_PORT_INVALID');
    }
    await proveCandidateDependencyGraph();
    if (!packageOnly) {
        await run(
            process.execPath,
            ['scripts/clean-next.mjs', '--', process.execPath, 'node_modules/next/dist/bin/next', 'build', '--webpack'],
            { cwd: appRoot, timeoutMs: 8 * 60_000 },
        );
        await run(process.execPath, ['scripts/verify-route-css-boundaries.mjs'], { cwd: appRoot, timeoutMs: 60_000 });
        await run(
            process.execPath,
            ['node_modules/@playwright/test/cli.js', 'test', 'tests/dependency-modernization.spec.ts', '--project=chromium'],
            { cwd: appRoot, timeoutMs: 5 * 60_000 },
        );
    }
} catch (error) {
    logCliError(
        isOperationFailure(error)
            ? error
            : new OperationFailure('DEPENDENCY_MODERNIZATION_UNEXPECTED_FAILURE'),
    );
    process.exitCode = 1;
}
