import { expect, test } from 'bun:test';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { assembleReleaseVisualEvidence, G009_ISSUER_KEY_ID, G009_ISSUER_PUBLIC_KEY, validateReleaseVisualMetadata as validateAssemblyMetadata } from '../scripts/assemble-release-visual-evidence.mjs';
import { G009_VERIFIER_PUBLIC_KEY, signVerificationPayload, validateReleaseVisualMetadata as validateVerifierMetadata } from '../scripts/verify-release-visual-evidence.mjs';
import { buildReceiptChannel, G009_ISSUER_PATHS, runFramedChild, scrubbedChildEnvironment, trustedIssuerBinding } from '../scripts/run-release-visual-evidence.mjs';
import { parseJson as parseFinalEvidenceJson } from '../scripts/verify-final-release-evidence.mjs';

const webRoot = path.resolve(import.meta.dir, '..');
const receiptChannels = new Map<string, {
    authReceipts: Record<string, string>;
    captureReceipts: Record<string, string>;
    captureChallenges: Record<string, string>;
}>();
const TEST_ISSUER_PRIVATE_KEY = createPrivateKey({ key: { crv: 'Ed25519', d: 'pyAD8ShNzexH4bWBgxYyDV02_9J6eeVtrPV3AKOq8x8', x: 'SYCBPb3Ev_MnmZFItODcJ8Qz9gf1ty28rPwxRVy-Oqc', kty: 'OKP' }, format: 'jwk' });
const TEST_ISSUER_PUBLIC_KEY = createPublicKey(TEST_ISSUER_PRIVATE_KEY).export({ type: 'spki', format: 'pem' }).toString();
const TEST_ISSUER_KEY_ID = 'test-release-visual-issuer-ed25519';
const TEST_ISSUER_TRUST_ROOT = { keyId: TEST_ISSUER_KEY_ID, publicKey: TEST_ISSUER_PUBLIC_KEY };
const TEST_VERIFIER_PRIVATE_KEY = createPrivateKey({ key: { crv: 'Ed25519', d: 'xaqN9D-fg3vtt0QvMdy3sWbThTUHbwlLhc46LgtEWPc', x: '_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU', kty: 'OKP' }, format: 'jwk' });
const TEST_VERIFIER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU=
-----END PUBLIC KEY-----`;
const testIssuerSigner = (domain: string, payload: unknown) => sign(null, Buffer.from(`${domain}${canonicalJson(payload)}`, 'utf8'), TEST_ISSUER_PRIVATE_KEY).toString('base64url');
const spawnSync = (command: string, args: string[], options: Record<string, unknown> = {}) => {
    if (command === process.execPath && args[0] === 'scripts/assemble-release-visual-evidence.mjs') {
        try {
            assembleReleaseVisualEvidence(['node', ...args], TEST_ISSUER_TRUST_ROOT);
            return { status: 0, stderr: '', stdout: 'release visual evidence assembled\n' };
        } catch {
            return { status: 1, stderr: 'RELEASE_VISUAL_ASSEMBLY_FAILED\n', stdout: '' };
        }
    }
    return nodeSpawnSync(command, args, {
        env: {
            ...process.env,
        },
        ...options,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
    });
};
const read = (file: string) => readFileSync(path.join(webRoot, file), 'utf8');
const issuerBinding = () => {
    const executableDigests = Object.fromEntries(G009_ISSUER_PATHS.map((file) => [file, createHash('sha256').update(read(file)).digest('hex')]));
    const manifest = { schemaVersion: 1, commitSha: 'b'.repeat(40), treeSha: 'c'.repeat(40), executableDigests };
    return { ...manifest, manifestSha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex') };
};
const crc32 = (bytes: Buffer) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; };
const pngChunk = (type: string, data: Buffer) => { const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 4, 'ascii'); data.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)), data.length + 8); return chunk; };
const fixturePng = (width: number, height: number, masked: boolean, options: { ancillary?: boolean; misordered?: boolean; splitIdat?: boolean; transparent?: boolean; oversized?: boolean; maskAbuse?: boolean } = {}) => { const channels = options.transparent ? 4 : 3; const stride = width * channels; const raw = Buffer.alloc(height * (stride + 1)); const varied = Math.ceil(width * height * 0.02); for (let y = 0; y < height; y += 1) { const row = y * (stride + 1); raw[row] = 0; for (let x = 0; x < width; x += 1) { const pixel = row + 1 + x * channels; if (channels === 4) raw[pixel + 3] = 255; if (y * width + x < varied) { raw[pixel] = 1; raw[pixel + 2] = 2; } if (options.maskAbuse && x < Math.ceil(width / 2)) { raw[pixel] = 255; raw[pixel + 1] = 0; raw[pixel + 2] = 255; if (channels === 4) raw[pixel + 3] = 255; } } } if (masked) { raw[1] = 255; raw[2] = 0; raw[3] = 255; if (channels === 4) raw[4] = 255; } if (options.transparent) raw[1 + channels + 3] = 0; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; const idat = deflateSync(raw); const chunks = options.misordered ? [pngChunk('IDAT', idat), pngChunk('IHDR', ihdr)] : options.splitIdat ? [pngChunk('IHDR', ihdr), pngChunk('IDAT', idat.subarray(0, Math.floor(idat.length / 2))), pngChunk('tEXt', Buffer.from('hidden=data')), pngChunk('IDAT', idat.subarray(Math.floor(idat.length / 2)))] : [pngChunk('IHDR', ihdr), ...(options.ancillary ? [pngChunk('tEXt', Buffer.from('hidden=data'))] : []), pngChunk('IDAT', idat)]; const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, pngChunk('IEND', Buffer.alloc(0))]); return options.oversized ? Buffer.concat([png, Buffer.alloc(16 * 1024 * 1024)]) : png; };
const bindingFor = (cell: any) => ({ local: { origin: 'http://localhost:3000', deploymentId: 'dpl_local', receipt: 'e'.repeat(64) }, preview: { origin: 'https://tzudong-preview.vercel.app', deploymentId: 'dpl_preview', receipt: 'd'.repeat(64) }, production: { origin: 'https://tzudong-deployment.vercel.app', deploymentId: 'dpl_production', receipt: 'c'.repeat(64) }, alias: { origin: 'https://tzudong.app', deploymentId: 'dpl_production', receipt: 'c'.repeat(64) } })[cell.environment];
const visualMetadata = (cell: any) => { const binding = bindingFor(cell); const mobile = cell.contract.mode === 'reduced-motion-mobile'; const unchecked = mobile ? [] : cell.contract.unchecked; const focus = (documentIndex: number, { dialogIndex = -1, inDialog = false, isTrigger = false, focusVisible = true } = {}) => ({ documentIndex, dialogIndex, inDialog, isTrigger, focusVisible }); const initial = focus(0, { isTrigger: true, focusVisible: false }); const forward = [focus(1), focus(2)]; const backward = [focus(1), focus(0, { isTrigger: true })]; const dialogFirst = focus(10, { dialogIndex: 0, inDialog: true }); const dialogLast = focus(11, { dialogIndex: 1, inDialog: true }); const interaction = mobile ? { selectors: { searchTrigger: cell.contract.searchTrigger, searchDialog: cell.contract.searchDialog, appShell: cell.contract.appShell, navigation: cell.contract.navigation, safeAreaOwner: cell.contract.safeAreaOwner }, tabTrace: { initial, forward, backward }, navigation: { before: new URL(cell.route, `${binding.origin}/`).toString(), after: new URL(cell.route, `${binding.origin}/`).toString() }, dialog: { beforeCount: 0, afterOpenCount: 1, tabbableCount: 2, activeDuringTrap: dialogLast, tabForwardAfter: dialogFirst, tabBackwardAfter: dialogLast, afterEscapeCount: 0, activeAfterEscape: focus(0, { isTrigger: true }), restoredTo: initial }, geometry: { appShell: { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 }, navigation: { left: 0, top: 800, right: 390, bottom: 844, width: 390, height: 44 }, safeAreaOwner: { left: 0, top: 700, right: 390, bottom: 800, width: 390, height: 100 } } } : { selectors: 'unchecked', tabTrace: 'unchecked', navigation: 'unchecked', dialog: 'unchecked', geometry: 'unchecked' }; return { route: cell.route, viewport: cell.viewport, originBinding: { releaseId: 'release-test', certificationId: 'a'.repeat(64), expectedGitSha: 'b'.repeat(40), environment: cell.environment, expectedOrigin: binding.origin, observedOrigin: binding.origin, observedPath: cell.route, deploymentId: binding.deploymentId, deploymentReceiptSha256: binding.receipt }, responsive: { devicePixelRatio: cell.viewport.deviceScaleFactor, hasHorizontalOverflow: false, reducedMotion: mobile, shellMatchesViewport: mobile ? true : 'unchecked', maxAnimationDurationMs: mobile ? 0 : 'unchecked', maxTransitionDurationMs: mobile ? 0 : 'unchecked' }, accessibility: { documentLanguage: true, documentTitle: true, duplicateIds: 0, imagesWithoutAlt: 0, keyboardNavigation: mobile ? true : 'unchecked', visibleFocus: mobile ? true : 'unchecked', focusTrap: mobile ? true : 'unchecked', focusRestore: mobile ? true : 'unchecked', escapeCloses: mobile ? true : 'unchecked' }, surfaces: mobile ? { map: 'visible', modal: 'closed', sheet: 'closed' } : { map: 'unchecked', modal: 'unchecked', sheet: 'unchecked' }, interaction, unchecked, maskProof: cell.masks.map((selector: string) => ({ selector, redacted: true, box: { x: 0, y: 0, width: 1, height: 1 } })), consoleErrors: [], pageErrors: [], requestErrors: [], httpErrors: [], hydrationErrors: [] }; };
const trustedVisualMetadata = () => {
    const bindings = ['local', 'preview', 'production', 'alias'].map((environment) => [environment, bindingFor({ environment })] as const);
    return {
        releaseId: 'release-test',
        certificationId: 'a'.repeat(64),
        gitSha: 'b'.repeat(40),
        origins: new Map(bindings.map(([environment, binding]) => [environment, binding.origin])),
        deploymentIds: new Map(bindings.map(([environment, binding]) => [environment, binding.deploymentId])),
        deploymentReceipts: new Map(bindings.map(([environment, binding]) => [environment, binding.receipt])),
    };
};
const fixtureNow = Math.floor(Date.now() / 1000);
const canonicalJson = (value: any): string => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}` : JSON.stringify(value);
const receiptHash = (payload: any) => createHash('sha256').update(`tzudong:release-auth-receipt:v1\n${canonicalJson(payload)}`).digest('hex');
const verificationReceiptHash = (receipt: any) => createHash('sha256').update(`tzudong:g009:release-visual-verification:v3\n${canonicalJson(receipt)}`).digest('hex');
const captureReceiptHash = (receipt: any) => createHash('sha256').update(`tzudong:release-visual-capture-receipt:v1\n${canonicalJson(receipt)}`).digest('hex');
const revocationReceipt = 'e'.repeat(64);
const VERIFICATION_DOMAIN = 'tzudong:g009:release-visual-verification:v3\n';
const ISSUER_PUBLIC_KEY = TEST_ISSUER_PUBLIC_KEY;
const fixedVerificationReceiptBody = {
    schemaVersion: 3,
    kind: 'release-visual-verification-v3',
    claim: 'G009-release-visual-evidence-v1',
    domainSeparator: 'tzudong:g009:release-visual-verification:v3',
    verifierKeyId: 'g009-release-visual-verifier-ed25519-2026-07',
    releaseId: 'fixture-release',
    certificationId: 'a'.repeat(64),
    gitSha: 'b'.repeat(40),
    verifiedAt: 1780000000,
    expiresAt: 1780000300,
    verificationNonce: 'c'.repeat(43),
    channelId: 'fixture-channel',
    runNonce: 'd'.repeat(43),
    channelSha256: 'e'.repeat(64),
    issuerBinding: { commitSha: 'b'.repeat(40), treeSha: 'f'.repeat(40), manifestSha256: 'a'.repeat(64), schemaVersion: 1, executableDigests: {} },
    ledgerSha256: '1'.repeat(64),
    bundleSha256: '2'.repeat(64),
    actualArtifactHashes: { 'fixture.png': '3'.repeat(64) },
    authReceiptSha256: { fixture: '4'.repeat(64) },
};
const fixedVerificationReceipt = {
    ...fixedVerificationReceiptBody,
    receiptSha256: 'cf89366d22e1e94369713db9218ce4b917daf29b0de036f1e15e866ed82db7f1',
    verifierSignature: 'RSjWiPm5ENhtBbWUWzSnbSOE6JDS84T2ot3gYogSn_ZjuUUdSdvk9Ntu-QlgnE90Q9V_jFsUn8hMpwMD2WNdAA',
};
test('verifier identity is independently pinned and final signatures bind the exact G009 v3 payload', () => {
    const { verifierSignature, ...signedPayload } = fixedVerificationReceipt;
    const bytes = Buffer.from(`${VERIFICATION_DOMAIN}${canonicalJson(signedPayload)}`, 'utf8');
    expect(fixedVerificationReceipt.receiptSha256).toBe(verificationReceiptHash(fixedVerificationReceiptBody));
    expect(G009_VERIFIER_PUBLIC_KEY).not.toBe(ISSUER_PUBLIC_KEY);
    expect(verify(null, bytes, G009_VERIFIER_PUBLIC_KEY, Buffer.from(verifierSignature, 'base64url'))).toBe(true);
    expect(verify(null, bytes, ISSUER_PUBLIC_KEY, Buffer.from(verifierSignature, 'base64url'))).toBe(false);
    expect(verify(null, Buffer.from(`${VERIFICATION_DOMAIN}${canonicalJson({ ...signedPayload, claim: 'G009-mutated' })}`, 'utf8'), G009_VERIFIER_PUBLIC_KEY, Buffer.from(verifierSignature, 'base64url'))).toBe(false);
    expect(verify(null, Buffer.from(`${VERIFICATION_DOMAIN}${canonicalJson({ ...signedPayload, receiptSha256: '0'.repeat(64) })}`, 'utf8'), G009_VERIFIER_PUBLIC_KEY, Buffer.from(verifierSignature, 'base64url'))).toBe(false);

    const testSignature = signVerificationPayload(signedPayload, TEST_VERIFIER_PRIVATE_KEY, TEST_VERIFIER_PUBLIC_KEY);
    expect(verify(null, bytes, TEST_VERIFIER_PUBLIC_KEY, Buffer.from(testSignature, 'base64url'))).toBe(true);
    expect(() => signVerificationPayload(signedPayload, TEST_ISSUER_PRIVATE_KEY, TEST_VERIFIER_PUBLIC_KEY)).toThrow('verification signer identity mismatch');
    expect(() => signVerificationPayload(signedPayload, 'malformed', TEST_VERIFIER_PUBLIC_KEY)).toThrow('verification signer is unavailable');
    expect(() => signVerificationPayload(signedPayload, undefined, TEST_VERIFIER_PUBLIC_KEY)).toThrow('verification signer is unavailable');
});

test('assembly injection accepts only a separate test issuer and source fixtures retain no private PEM or compromised issuer pin', () => {
    expect(TEST_ISSUER_KEY_ID).not.toBe(G009_ISSUER_KEY_ID);
    expect(TEST_ISSUER_PUBLIC_KEY).not.toBe(G009_ISSUER_PUBLIC_KEY);
    const compromisedIssuerKeyId = ['g009-release-visual-issuer-', 'ed25519-2026-07'].join('');
    const compromisedIssuerPublicPin = ['MCowBQYDK2VwAyEA11qYAYKxCrfVS/', '7TyWQHOg7hcvPapiMlrwIaaPcHURo='].join('');
    const privatePem = new RegExp(`-----BEGIN ${'PRIVATE KEY'}-----`);
    const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : /\.(?:[cm]?js|ts|json)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
    for (const directory of ['scripts', 'tests', 'tests-unit']) {
        for (const file of sourceFiles(path.join(webRoot, directory))) {
            const source = readFileSync(file, 'utf8');
            expect(source).not.toMatch(privatePem);
            expect(source).not.toContain(compromisedIssuerKeyId);
            expect(source).not.toContain(compromisedIssuerPublicPin);
        }
    }
}, 60_000);
const authMetadata = (cell: any) => {
    const now = fixtureNow;
    const production = cell.environment !== 'preview';
    const host = production ? 'tzudong-deployment.vercel.app' : 'tzudong-preview.vercel.app';
    const aliasHost = production ? 'tzudong.app' : host;
    const expectedHost = cell.environment === 'alias' ? aliasHost : host;
    const operationPrefix = cell.environment === 'preview' ? '3' : cell.environment === 'production' ? '4' : '5';
    const release = { releaseId: 'release-test', certificationId: 'a'.repeat(64), gitSha: 'b'.repeat(40), challenge: createHash('sha256').update(cell.id).digest('base64url'), issuedAt: now - 5, expiresAt: now + 300 };
    const item = { id: cell.id, environment: cell.environment, route: '/admin', origin: `https://${expectedHost}/`, finalUrl: `https://${expectedHost}/admin` };
    const deployment = { receiptSha256: production ? 'c'.repeat(64) : 'd'.repeat(64), deploymentId: production ? 'dpl_production' : 'dpl_preview', environment: production ? 'production' : 'preview', host, aliasHost, observedAt: now - 4 };
    const result: any = { ok: true, reasonCode: 'OK', authProofSha256: 'f'.repeat(64), revocationOperationId: `${operationPrefix.repeat(8)}-${operationPrefix.repeat(4)}-4${operationPrefix.repeat(3)}-8${operationPrefix.repeat(3)}-${operationPrefix.repeat(12)}`, revocationReceipt, shellHeight: 900, shellWidth: 1440, headingCount: 1, navigationCount: 1, status: 200, capturedAt: now - 3 };
    result.revocationBindingSha256 = createHash('sha256').update(`tzudong:release-auth-revocation-binding:v1\n${canonicalJson({ releaseId: release.releaseId, certificationId: release.certificationId, gitSha: release.gitSha, cellId: item.id, origin: item.origin, challenge: release.challenge, issuedAt: release.issuedAt, expiresAt: release.expiresAt, deploymentReceiptSha256: deployment.receiptSha256, capturedAt: result.capturedAt, authProofSha256: result.authProofSha256, revocationOperationId: result.revocationOperationId, outcome: 'certified' })}`).digest('hex');
    const payload = { release, cell: item, deployment, result };
    return { receiptVersion: 1, receiptSha256: receiptHash(payload), payload };
};
let receiptChannelCounter = 0;
const authArgs = (cells: string, output: string, verify = false) => {
    const trustedMap = receiptChannels.get(cells);
    if (!trustedMap) throw new Error('fixture did not provide issuer receipt channel');
    receiptChannelCounter += 1;
    const channelId = `release-visual-channel-${String(receiptChannelCounter).padStart(6, '0')}`;
    const runNonce = createHash('sha256').update(`run:${receiptChannelCounter}:${cells}`).digest('base64url');
    const channel = path.join(path.dirname(cells), `issuer-receipt-channel-${receiptChannelCounter}.json`);
    const nonceDirectory = path.resolve(webRoot, '..', '.release-visual-protected-replay');
    mkdirSync(nonceDirectory, { recursive: true });
    const unsigned = {
        schemaVersion: 4,
        claim: 'G009-release-visual-channel-v1',
        issuerKeyId: TEST_ISSUER_KEY_ID,
        releaseId: 'release-test',
        certificationId: 'a'.repeat(64),
        gitSha: 'b'.repeat(40),
        channelId,
        runNonce,
        issuedAt: fixtureNow - 5,
        expiresAt: fixtureNow + 300,
        authReceipts: trustedMap.authReceipts,
        captureReceipts: trustedMap.captureReceipts,
        captureChallenges: trustedMap.captureChallenges,
        issuerBinding: issuerBinding(),
    };
    const issuerSignature = testIssuerSigner('tzudong:g009:release-visual-channel:v1\n', unsigned);
    writeFileSync(channel, JSON.stringify({ ...unsigned, issuerSignature }), { flag: 'wx' });
    const trusted = ['local', 'preview', 'production', 'alias'].flatMap((environment) => {
        const binding = bindingFor({ environment });
        return [
            '--expected-origin', environment + '=' + binding.origin,
            '--deployment-id', environment + '=' + binding.deploymentId,
            '--deployment-receipt-sha256', environment + '=' + binding.receipt,
        ];
    });
    return [
        verify ? '--ledger' : '--cells',
        verify ? output : cells,
        ...(verify
            ? ['--bundle-output', path.join(path.dirname(output), `verification-bundle-${receiptChannelCounter}.json`)]
            : ['--output', output]),
        '--release-id', 'release-test',
        '--certification-id', 'a'.repeat(64),
        '--expected-git-sha', 'b'.repeat(40),
        '--receipt-channel', channel,
        ...trusted,
    ];
};
const rewriteAuthMetadata = (cells: string, id: string, mutate: (metadata: any) => void) => {
    const file = path.join(cells, id, 'metadata.json');
    const record = JSON.parse(readFileSync(file, 'utf8'));
    mutate(record.metadata);
    if (record.metadata?.payload) record.metadata.receiptSha256 = receiptHash(record.metadata.payload);
    writeFileSync(file, JSON.stringify(record));
    return record.metadata?.receiptSha256 as string;
};
test('bounded child timeout is distinct from a semantic validator rejection', () => {
    const hanging = nodeSpawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { encoding: 'utf8', timeout: 100, maxBuffer: 1024 });
    expect(hanging.status).toBeNull();
    expect(hanging.error?.code).toBe('ETIMEDOUT');
    expect(hanging.signal).toBe('SIGTERM');
});
const createFixture = (
    root: string,
    override: (record: any, cell: any) => any = (record) => record,
    pngForCell: (cell: any) => Buffer = (cell) =>
        fixturePng(cell.viewport.width, cell.viewport.height, cell.masks.length > 0),
) => {
    const cells = path.join(root, 'cells');
    const trusted = {
        authReceipts: {} as Record<string, string>,
        captureReceipts: {} as Record<string, string>,
        captureChallenges: {} as Record<string, string>,
    };
    mkdirSync(cells);
    const template = JSON.parse(read('tests/release-visual-cells.template.json')) as { cells: Array<any> };
    for (const cell of template.cells) {
        const directory = path.join(cells, cell.id);
        mkdirSync(directory);
        const base = {
            schemaVersion: 5,
            id: cell.id,
            status: cell.requirement,
            execution: cell.execution,
            evidence: cell.evidence,
            artifact: cell.artifact,
            sha256: cell.requirement === 'N/A' ? 'N/A' : cell.evidence === 'metadata-only' ? 'metadata-only' : '',
            captureReceiptSha256:
                cell.requirement === 'N/A' ? 'N/A' : cell.evidence === 'metadata-only' ? 'metadata-only' : '',
            metadata: cell.execution === 'standalone-auth' ? authMetadata(cell) : visualMetadata(cell),
        };
        const record = override(base, cell);
        if (cell.execution === 'standalone-auth') trusted.authReceipts[cell.id] = record.metadata.receiptSha256;
        if (cell.requirement === 'required' && cell.evidence === 'screenshot') {
            const png = pngForCell(cell);
            record.sha256 = createHash('sha256').update(png).digest('hex');
            const binding = bindingFor(cell);
            const receipt = {
                version: 1,
                cellId: cell.id,
                environment: cell.environment,
                releaseId: 'release-test',
                certificationId: 'a'.repeat(64),
                gitSha: 'b'.repeat(40),
                deploymentId: binding.deploymentId,
                deploymentReceiptSha256: binding.receipt,
                origin: binding.origin,
                route: cell.route,
                finalUrl: new URL(cell.route, `${binding.origin}/`).toString(),
                artifactSha256: record.sha256,
                metadataSha256: createHash('sha256').update(canonicalJson(record.metadata)).digest('hex'),
                challenge: createHash('sha256').update(`capture:${cell.id}`).digest('base64url'),
                issuedAt: fixtureNow - 5,
                capturedAt: fixtureNow - 3,
                expiresAt: fixtureNow + 300,
            };
            record.captureReceiptSha256 = captureReceiptHash(receipt);
            trusted.captureReceipts[cell.id] = record.captureReceiptSha256;
            trusted.captureChallenges[cell.id] = receipt.challenge;
            writeFileSync(path.join(directory, cell.artifact), png);
            writeFileSync(path.join(directory, 'capture-receipt.json'), JSON.stringify(receipt));
        }
        writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(record));
    }
    receiptChannels.set(cells, trusted);
    return cells;
};

test('synthetic isolated cells fail closed when a frozen cell remains access blocked', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-'));
    try {
        const cells = path.join(root, 'cells');
        mkdirSync(cells);
        const template = JSON.parse(read('tests/release-visual-cells.template.json')) as { schemaVersion: number; cells: Array<any> };
        for (const cell of template.cells) mkdirSync(path.join(cells, cell.id));
        const blocked = template.cells[0];
        const directory = path.join(cells, blocked.id);
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        writeFileSync(path.join(directory, blocked.artifact), png);
        writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({
            schemaVersion: 5,
            id: blocked.id,
            status: 'access_blocked',
            execution: blocked.execution,
            evidence: blocked.evidence,
            artifact: blocked.artifact,
            sha256: createHash('sha256').update(png).digest('hex'),
            captureReceiptSha256: 'a'.repeat(64),
            metadata: {
                route: blocked.route,
                viewport: blocked.viewport,
                responsive: { devicePixelRatio: blocked.viewport.deviceScaleFactor, hasHorizontalOverflow: false },
                accessibility: { documentLanguage: true, documentTitle: true, duplicateIds: 0, imagesWithoutAlt: 0 },
                maskProof: [],
                consoleErrors: [],
                pageErrors: [],
                requestErrors: [],
                httpErrors: [],
                hydrationErrors: [],
            },
        }));
        const result = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', '--cells', cells, '--output', path.join(root, 'ledger.json')], { cwd: webRoot, encoding: 'utf8' });
        expect(result.status).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('visual runner is one-cell, external, masked, recorder-free, and ESM-safe', () => {
    const source = read('tests/release-visual.spec.ts');
    expect(source).toContain('RELEASE_VISUAL_CELL_ID is required');
    expect(source).toContain('RELEASE_VISUAL_OUTPUT_DIR must be an absolute external directory');
    expect(source).toContain("path.resolve(process.cwd(), 'tests')");
    expect(source).not.toContain('import.meta');
    expect(source).not.toContain('require(');
    expect(source).toContain('test.skip(testInfo.project.name !== expectedProject');
    expect(source).toContain("fullPage: false, mask: masks, maskColor: '#FF00FF'");
    expect(source).toContain('document.documentElement.scrollWidth > window.innerWidth');
    expect(source).not.toContain('storageState');
    expect(source).not.toContain('recordHar');
    expect(source).toContain("cell.execution === 'standalone-auth'");
    expect(source).toContain("release-localhost-synthetic-chromium");
    expect(source).not.toContain('RELEASE_VISUAL_RECEIPT_CHANNEL_KEY');
    expect(source).toContain("RELEASE_VISUAL_RECEIPT_ACK_FD");
    const issuer = read('scripts/run-release-visual-evidence.mjs');
    expect(issuer).toContain('scrubbedChildEnvironment');
    expect(issuer).toContain("stdio: ['pipe', 'ignore', 'ignore', 'pipe']");
    expect(issuer).not.toContain('RELEASE_VISUAL_RECEIPT_CHANNEL_KEY');
    expect(issuer).toContain('RELEASE_VISUAL_ISSUER_PRIVATE_KEY');
    expect(issuer).toContain('issuerSignature');
    expect(read('playwright.release.config.ts')).not.toContain("trace: 'retain-on-failure'");
});
test('issuer binding hashes exact Git blob bytes and terminal checkout comparison rejects one-byte changes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-issuer-binding-'));
    const gitText = (args: string[]) => {
        const result = nodeSpawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
        if (result.status !== 0 || typeof result.stdout !== 'string') throw new Error(`git ${args.join(' ')} failed`);
        return result.stdout;
    };
    const gitBlob = (args: string[]) => {
        const result = nodeSpawnSync('git', args, { cwd: root, encoding: 'buffer', windowsHide: true, maxBuffer: 1024 * 1024 });
        if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error(`git ${args.join(' ')} failed`);
        return result.stdout;
    };
    try {
        gitText(['init', '--quiet']);
        gitText(['config', 'core.autocrlf', 'false']);
        gitText(['config', 'user.email', 'release-visual-test@example.invalid']);
        gitText(['config', 'user.name', 'Release Visual Test']);
        const rawBlobs = new Map<string, Buffer>([
            ['scripts/run-release-visual-evidence.mjs', Buffer.from(' \tleading LF and trailing whitespace \t\n', 'utf8')],
            ['scripts/assemble-release-visual-evidence.mjs', Buffer.from('\tleading CRLF and trailing whitespace \t\r\n', 'utf8')],
            ['scripts/verify-release-visual-evidence.mjs', Buffer.from('  leading spaces\ntrailing spaces  \n', 'utf8')],
            ['tests/release-visual.spec.ts', Buffer.from('\tleading tabs\r\ntrailing tabs\t\r\n', 'utf8')],
            ['playwright.release.config.ts', Buffer.from(' leading LF \n', 'utf8')],
            ['tests/release-visual-cells.template.json', Buffer.from('\tleading CRLF\t\r\n', 'utf8')],
        ]);
        expect([...rawBlobs.keys()]).toEqual([...G009_ISSUER_PATHS]);
        for (const [relative, bytes] of rawBlobs) {
            const destination = path.join(root, relative);
            mkdirSync(path.dirname(destination), { recursive: true });
            writeFileSync(destination, bytes);
        }
        gitText(['add', '--', ...G009_ISSUER_PATHS]);
        gitText(['commit', '--quiet', '-m', 'raw issuer blobs']);
        const gitSha = gitText(['rev-parse', 'HEAD']).trim();
        const binding = trustedIssuerBinding(gitSha, root);
        const terminalCheckoutMatches = () => Object.entries(binding.executableDigests).every(([relative, digest]) => createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex') === digest);
        const { manifestSha256, ...manifest } = binding;
        expect(manifestSha256).toBe(createHash('sha256').update(canonicalJson(manifest)).digest('hex'));
        for (const [relative, bytes] of rawBlobs) {
            const rawBlob = gitBlob(['show', `${gitSha}:${relative}`]);
            const rawDigest = createHash('sha256').update(bytes).digest('hex');
            const trimmedTextDigest = createHash('sha256').update(bytes.toString('utf8').trim(), 'utf8').digest('hex');
            expect(rawBlob.equals(bytes)).toBe(true);
            expect(binding.executableDigests[relative]).toBe(rawDigest);
            expect(binding.executableDigests[relative]).not.toBe(trimmedTextDigest);
        }
        expect(terminalCheckoutMatches()).toBe(true);
        const changedPath = path.join(root, G009_ISSUER_PATHS[0]);
        const changedBytes = Buffer.from(readFileSync(changedPath));
        changedBytes[0] ^= 1;
        writeFileSync(changedPath, changedBytes);
        expect(terminalCheckoutMatches()).toBe(false);
        expect(() => trustedIssuerBinding(gitSha, root)).toThrow('RELEASE_VISUAL_ISSUER_GIT_INVALID');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 15_000);
test('external issuer authenticates the non-stdio producer protocol without exposing its key', async () => {
    const channelId = 'release-visual-channel-test';
    const runNonce = createHash('sha256').update('issuer-run').digest('base64url');
    const cellId = 'preview-reduced-motion';
    const captureReceiptSha256 = 'f'.repeat(64);
    const childSource = [
        "const fs = require('node:fs');",
        "const frame = { version: 1, channelId: process.env.CHANNEL_ID, runNonce: process.env.RUN_NONCE, cellId: process.env.CELL_ID, captureReceiptSha256: process.env.DIGEST };",
        "fs.writeSync(3, JSON.stringify(frame) + '\\n');",
        "const ack = Buffer.alloc(128);",
        "const count = fs.readSync(0, ack, 0, ack.length, null);",
        "if (ack.subarray(0, count).toString('utf8') !== `ACK ${process.env.CHANNEL_ID} ${process.env.CELL_ID}\\n`) process.exit(7);",
        "fs.writeSync(3, JSON.stringify({ version: 2, status: 'ACKED', channelId: process.env.CHANNEL_ID, runNonce: process.env.RUN_NONCE, cellId: process.env.CELL_ID, captureReceiptSha256: process.env.DIGEST }) + '\\n');",
    ].join('');
    const childEnvironment = {
        ...scrubbedChildEnvironment(),
        CHANNEL_ID: channelId,
        RUN_NONCE: runNonce,
        CELL_ID: cellId,
        DIGEST: captureReceiptSha256,
    };
    expect(childEnvironment.RELEASE_VISUAL_RECEIPT_CHANNEL_KEY).toBeUndefined();
    expect(Object.keys(childEnvironment).some((key) => /SUPABASE|TOKEN|SECRET|PASSWORD/i.test(key))).toBe(false);
    await expect(runFramedChild({
        executable: process.execPath,
        args: ['-e', childSource],
        env: childEnvironment,
        expected: { channelId, runNonce, cellId },
        timeoutMs: 5_000,
    })).resolves.toBe(captureReceiptSha256);
    const channel = buildReceiptChannel({
        releaseId: 'release-test',
        certificationId: 'a'.repeat(64),
        gitSha: 'b'.repeat(40),
        channelId,
        runNonce,
        issuedAt: fixtureNow - 5,
        expiresAt: fixtureNow + 300,
        authReceipts: { 'preview-admin-auth-smoke-metadata': '1'.repeat(64) },
        captureReceipts: { [cellId]: captureReceiptSha256 },
        captureChallenges: { [cellId]: createHash('sha256').update('challenge').digest('base64url') },
        issuerBinding: issuerBinding(),
        signer: testIssuerSigner,
        issuer: { keyId: TEST_ISSUER_KEY_ID },
    });
    expect(channel).toMatchObject({ schemaVersion: 4, claim: 'G009-release-visual-channel-v1', releaseId: 'release-test', channelId, runNonce });
    expect(channel.issuerSignature).toMatch(/^[A-Za-z0-9_-]{64,256}$/);
});

test('assembler is create-only and binds exact sanitized verifier metadata', () => {
    const source = read('scripts/assemble-release-visual-evidence.mjs');
    expect(source).toContain('output must be create-only');
    expect(source).toContain('isolated cell directories do not exactly match template');
    expect(source).toContain("record.status === 'access_blocked'");
    expect(source).toContain('has undeclared or incomplete mask pixels');
    expect(source).toContain('has insufficient non-uniform content outside masks');
    expect(source).toContain('lstatSync');
    expect(source).toContain('realpathSync');
    expect(source).toContain('O_NOFOLLOW');
    expect(source).not.toContain('node:fs/promises');
    expect(source).toContain('MAX_PNG_CHUNKS');
    expect(source).toContain('MAX_IDAT_BYTES');
    expect(source).toContain('maxOutputLength: expectedLength');
    expect(source).toContain('masks cover too much of the viewport');
    expect(source).toContain('has transparent pixels');
    expect(source).toContain('duplicate-free strict UTF-8 JSON');
    expect(source).toContain('canonicalJson({ schemaVersion: 5');
    const verifier = read('scripts/verify-release-visual-evidence.mjs');
    expect(verifier).toContain('duplicate-free strict UTF-8 JSON');
    expect(verifier).toContain("decodeJson(ledgerBytes, 'runtime ledger', true)");
});
test('standalone auth metadata-only cells assemble and verify without visual metadata translation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-auth-'));
    try {
        const cells = createFixture(root);
        const ledger = path.join(root, 'ledger.json');
        const assembled = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(cells, ledger)], { cwd: webRoot, encoding: 'utf8' });
        if (assembled.status !== 0) throw new Error(`valid auth assembler failed: ${assembled.stderr}`);
        const protectedSigner = spawnSync(process.execPath, ['scripts/verify-release-visual-evidence.mjs', ...authArgs(cells, ledger, true)], { cwd: webRoot, encoding: 'utf8' });
        expect(protectedSigner.status).toBe(1);
        expect(protectedSigner.stderr).toBe('RELEASE_VISUAL_VERIFICATION_FAILED\n');
        const ledgerBytes = readFileSync(ledger);
        const ledgerValue = parseFinalEvidenceJson(ledgerBytes, 'VISUAL_LEDGER_MISMATCH', true);
        expect(ledgerBytes.toString('utf8')).toBe(`${canonicalJson(ledgerValue)}\n`);
        const authRecords = ledgerValue.cells.filter((cell: any) => cell.execution === 'standalone-auth');
        expect(authRecords).toHaveLength(3);
        expect(authRecords.every((cell: any) => cell.metadata.payload.result.revocationReceipt === revocationReceipt)).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 30_000);

test('assembler rejects duplicate, BOM, CR, and trailing JSON at its producer boundary', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-strict-json-'));
    try {
        for (const [label, mutate] of [
            ['duplicate', (text: string) => text.replace('{"schemaVersion":5', '{"schemaVersion":5,"schemaVersion":5')],
            ['bom', (text: string) => `\ufeff${text}`],
            ['cr', (text: string) => `${text}\r\n`],
            ['trailing', (text: string) => `${text} trailing`],
        ] as Array<[string, (text: string) => string]>) {
            const caseRoot = path.join(root, label);
            mkdirSync(caseRoot);
            const cells = createFixture(caseRoot);
            const metadataPath = path.join(cells, 'local-public-home-desktop', 'metadata.json');
            writeFileSync(metadataPath, mutate(readFileSync(metadataPath, 'utf8')));
            expect(spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(cells, path.join(caseRoot, 'ledger.json'))], { cwd: webRoot, encoding: 'utf8' }).status).toBe(1);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 60_000);
const invalidAuthCases: Array<[string, (record: any, cell: any) => any]> = [
    ['missing revocation', (record, cell) => {
        if (cell.execution !== 'standalone-auth') return record;
        const metadata = structuredClone(record.metadata);
        metadata.payload.result.revocationReceipt = 'missing';
        metadata.receiptSha256 = receiptHash(metadata.payload);
        return { ...record, metadata };
    }],
    ['wrong reason', (record, cell) => {
        if (cell.execution !== 'standalone-auth') return record;
        const metadata = structuredClone(record.metadata);
        metadata.payload.result.ok = false;
        metadata.payload.result.reasonCode = 'INTERNAL_FAILURE';
        metadata.receiptSha256 = receiptHash(metadata.payload);
        return { ...record, metadata };
    }],
    ['wrong auth cell', (record, cell) => cell.id === 'preview-admin-auth-smoke-metadata' ? { ...record, id: 'production-admin-auth-smoke-metadata' } : record],
    ['extra auth field', (record, cell) => cell.execution === 'standalone-auth' ? { ...record, metadata: { ...record.metadata, extra: true } } : record],
    ['screenshot descriptor', (record, cell) => cell.execution === 'standalone-auth' ? { ...record, artifact: 'admin.png', sha256: 'a'.repeat(64) } : record],
    ['visual-shaped auth metadata', (record, cell) => cell.execution === 'standalone-auth' ? { ...record, metadata: visualMetadata(cell) } : record],
];

test.each(invalidAuthCases)('standalone auth cells reject %s', (_label, override) => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-auth-'));
    try {
        const result = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(createFixture(root, override), path.join(root, 'ledger.json'))], { cwd: webRoot, encoding: 'utf8' });
        expect(result.status).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 15_000);
test('trusted auth receipt CLI, freshness, replay, and deployment boundaries fail closed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-trust-'));
    const runAssembler = (args: string[]) => spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...args], { cwd: webRoot, encoding: 'utf8' });
    try {
        const cliRoot = path.join(root, 'cli');
        mkdirSync(cliRoot);
        const cliCells = createFixture(cliRoot);
        const cliLedger = path.join(cliRoot, 'ledger.json');
        const base = authArgs(cliCells, cliLedger);
        const channelIndex = base.indexOf('--receipt-channel');
        const missing = [...base];
        missing.splice(channelIndex, 2);
        const duplicate = [...base, '--receipt-channel', base[channelIndex + 1]];
        const unknown = [...base];
        unknown[channelIndex + 1] = path.join(root, 'missing-channel.json');
        const replay = [...base];
        replay[replay.indexOf('--certification-id') + 1] = 'e'.repeat(64);
        for (const args of [missing, duplicate, unknown, replay]) expect(runAssembler(args).status).toBe(1);

        const semanticCases: Array<[string, (cells: string) => void]> = [
            ['wrong-final-path', (cells) => rewriteAuthMetadata(cells, 'preview-admin-auth-smoke-metadata', (metadata) => { metadata.payload.cell.finalUrl = 'https://tzudong-preview.vercel.app/admin/'; })],
            ['stale-window', (cells) => rewriteAuthMetadata(cells, 'preview-admin-auth-smoke-metadata', (metadata) => {
                metadata.payload.release.issuedAt = fixtureNow - 1000;
                metadata.payload.release.expiresAt = fixtureNow - 500;
                metadata.payload.deployment.observedAt = fixtureNow - 999;
                metadata.payload.result.capturedAt = fixtureNow - 998;
            })],
            ['duplicate-challenge', (cells) => {
                const production = JSON.parse(readFileSync(path.join(cells, 'production-admin-auth-smoke-metadata', 'metadata.json'), 'utf8'));
                rewriteAuthMetadata(cells, 'alias-admin-auth-smoke-metadata', (metadata) => { metadata.payload.release.challenge = production.metadata.payload.release.challenge; });
            }],
            ['deployment-pairing', (cells) => rewriteAuthMetadata(cells, 'alias-admin-auth-smoke-metadata', (metadata) => { metadata.payload.deployment.deploymentId = 'dpl_other'; })],
        ];
        for (const [label, mutate] of semanticCases) {
            const caseRoot = path.join(root, label);
            mkdirSync(caseRoot);
            const cells = createFixture(caseRoot);
            mutate(cells);
            expect(runAssembler(authArgs(cells, path.join(caseRoot, 'ledger.json'))).status).toBe(1);
        }

        const mismatchRoot = path.join(root, 'trusted-mismatch');
        mkdirSync(mismatchRoot);
        const mismatchCells = createFixture(mismatchRoot);
        const trustedArgs = authArgs(mismatchCells, path.join(mismatchRoot, 'ledger.json'));
        rewriteAuthMetadata(mismatchCells, 'preview-admin-auth-smoke-metadata', (metadata) => { metadata.payload.result.headingCount = 2; });
        expect(runAssembler(trustedArgs).status).toBe(1);

        const verifierRoot = path.join(root, 'verifier');
        mkdirSync(verifierRoot);
        const verifierCells = createFixture(verifierRoot);
        const verifierLedger = path.join(verifierRoot, 'ledger.json');
        expect(runAssembler(authArgs(verifierCells, verifierLedger)).status).toBe(0);
        const ledger = JSON.parse(readFileSync(verifierLedger, 'utf8'));
        const preview = ledger.cells.find((cell: any) => cell.id === 'preview-admin-auth-smoke-metadata');
        preview.metadata.payload.cell.finalUrl = 'https://tzudong-preview.vercel.app/admin/';
        preview.metadata.receiptSha256 = receiptHash(preview.metadata.payload);
        writeFileSync(verifierLedger, `${canonicalJson(ledger)}\n`);
        const verifierArgs = authArgs(verifierCells, verifierLedger, true);
        expect(spawnSync(process.execPath, ['scripts/verify-release-visual-evidence.mjs', ...verifierArgs], { cwd: webRoot, encoding: 'utf8' }).status).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 60_000);
test('authenticated receipt channel nonce is consumed exactly once', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-replay-'));
    try {
        const cells = createFixture(root);
        const firstLedger = path.join(root, 'first-ledger.json');
        const args = authArgs(cells, firstLedger);
        const first = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...args], { cwd: webRoot, encoding: 'utf8' });
        expect(first.status).toBe(0);
        const outputIndex = args.indexOf('--output') + 1;
        const replay = [...args];
        replay[outputIndex] = path.join(root, 'replayed-ledger.json');
        const second = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...replay], { cwd: webRoot, encoding: 'utf8' });
        expect(second.status).toBe(1);
        expect(second.stderr).toBe('RELEASE_VISUAL_ASSEMBLY_FAILED\n');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 15_000);
test('capture receipt CLI and detached receipt tampering fail closed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-capture-'));
    const run = (args: string[]) => spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...args], { cwd: webRoot, encoding: 'utf8' });
    const mutateReceipt = (cells: string, id: string, mutate: (receipt: any) => void, updateDigest = true) => {
        const directory = path.join(cells, id);
        const receiptFile = path.join(directory, 'capture-receipt.json');
        const metadataFile = path.join(directory, 'metadata.json');
        const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
        mutate(receipt);
        writeFileSync(receiptFile, JSON.stringify(receipt));
        if (updateDigest) {
            const record = JSON.parse(readFileSync(metadataFile, 'utf8'));
            record.captureReceiptSha256 = captureReceiptHash(receipt);
            writeFileSync(metadataFile, JSON.stringify(record));
        }
    };
    try {
        const cliRoot = path.join(root, 'cli');
        mkdirSync(cliRoot);
        const cliCells = createFixture(cliRoot);
        const cliLedger = path.join(cliRoot, 'ledger.json');
        const base = authArgs(cliCells, cliLedger);
        const channelIndex = base.indexOf('--receipt-channel');
        const missing = [...base]; missing.splice(channelIndex, 2);
        const duplicate = [...base, '--receipt-channel', base[channelIndex + 1]];
        const unknown = [...base]; unknown[channelIndex + 1] = path.join(root, 'missing-channel.json');
        for (const args of [missing, duplicate, unknown]) expect(run(args).status).toBe(1);

        for (const [label, mutate, updateDigest] of [
            ['replayed challenge', (receipt: any) => { receipt.challenge = createHash('sha256').update('capture:local-reduced-motion').digest('base64url'); }, true],
            ['stale time', (receipt: any) => { receipt.issuedAt = fixtureNow - 1000; receipt.capturedAt = fixtureNow - 999; receipt.expiresAt = fixtureNow - 500; }, true],
            ['wrong detached digest', (_receipt: any) => {}, false],
        ] as Array<[string, (receipt: any) => void, boolean]>) {
            const caseRoot = path.join(root, label.replaceAll(' ', '-'));
            mkdirSync(caseRoot);
            const cells = createFixture(caseRoot);
            mutateReceipt(cells, 'preview-reduced-motion', mutate, updateDigest);
            if (!updateDigest) {
                const file = path.join(cells, 'preview-reduced-motion', 'metadata.json');
                const record = JSON.parse(readFileSync(file, 'utf8'));
                record.captureReceiptSha256 = 'f'.repeat(64);
                writeFileSync(file, JSON.stringify(record));
            }
            expect(run(authArgs(cells, path.join(caseRoot, 'ledger.json'))).status).toBe(1);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 45_000);
// Six real 1440x900 PNG cases run sequentially; reuse one valid verifier ledger while retaining both entrypoint assertions.
test('assembler and verifier reject hostile PNG inputs within one bounded integration run', () => {
    const assemblerRoot = mkdtempSync(path.join(tmpdir(), 'release-visual-png-'));
    const verifierRoot = mkdtempSync(path.join(tmpdir(), 'release-visual-png-'));
    const maskOverride = (record: any, cell: any) => cell.evidence === 'screenshot' && cell.masks.length ? { ...record, metadata: { ...record.metadata, maskProof: record.metadata.maskProof.map((proof: any) => ({ ...proof, box: { ...proof.box, width: Math.ceil(cell.viewport.width / 2), height: cell.viewport.height } })) } } : record;
    const cases: Array<[string, Parameters<typeof fixturePng>[3], ((record: any, cell: any) => any) | undefined, (record: any) => boolean]> = [
        ['oversized PNG', { oversized: true }, undefined, (record) => record.evidence === 'screenshot'],
        ['ancillary chunk', { ancillary: true }, undefined, (record) => record.evidence === 'screenshot'],
        ['misordered chunks', { misordered: true }, undefined, (record) => record.evidence === 'screenshot'],
        ['split IDAT run', { splitIdat: true }, undefined, (record) => record.evidence === 'screenshot'],
        ['transparent RGBA pixel', { transparent: true }, undefined, (record) => record.evidence === 'screenshot'],
        ['aggregate mask abuse', { maskAbuse: true }, maskOverride, (record) => record.evidence === 'screenshot' && record.metadata.maskProof.length > 0],
    ];
    try {
        const validCells = createFixture(verifierRoot);
        const ledger = path.join(verifierRoot, 'ledger.json');
        const baselineAssembly = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(validCells, ledger)], { cwd: webRoot, encoding: 'utf8' });
        if (baselineAssembly.status !== 0) throw new Error(`valid baseline assembler failed: ${baselineAssembly.stderr}`);
        expect(baselineAssembly.status).toBe(0);
        const baseline = JSON.parse(readFileSync(ledger, 'utf8'));
        const template = JSON.parse(read('tests/release-visual-cells.template.json'));
        const baselineTrustedCaptureReceipts = { ...receiptChannels.get(validCells)!.captureReceipts };
        const baselineArtifacts = Object.fromEntries(Object.keys(baseline.files).map((artifact) => [artifact, readFileSync(path.join(verifierRoot, 'artifacts', artifact))]));
        for (const [label, options, override, selectRecord] of cases) {
            receiptChannels.get(validCells)!.captureReceipts = { ...baselineTrustedCaptureReceipts };
            writeFileSync(ledger, `${canonicalJson(baseline)}\n`);
            for (const [artifact, bytes] of Object.entries(baselineArtifacts)) writeFileSync(path.join(verifierRoot, 'artifacts', artifact), bytes as Buffer);
            const caseRoot = path.join(assemblerRoot, label.replaceAll(' ', '-'));
            mkdirSync(caseRoot);
            const pngForCell = (cell: any) => fixturePng(cell.viewport.width, cell.viewport.height, cell.masks.length > 0, options);
            const assembly = spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(createFixture(caseRoot, override, pngForCell), path.join(caseRoot, 'ledger.json'))], { cwd: webRoot, encoding: 'utf8' });
            if (assembly.status !== 1) throw new Error(`${label}: assembler accepted hostile PNG: ${assembly.stderr}`);
            expect(assembly.status).toBe(1);
            const value = JSON.parse(JSON.stringify(baseline));
            const record = value.cells.find(selectRecord);
            const cell = template.cells.find((item: any) => item.id === record.id);
            if (override) record.metadata = override(record, cell).metadata;
            const png = pngForCell(cell); const digest = createHash('sha256').update(png).digest('hex');
            const receipt = value.captureReceipts[record.id];
            receipt.artifactSha256 = digest;
            receipt.metadataSha256 = createHash('sha256').update(canonicalJson(record.metadata)).digest('hex');
            const receiptDigest = captureReceiptHash(receipt);
            record.sha256 = digest;
            record.captureReceiptSha256 = receiptDigest;
            value.files[record.artifact] = digest;
            receiptChannels.get(validCells)!.captureReceipts[record.id] = receiptDigest;
            writeFileSync(path.join(verifierRoot, 'artifacts', record.artifact), png);
            writeFileSync(ledger, `${canonicalJson(value)}\n`);
            const verification = spawnSync(process.execPath, ['scripts/verify-release-visual-evidence.mjs', ...authArgs(validCells, ledger, true)], { cwd: webRoot, encoding: 'utf8' });
            if (verification.status !== 1) throw new Error(`${label}: verifier accepted hostile PNG: ${verification.stderr}`);
            expect(verification.status).toBe(1);
            expect(verification.stderr).toBe('RELEASE_VISUAL_VERIFICATION_FAILED\n');
        }
    } finally {
        rmSync(assemblerRoot, { recursive: true, force: true });
        rmSync(verifierRoot, { recursive: true, force: true });
    }
}, 60_000);
test('reduced-motion mobile contracts reject every hostile invariant in assembly and verification', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-visual-mobile-contract-'));
    const mutateCases: Array<[string, (metadata: any) => void]> = [
        ['animation duration', (metadata) => { metadata.responsive.maxAnimationDurationMs = 1; }],
        ['transition duration', (metadata) => { metadata.responsive.maxTransitionDurationMs = 1; }],
        ['keyboard navigation', (metadata) => { metadata.accessibility.keyboardNavigation = false; }],
        ['visible focus', (metadata) => { metadata.accessibility.visibleFocus = false; }],
        ['focus trap', (metadata) => { metadata.accessibility.focusTrap = false; }],
        ['focus restore', (metadata) => { metadata.accessibility.focusRestore = false; }],
        ['escape close', (metadata) => { metadata.accessibility.escapeCloses = false; }],
        ['shell geometry', (metadata) => { metadata.responsive.shellMatchesViewport = false; }],
        ['navigation geometry', (metadata) => { metadata.responsive.hasHorizontalOverflow = true; }],
        ['navigation path', (metadata) => { metadata.route = '/unexpected'; }],
        ['map state', (metadata) => { metadata.surfaces.map = 'closed'; }],
        ['modal state', (metadata) => { metadata.surfaces.modal = 'visible'; }],
        ['sheet state', (metadata) => { metadata.surfaces.sheet = 'visible'; }],
        ['WCAG language', (metadata) => { metadata.accessibility.documentLanguage = false; }],
        ['WCAG title', (metadata) => { metadata.accessibility.documentTitle = false; }],
        ['WCAG duplicate ids', (metadata) => { metadata.accessibility.duplicateIds = 1; }],
        ['WCAG image alternative', (metadata) => { metadata.accessibility.imagesWithoutAlt = 1; }],
    ];
    const runAssembler = (cells: string, ledger: string) => spawnSync(process.execPath, ['scripts/assemble-release-visual-evidence.mjs', ...authArgs(cells, ledger)], { cwd: webRoot, encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 });
    const runVerifier = (cells: string, ledger: string) => spawnSync(process.execPath, ['scripts/verify-release-visual-evidence.mjs', ...authArgs(cells, ledger, true)], { cwd: webRoot, encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 });
    try {
        // Exercise the CLI once per entrypoint, then call the exact independently implemented metadata validators directly.
        const verifierRoot = path.join(root, 'verifier-baseline');
        mkdirSync(verifierRoot);
        const verifierCells = createFixture(verifierRoot);
        const ledger = path.join(verifierRoot, 'ledger.json');
        const baselineAssembly = runAssembler(verifierCells, ledger);
        if (baselineAssembly.status !== 0) throw new Error(`valid baseline assembler failed: ${baselineAssembly.stderr}`);
        const baselineVerification = runVerifier(verifierCells, ledger);
        if (baselineVerification.status !== 1) throw new Error(`verifier did not reject the non-pinned test signer: ${baselineVerification.stderr}`);
        const mobileCells = JSON.parse(read('tests/release-visual-cells.template.json')).cells.filter((cell: any) => cell.contract.mode === 'reduced-motion-mobile');
        expect(mobileCells.map((cell: any) => cell.id)).toEqual(['local-reduced-motion', 'preview-reduced-motion', 'production-reduced-motion', 'alias-reduced-motion']);
        const expectRejected = (validator: (metadata: any, cell: any, trusted: any) => unknown, metadata: any, cell: any, label: string) => {
            try {
                validator(metadata, cell, trustedVisualMetadata());
                throw new Error(`${label}: ${cell.id} accepted hostile invariant`);
            } catch (error) {
                if (String(error).includes('accepted hostile invariant')) throw error;
                expect(String(error)).toContain(cell.id);
            }
        };
        for (const [label, mutate] of mutateCases) for (const cell of mobileCells) {
            const assemblyMetadata = visualMetadata(cell);
            mutate(assemblyMetadata);
            expectRejected(validateAssemblyMetadata, assemblyMetadata, cell, `assembler ${label}`);
            const verifierMetadata = visualMetadata(cell);
            mutate(verifierMetadata);
            expectRejected(validateVerifierMetadata, verifierMetadata, cell, `verifier ${label}`);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 100_000);
