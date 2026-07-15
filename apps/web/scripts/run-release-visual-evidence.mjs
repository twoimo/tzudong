import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, sign } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = realpathSync(path.resolve(scriptDirectory, '..'));
const templatePath = path.resolve(projectRoot, 'tests/release-visual-cells.template.json');
const playwrightCli = path.resolve(projectRoot, 'node_modules/@playwright/test/cli.js');
const playwrightConfig = path.resolve(projectRoot, 'playwright.release.config.ts');
const SHA256 = /^[a-f0-9]{64}$/;
const G009_ISSUER_KEY_ID = 'g009-release-visual-issuer-r2-202607';
const G009_CHANNEL_DOMAIN = 'tzudong:g009:release-visual-channel:v1\n';
const G009_CAPTURE_DOMAIN = 'tzudong:g009:release-visual-capture:v1\n';
const G009_ISSUER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADwnzGbf8at0hvjdS7I0QUDgLuMo8s/PTJiewWDDv9Hg=
-----END PUBLIC KEY-----`;
const G009_TEMPLATE_SHA256 = 'fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040';
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const MAX_FRAME_BYTES = 512;
const MAX_TRUSTED_INPUT_BYTES = 1024 * 1024;
const CHILD_TIMEOUT_MS = 120_000;
export const G009_ISSUER_PATHS = Object.freeze([
    'scripts/run-release-visual-evidence.mjs',
    'scripts/assemble-release-visual-evidence.mjs',
    'scripts/verify-release-visual-evidence.mjs',
    'tests/release-visual.spec.ts',
    'playwright.release.config.ts',
    'tests/release-visual-cells.template.json',
]);

const canonicalJson = (value) => {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
        return String(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!value || typeof value !== 'object') throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

const inside = (child, root) => {
    const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? child.toLowerCase() : child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
}

function externalDirectory(value) {
    if (!path.isAbsolute(value)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const lexical = path.resolve(value);
    const stat = lstatSync(lexical);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const resolved = realpathSync(lexical);
    if (inside(resolved, projectRoot)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    return { resolved, stat };
}

function writeExclusive(value, bytes) {
    if (!path.isAbsolute(value)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const target = path.resolve(value);
    const { resolved: parent, stat: parentIdentity } = externalDirectory(path.dirname(target));
    if (path.dirname(target) !== parent) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const flags = process.platform === 'win32' ? 'wx' : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
    let fd;
    try { fd = openSync(target, flags, 0o600); } catch { throw new Error('RELEASE_VISUAL_ISSUER_WRITE_FAILED'); }
    try {
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
        const file = fstatSync(fd);
        const currentParent = lstatSync(parent);
        if (!file.isFile() || file.nlink !== 1 || file.size !== bytes.length || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) throw new Error('RELEASE_VISUAL_ISSUER_WRITE_FAILED');
    } finally {
        closeSync(fd);
    }
}

function strictOrigin(value, environment) {
    let url;
    try { url = new URL(value); } catch { throw new Error('RELEASE_VISUAL_ISSUER_INVALID'); }
    const loopback = url.hostname === 'localhost' || url.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (value !== url.origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (environment === 'local' ? (!loopback || !['http:', 'https:'].includes(url.protocol) || !url.port) : url.protocol !== 'https:')) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    return url;
}
function readTrustedFile(value, label, root = projectRoot) {
    const lexical = path.resolve(value);
    if (!inside(lexical, root)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const link = lstatSync(lexical);
    if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1 || !Number.isSafeInteger(link.size) || link.size > MAX_TRUSTED_INPUT_BYTES || !inside(realpathSync(lexical), root)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    let fd;
    try { fd = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { throw new Error('RELEASE_VISUAL_ISSUER_INVALID'); }
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== link.dev || stat.ino !== link.ino || stat.size !== link.size) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
            const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (!count) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
            offset += count;
        }
        const after = fstatSync(fd);
        if (after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== 1 || after.size !== stat.size) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
        return bytes;
    } finally { closeSync(fd); }
}
function gitText(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_TRUSTED_INPUT_BYTES });
    if (result.status !== 0 || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout, 'utf8') > MAX_TRUSTED_INPUT_BYTES) throw new Error('RELEASE_VISUAL_ISSUER_GIT_INVALID');
    return result.stdout.trim();
}
function gitBlob(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'buffer', windowsHide: true, maxBuffer: MAX_TRUSTED_INPUT_BYTES });
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length > MAX_TRUSTED_INPUT_BYTES) throw new Error('RELEASE_VISUAL_ISSUER_GIT_INVALID');
    return result.stdout;
}
export function trustedIssuerBinding(requestedGitSha, gitRoot = projectRoot) {
    const head = gitText(gitRoot, ['rev-parse', 'HEAD']);
    const tree = gitText(gitRoot, ['rev-parse', `${requestedGitSha}^{tree}`]);
    if (head !== requestedGitSha || !/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(tree) || gitText(gitRoot, ['status', '--porcelain', '--', ...G009_ISSUER_PATHS])) throw new Error('RELEASE_VISUAL_ISSUER_GIT_INVALID');
    const executableDigests = Object.fromEntries(G009_ISSUER_PATHS.map((relative) => [relative, createHash('sha256').update(gitBlob(gitRoot, ['show', `${requestedGitSha}:${relative}`])).digest('hex')]));
    const manifest = { schemaVersion: 1, commitSha: requestedGitSha, treeSha: tree, executableDigests };
    return { ...manifest, manifestSha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex') };
}
export function createIssuerSigner(privateKey, issuerPublicKey) {
    if ((!['string', 'object'].includes(typeof privateKey)) || typeof issuerPublicKey !== 'string' || !issuerPublicKey.includes('BEGIN PUBLIC KEY')) throw new Error('RELEASE_VISUAL_ISSUER_SECRET_UNAVAILABLE');
    let derivedPublicKey; let pinnedPublicKey;
    try {
        derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
        pinnedPublicKey = createPublicKey(issuerPublicKey).export({ type: 'spki', format: 'der' });
    } catch { throw new Error('RELEASE_VISUAL_ISSUER_SECRET_UNAVAILABLE'); }
    if (!derivedPublicKey.equals(pinnedPublicKey)) throw new Error('RELEASE_VISUAL_ISSUER_SECRET_UNAVAILABLE');
    return (domain, payload) => sign(null, Buffer.from(`${domain}${canonicalJson(payload)}`, 'utf8'), privateKey).toString('base64url');
}
function protectedIssuerSigner() {
    return createIssuerSigner(process.env.RELEASE_VISUAL_ISSUER_PRIVATE_KEY, G009_ISSUER_PUBLIC_KEY);
}

export function scrubbedChildEnvironment(source = process.env) {
    const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'COMSPEC', 'PATHEXT', 'CI', 'LANG', 'LC_ALL'];
    return Object.fromEntries(allowed.filter((name) => typeof source[name] === 'string').map((name) => [name, source[name]]));
}

export function validateProducerFrame(value, expected) {
    exact(value, ['captureReceiptSha256', 'cellId', 'channelId', 'runNonce', 'version']);
    if (value.version !== 1 || value.channelId !== expected.channelId || value.runNonce !== expected.runNonce || value.cellId !== expected.cellId || !SHA256.test(value.captureReceiptSha256)) throw new Error('RELEASE_VISUAL_ISSUER_FRAME_INVALID');
    return value.captureReceiptSha256;
}
export function validateProducerCommit(value, expected, digest) {
    exact(value, ['captureReceiptSha256', 'cellId', 'channelId', 'runNonce', 'status', 'version']);
    if (value.version !== 2 || value.status !== 'ACKED' || value.channelId !== expected.channelId || value.runNonce !== expected.runNonce || value.cellId !== expected.cellId || value.captureReceiptSha256 !== digest) throw new Error('RELEASE_VISUAL_ISSUER_FRAME_INVALID');
}

export function buildReceiptChannel({ releaseId, certificationId, gitSha, channelId, runNonce, issuedAt, expiresAt, authReceipts, captureReceipts, captureChallenges, issuerBinding, signer, issuer }) {
    exact(issuer, ['keyId']);
    const unsigned = { schemaVersion: 4, claim: 'G009-release-visual-channel-v1', issuerKeyId: issuer.keyId, releaseId, certificationId, gitSha, channelId, runNonce, issuedAt, expiresAt, authReceipts, captureReceipts, captureChallenges, issuerBinding };
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(releaseId) || !/^[A-Za-z0-9._-]{1,128}$/.test(issuer.keyId) || !SHA256.test(certificationId) || !/^[a-f0-9]{40}$/.test(gitSha) || !/^[A-Za-z0-9_-]{16,64}$/.test(channelId) || !BASE64URL_32.test(runNonce) || Buffer.from(runNonce, 'base64url').length !== 32 || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt - issuedAt < 1 || expiresAt - issuedAt > 900 || typeof signer !== 'function') throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    for (const map of [authReceipts, captureReceipts]) if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some((value) => !SHA256.test(value))) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    if (!captureChallenges || typeof captureChallenges !== 'object' || Array.isArray(captureChallenges) || Object.values(captureChallenges).some((value) => !BASE64URL_32.test(value) || Buffer.from(value, 'base64url').length !== 32) || !issuerBinding || issuerBinding.commitSha !== gitSha || !SHA256.test(issuerBinding.manifestSha256)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    return { ...unsigned, issuerSignature: signer(G009_CHANNEL_DOMAIN, unsigned) };
}

export function runFramedChild({ executable, args, env, expected, timeoutMs = CHILD_TIMEOUT_MS }) {
    return new Promise((resolve, reject) => {
        let settled = false; let receiptDigest; let committed = false; let buffer = Buffer.alloc(0);
        const child = spawn(executable, args, { cwd: projectRoot, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'ignore', 'ignore', 'pipe'] });
        const terminate = () => {
            if (child.exitCode !== null) return;
            try {
                if (process.platform === 'win32') {
                    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
                    if (result.status !== 0 && child.exitCode === null) throw new Error('RELEASE_VISUAL_ISSUER_TEARDOWN_AMBIGUOUS');
                } else process.kill(-child.pid, 'SIGKILL');
            } catch {}
        };
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) { terminate(); reject(error); } else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('RELEASE_VISUAL_ISSUER_CHILD_TIMEOUT')), timeoutMs);
        child.stdio[3]?.on('data', (chunk) => {
            if (settled) return;
            buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
            while (buffer.length) {
                const newline = buffer.indexOf(10);
                if (newline < 0) { if (buffer.length > MAX_FRAME_BYTES) finish(new Error('RELEASE_VISUAL_ISSUER_FRAME_INVALID')); return; }
                if (newline > MAX_FRAME_BYTES || committed) return finish(new Error('RELEASE_VISUAL_ISSUER_FRAME_INVALID'));
                const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
                try {
                    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
                    if (!receiptDigest) {
                        receiptDigest = validateProducerFrame(value, expected);
                        if (!child.stdin || !child.stdin.writable) throw new Error('RELEASE_VISUAL_ISSUER_ACK_FAILED');
                        child.stdin.write(`ACK ${expected.channelId} ${expected.cellId}\n`, (error) => { if (error) finish(new Error('RELEASE_VISUAL_ISSUER_ACK_FAILED')); });
                    } else { validateProducerCommit(value, expected, receiptDigest); committed = true; }
                } catch { finish(new Error('RELEASE_VISUAL_ISSUER_FRAME_INVALID')); return; }
            }
        });
        child.once('error', () => finish(new Error('RELEASE_VISUAL_ISSUER_CHILD_FAILED')));
        child.once('close', (code, signal) => {
            if (code !== 0 || signal || !receiptDigest || !committed) finish(new Error('RELEASE_VISUAL_ISSUER_CHILD_FAILED'));
            else finish(null, receiptDigest);
        });
    });
}

function parseCli(argv) {
    const scalarNames = new Set(['--output-root', '--channel-output', '--release-id', '--certification-id', '--expected-git-sha', '--issued-at', '--expires-at']);
    const scalars = new Map();
    const maps = { origins: new Map(), deploymentIds: new Map(), deploymentReceipts: new Map(), authReceipts: new Map() };
    const flags = new Map([['--expected-origin', maps.origins], ['--deployment-id', maps.deploymentIds], ['--deployment-receipt-sha256', maps.deploymentReceipts], ['--auth-receipt-sha256', maps.authReceipts]]);
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (!flag || value === undefined) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
        if (flags.has(flag)) {
            const match = /^([A-Za-z0-9._-]{1,128})=(.+)$/.exec(value);
            const target = flags.get(flag);
            if (!match || target.has(match[1])) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
            target.set(match[1], match[2]);
        } else {
            if (!scalarNames.has(flag) || scalars.has(flag)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
            scalars.set(flag, value);
        }
    }
    if (scalars.size !== scalarNames.size || [...scalarNames].some((name) => !scalars.has(name))) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    return { scalars, ...maps };
}

function verifyCaptureFile(outputRoot, cell, expected, expectedDigest) {
    const directory = path.join(outputRoot, cell.id);
    const receiptPath = path.join(directory, 'capture-receipt.json');
    const metadataPath = path.join(directory, 'metadata.json');
    const receiptBytes = readTrustedFile(receiptPath, `${cell.id} receipt`, outputRoot);
    const metadataBytes = readTrustedFile(metadataPath, `${cell.id} metadata`, outputRoot);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    const digest = createHash('sha256').update(`tzudong:release-visual-capture-receipt:v1\n${canonicalJson(receipt)}`).digest('hex');
    if (digest !== expectedDigest || metadata?.captureReceiptSha256 !== digest || receipt?.cellId !== cell.id || receipt?.releaseId !== expected.releaseId || receipt?.certificationId !== expected.certificationId || receipt?.gitSha !== expected.gitSha || receipt?.deploymentId !== expected.deploymentId || receipt?.deploymentReceiptSha256 !== expected.deploymentReceiptSha256 || receipt?.origin !== expected.origin || receipt?.challenge !== expected.challenge || receipt?.issuedAt !== expected.issuedAt || receipt?.expiresAt !== expected.expiresAt) throw new Error('RELEASE_VISUAL_ISSUER_EVIDENCE_INVALID');
}

async function main() {
    const cli = parseCli(process.argv.slice(2));
    const outputRoot = externalDirectory(cli.scalars.get('--output-root')).resolved;
    const channelOutput = path.resolve(cli.scalars.get('--channel-output'));
    const releaseId = cli.scalars.get('--release-id');
    const certificationId = cli.scalars.get('--certification-id');
    const requestedGitSha = cli.scalars.get('--expected-git-sha');
    const issuerBinding = trustedIssuerBinding(requestedGitSha);
    const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).stdout.trim();
    const issuedAt = Number(cli.scalars.get('--issued-at'));
    const expiresAt = Number(cli.scalars.get('--expires-at'));
    const now = Math.floor(Date.now() / 1000);
    const signer = protectedIssuerSigner();
    if (gitSha !== requestedGitSha || !/^[a-f0-9]{40}$/.test(gitSha) || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || now < issuedAt - 60 || now > expiresAt) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const templateBytes = readTrustedFile(templatePath, 'template');
    if (createHash('sha256').update(templateBytes).digest('hex') !== G009_TEMPLATE_SHA256) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const template = JSON.parse(templateBytes.toString('utf8'));
    if (template.schemaVersion !== 5 || !Array.isArray(template.cells)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    const screenshotCells = template.cells.filter((cell) => cell.requirement === 'required' && cell.evidence === 'screenshot');
    const authCells = template.cells.filter((cell) => cell.execution === 'standalone-auth');
    if (cli.authReceipts.size !== authCells.length || authCells.some((cell) => !SHA256.test(cli.authReceipts.get(cell.id))) || [...cli.authReceipts.keys()].some((id) => !authCells.some((cell) => cell.id === id))) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    for (const environment of ['local', 'preview', 'production', 'alias']) {
        if (!cli.origins.has(environment) || !cli.deploymentIds.has(environment) || !cli.deploymentReceipts.has(environment)) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
        strictOrigin(cli.origins.get(environment), environment);
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(cli.deploymentIds.get(environment)) || !SHA256.test(cli.deploymentReceipts.get(environment))) throw new Error('RELEASE_VISUAL_ISSUER_INVALID');
    }
    const runNonce = randomBytes(32).toString('base64url');
    const channelId = `release-visual-${randomBytes(18).toString('base64url')}`;
    const captures = {};
    const captureChallenges = {};
    for (const cell of screenshotCells) {
        const origin = strictOrigin(cli.origins.get(cell.environment), cell.environment);
        const challenge = randomBytes(32).toString('base64url');
        captureChallenges[cell.id] = challenge;
        const expected = { channelId, runNonce, cellId: cell.id, releaseId, certificationId, gitSha, deploymentId: cli.deploymentIds.get(cell.environment), deploymentReceiptSha256: cli.deploymentReceipts.get(cell.environment), origin: origin.origin, issuedAt, expiresAt, challenge };
        const childEnvironment = {
            ...scrubbedChildEnvironment(),
            RELEASE_VISUAL_TARGET: cell.environment === 'local' ? 'localhost' : 'remote',
            RELEASE_VISUAL_CELL_ID: cell.id,
            RELEASE_VISUAL_OUTPUT_DIR: outputRoot,
            RELEASE_VISUAL_EXPECTED_ORIGIN: origin.origin,
            RELEASE_VISUAL_DEPLOYMENT_ID: expected.deploymentId,
            RELEASE_VISUAL_DEPLOYMENT_RECEIPT_SHA256: expected.deploymentReceiptSha256,
            RELEASE_VISUAL_DEPLOYMENT_ENVIRONMENT: cell.environment,
            RELEASE_VISUAL_RELEASE_ID: releaseId,
            RELEASE_VISUAL_CERTIFICATION_ID: certificationId,
            RELEASE_VISUAL_EXPECTED_GIT_SHA: gitSha,
            RELEASE_VISUAL_CAPTURE_CHALLENGE: challenge,
            RELEASE_VISUAL_CAPTURE_ISSUED_AT: String(issuedAt),
            RELEASE_VISUAL_CAPTURE_EXPIRES_AT: String(expiresAt),
            RELEASE_VISUAL_RECEIPT_CHANNEL_FD: '3',
            RELEASE_VISUAL_RECEIPT_ACK_FD: '0',
            RELEASE_VISUAL_RECEIPT_CHANNEL_ID: channelId,
            RELEASE_VISUAL_RUN_NONCE: runNonce,
            ...(cell.environment === 'local' ? { RELEASE_SYNTHETIC_BASE_URL: origin.origin } : { RELEASE_PUBLIC_BASE_URL: origin.origin, RELEASE_PUBLIC_EXPECTED_HOSTNAME: origin.hostname }),
        };
        const project = cell.environment === 'local' ? 'release-localhost-synthetic-chromium' : 'release-public-remote-chromium';
        const digest = await runFramedChild({ executable: process.execPath, args: [playwrightCli, 'test', '--config', playwrightConfig, '--project', project, '--workers', '1'], env: childEnvironment, expected });
        verifyCaptureFile(outputRoot, cell, expected, digest);
        captures[cell.id] = digest;
    }
    const channel = buildReceiptChannel({ releaseId, certificationId, gitSha, channelId, runNonce, issuedAt, expiresAt, authReceipts: Object.fromEntries([...cli.authReceipts.entries()].sort()), captureReceipts: Object.fromEntries(Object.entries(captures).sort()), captureChallenges: Object.fromEntries(Object.entries(captureChallenges).sort()), issuerBinding, signer, issuer: { keyId: G009_ISSUER_KEY_ID } });
    writeExclusive(channelOutput, Buffer.from(`${canonicalJson(channel)}\n`, 'utf8'));
    process.stdout.write('release visual evidence issued\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        process.stderr.write('RELEASE_VISUAL_ISSUER_FAILED\n');
        process.exitCode = 1;
    });
}
