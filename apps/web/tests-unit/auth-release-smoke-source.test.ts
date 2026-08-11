import { expect, test } from 'bun:test';
import { resolve, join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dir, '..');
const parent = await import(resolve(root, 'scripts/run-auth-release-smoke.mjs'));
const child = await import(resolve(root, 'scripts/run-auth-release-smoke-child.mjs'));
const origin = new URL('https://tzudong.app/');
const fixtureNodeExecutable = process.execPath;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const now = Math.floor(Date.now() / 1000);
const jwt = (claims: Record<string, unknown> = {}) => [
    Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId, iat: now - 10, exp: now + 300, role: 'authenticated', ...claims })).toString('base64url'),
    Buffer.from('signature').toString('base64url'),
].join('.');
const validState = (host = origin.hostname, value = `base64-${Buffer.from(JSON.stringify({ access_token: jwt(), refresh_token: 'refresh-1234567890123456' })).toString('base64')}`, httpOnly = true) => encode({ cookies: [{ name: 'sb-aqlcofblfxdrjhhdmarw-auth-token', value, domain: host, path: '/', expires: Math.floor(Date.now() / 1000) + 60, httpOnly, secure: true, sameSite: 'Lax' }], origins: [] });
const jsonResponse = (body: unknown, url: string, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    return { ok: true, status: 200, url, headers: new Headers({ 'content-type': 'application/json', ...headers }), text: async () => text };
};
const cli = (overrides: Record<string, string> = {}) => {
    const values = { 'cell-id': 'alias-admin-auth-smoke-metadata', origin: 'https://tzudong.app/', 'release-id': 'release-1', 'certification-id': 'a'.repeat(64), challenge: 'A'.repeat(43), 'issued-at': String(now), 'expires-at': String(now + 60), 'expected-git-sha': 'b'.repeat(40), 'expected-deployment-receipt-sha256': 'c'.repeat(64), ...overrides };
    return Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
};
async function removeFixtureDirectory(directory: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            await rm(directory, { recursive: true, force: true });
            return;
        } catch (error) {
            lastError = error;
            if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
        }
    }
    throw lastError;
}
function createFakeSpawnedChild(pid = 41) {
    const child = new EventEmitter() as EventEmitter & {
        pid: number;
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => boolean;
        unref: () => void;
    };
    child.pid = pid;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.unref = () => {};
    return child;
}
async function withFakeChild(source: string, exercise: (directory: string, childPath: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'auth-release-smoke-test-'));
    const childPath = join(directory, 'child.mjs');
    await writeFile(childPath, source, { mode: 0o600 });
    try { await exercise(directory, childPath); } finally { await removeFixtureDirectory(directory); }
}
const linuxPidNamespaceTest = process.platform === 'linux' && spawnSync(
    '/usr/bin/unshare',
    ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL', '--', '/bin/true'],
    { stdio: 'ignore', timeout: 3_000 },
).status === 0 ? test : test.skip;

test('origin, storage, and Supabase validation fail closed', () => {
    expect(parent.exactHttpsOrigin('https://tzudong.app/').hostname).toBe('tzudong.app');
    for (const value of ['http://tzudong.app/', 'https://tzudong.app:443/', 'https://tzudong.app/a', 'https://tzudong.app/?q=1', 'https://tzudong.app/#x']) expect(() => parent.exactHttpsOrigin(value)).toThrow();
    expect(parent.validateStorageState(validState(), origin).cookies).toHaveLength(1);
    const browserState = validState(origin.hostname, undefined, false);
    const decodedBrowserState = parent.validateStorageState(browserState, origin);
    expect(decodedBrowserState.cookies[0].httpOnly).toBe(false);
    expect(JSON.parse(Buffer.from(parent.encodeHttpOnlyStorageState(decodedBrowserState), 'base64').toString('utf8')).cookies[0].httpOnly).toBe(true);
    expect(() => parent.validateStorageState(validState('evil.example'), origin)).toThrow();
    expect(() => parent.validateSupabaseDestination('https://aqlcofblfxdrjhhdmarw.supabase.co/path')).toThrow();
    expect(child.exactOrigin('https://aqlcofblfxdrjhhdmarw.supabase.co/').hostname).toBe('aqlcofblfxdrjhhdmarw.supabase.co');
});
test('authenticated browser proof is challenge-bound, redacted, and fail-closed', async () => {
    const childSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke-child.mjs'), 'utf8');
    const routeSource = await readFile(resolve(root, 'app/api/admin/release-auth-proof/route.ts'), 'utf8');
    const middlewareSource = await readFile(resolve(root, 'lib/supabase/middleware.ts'), 'utf8');

    expect(childSource).toContain("const PROOF_PATH = '/api/admin/release-auth-proof'");
    expect(childSource).toContain("for (const invalidCookie of [null, 'invalid-release-auth-cookie'])");
    expect(childSource).toContain("if (![401, 403].includes(proof.status)) fail('AUTH_PROOF_DENIED')");
    expect(childSource).toContain("if (egress.size) fail('EXTERNAL_EGRESS')");
    expect(childSource).toContain("if (proof.status !== 200");
    expect(childSource).toContain("const authProofSha256 = validateProof(proof.body, expectedProof)");
    expect(childSource).toContain("authProofSha256: null");
    expect(childSource).not.toContain('userId:');
    expect(childSource).not.toContain('sessionId:');

    expect(routeSource).toContain("import { requireAdmin } from '@/lib/auth/require-admin'");
    expect(routeSource).toContain("supabase.auth.getUser()");
    expect(routeSource).toContain("'is_current_auth_session_active' as never");
    expect(routeSource).toContain("'get_current_auth_session_id' as never");
    expect(routeSource).toContain("request.headers.get('x-tzudong-release-auth-challenge')");
    expect(routeSource).toContain('export async function POST');
    expect(routeSource).toContain("'Cache-Control': 'no-store, max-age=0'");
    expect(routeSource).toContain("schemaVersion: 1, challengeSha256, identitySha256, bindingSha256");
    expect(routeSource).not.toContain('access_token:');
    expect(routeSource).not.toContain('sessionId: sessionId');

    expect(middlewareSource).toContain("rpc('is_current_auth_session_active' as never)");
    expect(middlewareSource).toContain('if (activeSessionError || activeSession !== true)');
    expect(middlewareSource).toContain('clearSupabaseAuthCookies(request, supabaseResponse)');
});
test('release smoke classifies existing sessions only and cannot create privacy admission evidence', async () => {
    const childSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke-child.mjs'), 'utf8');
    const proofRouteSource = await readFile(resolve(root, 'app/api/admin/release-auth-proof/route.ts'), 'utf8');

    for (const source of [childSource, proofRouteSource]) {
        expect(source).not.toContain('auth.signUp');
        expect(source).not.toContain('auth.admin.createUser');
        expect(source).not.toContain('confirm_privacy_onboarding');
        expect(source).not.toContain('submit_privacy_consent');
        expect(source).not.toContain('privacy_consent_events');
    }
});
test('proof transport bypasses hostile page code and routing blocks egress before dispatch', async () => {
    const source = await readFile(resolve(root, 'scripts/run-auth-release-smoke-child.mjs'), 'utf8');
    const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
    const proof = { schemaVersion: 1, challengeSha256: 'a'.repeat(64), identitySha256: 'b'.repeat(64), bindingSha256: 'c'.repeat(64) };
    const context = {
        request: {
            fetch: async (url: string, options: Record<string, unknown>) => {
                calls.push({ url, options });
                return {
                    body: async () => Buffer.from(JSON.stringify(proof)),
                    dispose: async () => {},
                    headers: () => ({ 'cache-control': 'no-store, max-age=0', 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }),
                    status: () => 200,
                    url: () => url,
                };
            },
        },
        page: { evaluate: () => { throw new Error('hostile page fetch must be unreachable'); } },
    };
    await expect(child.requestProof(context, origin, 'A'.repeat(43))).resolves.toMatchObject({ status: 200, body: proof });
    expect(calls).toEqual([{
        url: 'https://tzudong.app/api/admin/release-auth-proof',
        options: expect.objectContaining({ method: 'POST', maxRedirects: 0, timeout: 5_000 }),
    }]);
    expect(child.allowedBrowserRequest({ url: () => 'https://tzudong.app/admin', method: () => 'GET' }, origin)).toBe(true);
    expect(child.allowedBrowserRequest({ url: () => 'https://evil.example/steal', method: () => 'GET' }, origin)).toBe(false);
    expect(child.allowedBrowserRequest({ url: () => 'https://tzudong.app/api/exfiltrate', method: () => 'POST' }, origin)).toBe(false);
    expect(source).not.toContain('page.evaluate');
    expect(source).toContain("await context.route('**/*'");
    expect(source).toContain("await route.abort('blockedbyclient')");
    expect(source).toContain("serviceWorkers: 'block'");
    expect(source.indexOf('await installEgressGuard(context, origin)')).toBeLessThan(source.indexOf('await context.newPage()'));
    expect(source).toContain('httpOnly !== true');
});

test('release CLI is strict, canonical, and independent from environment trust inputs', () => {
    expect(parent.parseReleaseAuthCli(cli()).releaseId).toBe('release-1');
    expect(() => parent.parseReleaseAuthCli([...cli(), '--unknown', 'x'])).toThrow();
    expect(() => parent.parseReleaseAuthCli([...cli().slice(0, -2), '--expected-git-sha', 'b'.repeat(40)])).toThrow();
    expect(() => parent.parseReleaseAuthCli(cli({ 'issued-at': `0${now}` }))).toThrow();
    expect(() => parent.parseReleaseAuthCli(cli({ challenge: `${'A'.repeat(42)}=` }))).toThrow();
    expect(() => parent.parseReleaseAuthCli(cli({ 'expires-at': String(now + 901) }))).toThrow();
    const release = parent.parseReleaseAuthCli(cli());
    expect(parent.assertFreshWindow(release, release.issuedAt)).toBeUndefined();
    expect(() => parent.assertFreshWindow(release, release.issuedAt - 61)).toThrow();
    expect(() => parent.assertFreshWindow(release, release.issuedAt + 61)).toThrow();
});

test('deployment receipt digest is canonical and binds release tuple fields', () => {
    const release = parent.parseReleaseAuthCli(cli({ 'expected-deployment-receipt-sha256': '0'.repeat(64) }));
    const receipt = { schemaVersion: 2, releaseId: release.releaseId, certificationId: release.certificationId, project: 'tzudong', projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl', orgId: 'team_OUj64KeLxJI3PkEbOaFZnorA', teamSlug: 'twoimos-projects', framework: 'nextjs', environment: 'production', deploymentId: 'dpl_abc123', gitSha: release.expectedGitSha, host: 'tzudong-immutable.vercel.app', aliasHost: 'tzudong.app', observedAt: release.issuedAt, expiresAt: release.expiresAt };
    const digest = parent.sha256('tzudong:deployment-receipt:v2\n', receipt);
    const bound = parent.parseReleaseAuthCli(cli({ 'expected-deployment-receipt-sha256': digest }));
    expect(parent.decodeDeploymentReceipt(Buffer.from(parent.canonicalJson(receipt)).toString('base64'), bound).digest).toBe(digest);
    expect(() => parent.decodeDeploymentReceipt(Buffer.from(JSON.stringify({ ...receipt, gitSha: 'c'.repeat(40) })).toString('base64'), bound)).toThrow();
    expect(() => parent.decodeDeploymentReceipt(Buffer.from(JSON.stringify(receipt, Object.keys(receipt).reverse())).toString('base64'), bound)).toThrow();
});

test('cell, metadata, final path, and revocation proof are strict', async () => {
    expect(parent.authCellId({ environment: 'preview', host: 'x.vercel.app', aliasHost: 'x.vercel.app' }, 'preview-admin-auth-smoke-metadata', new URL('https://x.vercel.app/'))).toBe('preview-admin-auth-smoke-metadata');
    expect(() => parent.authCellId({ environment: 'production', host: 'x.vercel.app', aliasHost: 'tzudong.app' }, 'preview-admin-auth-smoke-metadata', origin)).toThrow();
    const release = parent.parseReleaseAuthCli(cli());
    const success = JSON.stringify({ ok: true, reasonCode: 'OK', revocationReceipt: 'parent_required', authProofSha256: 'f'.repeat(64), shellHeight: 240, shellWidth: 320, headingCount: 1, navigationCount: 1, status: 200, finalUrl: 'https://tzudong.app/admin', capturedAt: release.issuedAt });
    expect(parent.validateMetadata(success, false, [], release).reasonCode).toBe('OK');
    expect(() => parent.validateMetadata(success.replace('/admin', '/admin?x=1'), false, [], release)).toThrow();
    expect(() => parent.validateMetadata(success.replace('"shellHeight":240', '"shellHeight":0'), false, [], release)).toThrow();
    expect(child.validateFinalAdminUrl('https://tzudong.app/admin', origin)).toBe('https://tzudong.app/admin');
    expect(() => child.validateFinalAdminUrl('https://tzudong.app/admin#x', origin)).toThrow();
    const successMetadata = JSON.parse(success);
    const revocation = {
        operationId: '33333333-3333-4333-8333-333333333333',
        bindingSha256: parent.buildRevocationBinding(release, 'd'.repeat(64), successMetadata, '33333333-3333-4333-8333-333333333333'),
        receiptSha256: 'e'.repeat(64),
    };
    const aliasPayload = parent.buildReceiptPayload(
        release,
        { environment: 'production', deploymentId: 'dpl_abc123', host: 'tzudong-immutable.vercel.app', aliasHost: 'tzudong.app', observedAt: release.issuedAt },
        'd'.repeat(64),
        successMetadata,
        revocation,
    );
    expect(aliasPayload.cell).toMatchObject({ environment: 'alias', origin: 'https://tzudong.app/', finalUrl: 'https://tzudong.app/admin' });
    expect(aliasPayload.result.revocationReceipt).toBe('e'.repeat(64));
    expect(aliasPayload.result.revocationOperationId).toBe(revocation.operationId);
    expect(aliasPayload.result.revocationBindingSha256).toBe(revocation.bindingSha256);
    expect(() => parent.buildReceiptPayload(
        release,
        { environment: 'production', deploymentId: 'dpl_abc123', host: 'tzudong-immutable.vercel.app', aliasHost: 'tzudong.app', observedAt: release.issuedAt + 1 },
        'd'.repeat(64),
        successMetadata,
        revocation,
    )).toThrow();
    expect(() => parent.buildReceiptPayload(
        release,
        { environment: 'production', deploymentId: 'dpl_abc123', host: 'tzudong-immutable.vercel.app', aliasHost: 'tzudong.app', observedAt: release.issuedAt },
        'd'.repeat(64),
        successMetadata,
        { ...revocation, bindingSha256: 'f'.repeat(64) },
    )).toThrow();
    expect(child.parseSession(origin, validState()).cookies).toHaveLength(1);
});

test('bounded helpers fail on spawn error, nonzero exit, output overflow, and hangs', async () => {
    await expect(parent.runBoundedCommand(join(tmpdir(), 'missing-auth-helper'), [], { timeoutMs: 20 })).rejects.toThrow();
    expect((await parent.runBoundedCommand(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 10_000 })).code).toBe(7);
    await expect(parent.runBoundedCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(1000))"], { timeoutMs: 10_000, outputLimit: 32 })).rejects.toThrow();
    await expect(parent.runBoundedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 20 })).rejects.toThrow();
});

test('Windows cleanup accepts normal exit only after targeted job-boundary verification', async () => {
    const normalExit = parent.createProcessTreeController({
        platform: 'win32',
        atomicWindowsJob: true,
        runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
    });
    expect(await normalExit.cleanup(41)).toBe(true);
    const uncontained = parent.createProcessTreeController({
        platform: 'win32',
        runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
    });
    expect(await uncontained.cleanup(41, 'SIGKILL', 50)).toBe(false);
    const survivor = parent.createProcessTreeController({
        platform: 'win32',
        atomicWindowsJob: true,
        sleep: async () => {},
        runCommand: async (command: string) => command.endsWith('powershell.exe')
            ? { code: 0, stdout: '41\n', stderr: '' }
            : { code: 0, stdout: '', stderr: '' },
    });
    expect(await survivor.cleanup(41, 'SIGKILL', 50)).toBe(false);
});
test('Windows broker control channel is nonce-bound and fails closed on missing proof', async () => {
    const source = await readFile(resolve(root, 'scripts/run-auth-release-smoke.mjs'), 'utf8');
    expect(source).toContain("const windowsControlPipeName = useNativeWindowsJobSupervisor ? `tzudong-auth-smoke-${randomUUID()}` : null");
    expect(source).toContain("const windowsControlPipe = windowsControlPipeName ? `\\\\\\\\.\\\\pipe\\\\${windowsControlPipeName}` : null");
    expect(source).toContain('TZUDONG_JOB_CONTROL_PIPE_B64');
    expect(source).toContain('PROC_THREAD_ATTRIBUTE_HANDLE_LIST');
    expect(source).toContain('OpenProcess(SYNCHRONIZE,false,parentPid)');
    expect(source).toContain('WaitForMultipleObjects(2,new IntPtr[]{parent,pi.process}');
    expect(source).toContain('ActiveProcessCount(job)');
    expect(source).toContain('writer.WriteLine("READY "+nonce+" "+deadline)');
    expect(source).toContain('writer.WriteLine("STARTED "+nonce+" "+deadline)');
    expect(source).toContain('writer.WriteLine("COMPLETE "+nonce+" "+deadline)');
    expect(source).toContain("socket.write(`ACK ${containmentNonce} ${containmentDeadline}\\n`)");
    expect(source).toContain("if (controlBytes || !protocolStarted || !protocolComplete) return rejectProtocol('truncated')");
    expect(source).toContain("Remove-Item Env:TZUDONG_JOB_EXECUTABLE_B64,Env:TZUDONG_JOB_COMMAND_LINE_B64,Env:TZUDONG_JOB_CWD_B64,Env:TZUDONG_JOB_CONTROL_PIPE_B64");
    expect(source).toContain('return Abort(job)');
    expect(source).not.toContain('CreateProcessW(exe,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,false');
});
test('Windows PowerShell startup progress filtering is exact and preserves diagnostics', () => {
    const startupProgress =
        '#< CLIXML\r\n' +
        '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
        '<Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T>' +
        '<T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record">' +
        '<AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC>' +
        '<T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>';
    expect(parent.stripTrustedWindowsPowerShellStartupProgress(startupProgress)).toBe('');
    expect(parent.stripTrustedWindowsPowerShellStartupProgress(`${startupProgress}workload diagnostic`)).toBe('workload diagnostic');
    expect(parent.stripTrustedWindowsPowerShellStartupProgress(startupProgress.replace('Completed', 'Processing'))).toContain('Processing');
});
test('fake Windows broker requires READY, ACK, STARTED, COMPLETE, and control-channel close', async () => {
    const runBroker = (mode: 'complete' | 'missing-ready' | 'missing-complete' | 'spoofed-workload-frame') => {
        const fakeChild = createFakeSpawnedChild();
        const execution = parent.runChild({ PATH: process.env.PATH || '' }, [], tmpdir(), origin.origin, 100, {
            platform: 'win32',
            trustedWindowsJobBoundary: true,
            closeTimeoutMs: 20,
            cleanupTimeoutMs: 50,
            processController: { capture: async () => [41], cleanup: async () => true },
            spawnChild: (_command: string, _args: string[], options: { env: Record<string, string> }) => {
                const pipeName = Buffer.from(options.env.TZUDONG_JOB_CONTROL_PIPE_B64, 'base64').toString('utf8');
                const pipe = `\\\\.\\pipe\\${pipeName}`;
                queueMicrotask(() => {
                    fakeChild.emit('spawn');
                    if (mode === 'missing-ready') return;
                    const socket = createConnection(pipe, () => {
                        if (mode === 'spoofed-workload-frame') socket.write('COMPLETE spoofed 0\n');
                        else socket.write(`READY ${options.env.TZUDONG_JOB_CONTROL_NONCE} ${options.env.TZUDONG_JOB_CONTROL_DEADLINE}\n`);
                    });
                    socket.setEncoding('utf8');
                    socket.on('data', () => {
                        if (mode === 'missing-complete') return socket.end();
                        socket.write(`STARTED ${options.env.TZUDONG_JOB_CONTROL_NONCE} ${options.env.TZUDONG_JOB_CONTROL_DEADLINE}\n`);
                        socket.write(`COMPLETE ${options.env.TZUDONG_JOB_CONTROL_NONCE} ${options.env.TZUDONG_JOB_CONTROL_DEADLINE}\n`);
                        socket.end();
                    });
                    socket.on('end', () => fakeChild.emit('close', 0));
                });
                return fakeChild;
            },
        });
        return execution;
    };
    await expect(runBroker('complete')).resolves.toMatchObject({ code: 0 });
    for (const mode of ['missing-ready', 'missing-complete', 'spoofed-workload-frame'] as const) {
        await expect(runBroker(mode)).rejects.toMatchObject({ code: expect.any(String) });
    }
}, 5_000);

test('POSIX cleanup requires the owned PID-namespace supervisor and child output remains redacted', async () => {
const signals: Array<[number, string | number]> = []; let present = true;
const posix = parent.createProcessTreeController({
    platform: 'linux',
    atomicPidNamespace: true,
    kill: (pid: number, signal: string | number) => {
        signals.push([pid, signal]);
        if (signal === 0 && !present) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        if (signal === 'SIGKILL') present = false;
        return true;
    },
});
    expect(await posix.cleanup(17)).toBe(true);
expect(signals).toEqual([[17, 0], [17, 'SIGKILL'], [17, 0]]);
    await withFakeChild("process.stdout.write('private-refresh-token');", async (directory, childPath) => {
        await expect(parent.runChild({ PATH: process.env.PATH || '' }, ['private-refresh-token'], directory, origin.origin, 10_000, { childPath, executable: fixtureNodeExecutable, processController: { cleanup: async () => true } })).rejects.toMatchObject({ code: 'INTERNAL_FAILURE' });
    });
});

test('parent lifecycle cleanup drains local child handles after verified timeout teardown, handles spawn failure, and rejects cleanup ambiguity', async () => {
    const environment = { PATH: process.env.PATH || '' };
    await withFakeChild("setInterval(() => {}, 1_000);", async (directory, childPath) => {
        const fakeChild = createFakeSpawnedChild();
        const execution = parent.runChild(environment, [], directory, origin.origin, 20, {
            childPath,
            closeTimeoutMs: 20,
            spawnChild: () => {
                queueMicrotask(() => fakeChild.emit('spawn'));
                return fakeChild;
            },
            processController: {
                capture: async () => [fakeChild.pid],
                terminate: async () => true,
                verify: async () => true,
            },
        });
        await expect(execution).rejects.toMatchObject({ code: 'NAVIGATION_FAILED' });
    });
    await withFakeChild('', async (directory, childPath) => {
        await expect(parent.runChild(environment, [], directory, origin.origin, 20, {
            childPath,
            executable: join(directory, 'missing-node'),
            platform: 'linux',
            processController: { cleanup: async () => true },
        })).rejects.toMatchObject({ code: 'INTERNAL_FAILURE' });
        await expect(parent.runChild(environment, [], directory, origin.origin, 1_000, { childPath, executable: fixtureNodeExecutable, processController: { cleanup: async () => false } })).rejects.toMatchObject({ code: 'INTERNAL_FAILURE' });
    });
});
test('child output cap discards oversized combined output before teardown', async () => {
    await withFakeChild('', async (directory, childPath) => {
        const fakeChild = createFakeSpawnedChild();
        const execution = parent.runChild(
            { PATH: process.env.PATH || '' },
            ['secret-output-'],
            directory,
            origin.origin,
            10_000,
            {
                childPath,
                executable: fixtureNodeExecutable,
                outputLimit: 32,
                spawnChild: () => {
                    queueMicrotask(() => {
                        fakeChild.emit('spawn');
                        fakeChild.stdout.write('secret-output-'.repeat(100));
                    });
                    return fakeChild;
                },
                processController: {
                    capture: async () => [fakeChild.pid],
                    cleanup: async () => true,
                },
            },
        );
        await expect(execution).rejects.toMatchObject({ code: 'NAVIGATION_FAILED' });
    });
});

linuxPidNamespaceTest('production controller tears down a real resistant descendant and closes pipes', async () => {
    let spawned: ReturnType<typeof spawn> | undefined;
    let spawnedArgs: string[] = [];
    const nativeWindows = process.platform === 'win32';
    const emergencyController = parent.createProcessTreeController({ atomicWindowsJob: nativeWindows });
    const waitForExit = async (pid: number) => {
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
            try { process.kill(pid, 0); } catch { return; }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
        throw new Error('fixture process survived teardown');
    };
    await withFakeChild("import { spawn } from 'node:child_process'; import { existsSync } from 'node:fs'; import { writeFile } from 'node:fs/promises'; import { createServer } from 'node:net'; const descendant = spawn(process.execPath, ['-e', \"const { createServer } = require('node:net'); const { writeFileSync } = require('node:fs'); const server = createServer().listen(0, '127.0.0.1', () => writeFileSync(process.env.FIXTURE_PORT_FILE, String(server.address().port))); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\"], { stdio: 'ignore', env: { ...process.env } }); for (let attempt = 0; attempt < 100 && !existsSync(process.env.FIXTURE_PORT_FILE); attempt += 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 10)); if (!existsSync(process.env.FIXTURE_PORT_FILE)) process.exit(125); await writeFile(process.env.FIXTURE_PID_FILE, JSON.stringify({ root: process.pid, descendant: descendant.pid })); process.stdout.write('ready\\n'); setInterval(()=>{},1000);", async (directory, childPath) => {
        const pidFile = join(directory, 'descendant.pid');
        const portFile = join(directory, 'descendant.port');
        try {
            await expect(parent.runChild(
                { PATH: process.env.PATH || '', FIXTURE_PID_FILE: pidFile, FIXTURE_PORT_FILE: portFile },
                [],
                directory,
                origin.origin,
                1_500,
                {
                    childPath,
                    executable: fixtureNodeExecutable,
                    closeTimeoutMs: 5_000,
                    cleanupTimeoutMs: 10_000,
                    workingDirectory: root,
                    platform: nativeWindows ? 'win32' : 'linux',
                    trustedWindowsJobBoundary: nativeWindows,
                    spawnChild: (...args: Parameters<typeof spawn>) => {
                        spawnedArgs = args[1] as string[];
                        spawned = spawn(...args);
                        return spawned;
                    },
                },
            )).rejects.toMatchObject({ code: 'NAVIGATION_FAILED' });
            const pids = JSON.parse(await readFile(pidFile, 'utf8'));
            const port = Number(await readFile(portFile, 'utf8'));
            expect(Number.isInteger(pids.root)).toBe(true);
            expect(Number.isInteger(pids.descendant)).toBe(true);
            expect(Number.isInteger(port)).toBe(true);
            const probe = createServer();
            await new Promise<void>((resolveListen, rejectListen) => {
                probe.once('error', rejectListen);
                probe.listen(port, '127.0.0.1', () => resolveListen());
            });
            await new Promise<void>((resolveClose, rejectClose) => {
                probe.close((error) => error ? rejectClose(error) : resolveClose());
            });
            if (spawned?.pid) await waitForExit(spawned.pid);
            if (nativeWindows) expect(spawnedArgs).toContain('-EncodedCommand');
            expect(spawned?.stdout?.destroyed).toBe(true);
            expect(spawned?.stderr?.destroyed).toBe(true);
        } finally {
            if (spawned?.pid) await emergencyController.cleanup(spawned.pid, 'SIGKILL', 1_000);
        }
    });
}, 30_000);

function stateWithAccessToken(accessToken: string) {
    const cookieValue = `base64-${Buffer.from(JSON.stringify({ access_token: accessToken, refresh_token: 'refresh-1234567890123456' })).toString('base64')}`;
    return parent.validateStorageState(validState(origin.hostname, cookieValue), origin);
}

function rawJwt(header: string, payload: string) {
    return [
        Buffer.from(header).toString('base64url'),
        Buffer.from(payload).toString('base64url'),
        Buffer.from('signature').toString('base64url'),
    ].join('.');
}

test('bound session identity requires canonical duplicate-free JWT claims and a bounded opaque refresh digest', async () => {
    const state = stateWithAccessToken(jwt());
    const identity = parent.parseBoundSessionIdentity(state, now);
    expect(identity).toMatchObject({
        userId,
        sessionId,
        issuedAt: now - 10,
        expiresAt: now + 300,
    });
    expect(JSON.stringify(identity)).not.toContain('refresh-1234567890123456');
    expect(identity.refreshSha256).toBe(createHash('sha256').update('tzudong:release-auth-refresh-binding:v1\nrefresh-1234567890123456').digest('hex'));

    const refreshState = (refreshToken: unknown) => parent.validateStorageState(validState(origin.hostname, `base64-${Buffer.from(JSON.stringify({ access_token: jwt(), refresh_token: refreshToken })).toString('base64')}`), origin);
    for (const refreshToken of [undefined, '', 'short', 'has/a-slash', 'x'.repeat(4097)]) {
        expect(() => parent.parseBoundSessionIdentity(refreshState(refreshToken), now)).toThrow();
    }
    const parentSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke.mjs'), 'utf8');
    expect(parentSource.indexOf('identity = parseBoundSessionIdentity(decodedState)')).toBeLessThan(parentSource.indexOf('const canary = await runChild'));

    const invalidTokens = [
        jwt({ sub: undefined }),
        jwt({ sub: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
        jwt({ session_id: undefined }),
        jwt({ session_id: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB' }),
        jwt({ iat: now + 61 }),
        jwt({ exp: now }),
        rawJwt('{"alg":"none","typ":"JWT"}', JSON.stringify({ sub: userId, session_id: sessionId, iat: now - 10, exp: now + 300 })),
        rawJwt('{"alg":"ES256","alg":"RS256"}', JSON.stringify({ sub: userId, session_id: sessionId, iat: now - 10, exp: now + 300 })),
        rawJwt('{"alg":"ES256"}', `{"sub":"${userId}","sub":"${userId}","session_id":"${sessionId}","iat":${now - 10},"exp":${now + 300}}`),
    ];
    for (const token of invalidTokens) {
        expect(() => parent.parseBoundSessionIdentity(stateWithAccessToken(token), now)).toThrow();
    }
});

test('authoritative identity and preflight RPCs bind the dedicated user, refresh digest, and exact lease', async () => {
    const identity = parent.parseBoundSessionIdentity(stateWithAccessToken(jwt()), now);
    const operationId = '33333333-3333-4333-8333-333333333333';
    const expiresAt = now + 60;
    const calls: Array<{ pathname: string; options: Record<string, unknown> }> = [];
    const fetcher = async (url: URL, options: Record<string, unknown>) => {
        calls.push({ pathname: url.pathname, options });
        if (url.pathname === '/auth/v1/user') return jsonResponse({ id: userId, role: 'authenticated' }, url.toString());
        if (url.pathname === '/rest/v1/rpc/preflight_release_auth_session_family') {
            return jsonResponse({ schemaVersion: 2, status: 'compatible_bound', dedicatedIdentity: true, sessionBound: true, refreshBound: true, leaseActive: true, operationId, expiresAt }, url.toString());
        }
        throw new Error('unexpected request');
    };

    expect(await parent.validateReleaseSessionIdentity(identity, 'anon-key', userId, fetcher)).toBe(true);
    expect(await parent.preflightReleaseSessionFamily(identity, operationId, expiresAt, 'service-key', fetcher)).toEqual({
        schemaVersion: 2,
        status: 'compatible_bound',
        dedicatedIdentity: true,
        sessionBound: true,
        refreshBound: true,
        leaseActive: true,
        operationId,
        expiresAt,
    });
    expect(calls.map((call) => call.pathname)).toEqual([
        '/auth/v1/user',
        '/rest/v1/rpc/preflight_release_auth_session_family',
    ]);
    const userHeaders = (calls[0].options.headers as Record<string, string>);
    expect(userHeaders.apikey).toBe('anon-key');
    expect(userHeaders.authorization).toBe(`Bearer ${identity.accessToken}`);
    expect(calls[1].options.body).toBe(parent.canonicalJson({ p_expires_at: expiresAt, p_operation_id: operationId, p_refresh_sha256: identity.refreshSha256, p_session_id: sessionId, p_user_id: userId }));
    expect(JSON.stringify(calls[1].options.body)).not.toContain('refresh-1234567890123456');
    await expect(parent.preflightReleaseSessionFamily(identity, operationId, now + 901, 'service-key', fetcher)).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
    await expect(parent.validateReleaseSessionIdentity(identity, 'anon-key', '33333333-3333-4333-8333-333333333333', fetcher)).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
    const userUrl = 'https://aqlcofblfxdrjhhdmarw.supabase.co/auth/v1/user';
    await expect(parent.validateReleaseSessionIdentity(identity, 'anon-key', userId, async () => ({
        ok: true,
        status: 200,
        url: userUrl,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => `{"id":"${userId}","id":"${userId}"}`,
    }))).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
    await expect(parent.validateReleaseSessionIdentity(identity, 'anon-key', userId, async () => ({
        ...jsonResponse({ id: userId }, userUrl),
        headers: new Headers({ 'content-type': 'application/json', 'content-length': '65537' }),
    }))).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
});

test('authoritative revocation retries idempotently and requires exact readback', async () => {
    const identity = parent.parseBoundSessionIdentity(stateWithAccessToken(jwt()), now);
    const operationId = '33333333-3333-4333-8333-333333333333';
    const receipt = {
        schemaVersion: 1,
        operationId,
        bindingSha256: 'f'.repeat(64),
        status: 'revoked_verified',
        refreshTokensDeleted: 2,
        sessionsDeleted: 1,
        sessionAbsent: true,
        refreshTokensAbsent: true,
        revokedAt: '2026-07-11T12:00:00.000Z',
    };
    const calls: Array<{ pathname: string; options: Record<string, unknown> }> = [];
    let revokeAttempts = 0;
    const fetcher = async (url: URL, options: Record<string, unknown>) => {
        calls.push({ pathname: url.pathname, options });
        if (url.pathname === '/rest/v1/rpc/revoke_release_auth_session_family' && ++revokeAttempts === 1) {
            throw new Error('lost response');
        }
        return jsonResponse(receipt, url.toString());
    };

    expect(await parent.revokeReleaseSessionFamily(identity, operationId, receipt.bindingSha256, 'service-key', fetcher, Date.now() + 10_000)).toEqual(receipt);
    expect(calls.map((call) => call.pathname)).toEqual([
        '/rest/v1/rpc/revoke_release_auth_session_family',
        '/rest/v1/rpc/revoke_release_auth_session_family',
        '/rest/v1/rpc/read_release_auth_revocation',
    ]);
    const expectedRevokeBody = parent.canonicalJson({ p_binding_sha256: receipt.bindingSha256, p_operation_id: operationId, p_session_id: sessionId, p_user_id: userId });
    const expectedReadBody = parent.canonicalJson({ p_operation_id: operationId, p_session_id: sessionId, p_user_id: userId });
    for (const [index, call] of calls.entries()) {
        expect(call.options.body).toBe(index < 2 ? expectedRevokeBody : expectedReadBody);
        expect(call.options.redirect).toBe('error');
        const headers = call.options.headers as Record<string, string>;
        expect(headers.apikey).toBe('service-key');
        expect(headers.authorization).toBe('Bearer service-key');
    }
    expect(JSON.stringify(calls)).not.toContain(identity.accessToken);
    expect(JSON.stringify(calls)).not.toContain('refresh-1234567890123456');

    let malformedCalls = 0;
    await expect(parent.revokeReleaseSessionFamily(
        identity,
        operationId,
        receipt.bindingSha256,
        'service-key',
        async (url: URL) => {
            malformedCalls += 1;
            return jsonResponse({ ...receipt, unexpected: true }, url.toString());
        },
        Date.now() + 10_000,
    )).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
    expect(malformedCalls).toBe(3);

    let expiredCalls = 0;
    await expect(parent.revokeReleaseSessionFamily(
        identity,
        operationId,
        receipt.bindingSha256,
        'service-key',
        async () => {
            expiredCalls += 1;
            return jsonResponse(receipt, 'https://unused.invalid/');
        },
        Date.now() - 1,
    )).rejects.toMatchObject({ code: 'SESSION_REVOCATION_FAILED' });
    expect(expiredCalls).toBe(0);
});

test('browser child cannot revoke or receive parent-only Supabase credentials', async () => {
    const parentSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke.mjs'), 'utf8');
    const childSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke-child.mjs'), 'utf8');
    for (const forbidden of [
        '/auth/v1/token',
        '/auth/v1/logout',
        'RELEASE_AUTH_SUPABASE_URL',
        'RELEASE_AUTH_SUPABASE_ANON_KEY',
        'RELEASE_AUTH_SUPABASE_SERVICE_ROLE_KEY',
        'refresh_token',
    ]) {
        expect(childSource).not.toContain(forbidden);
    }
    expect(childSource).toContain("revocationReceipt: 'parent_required'");
    expect(parentSource).toContain('await revokeReleaseSessionFamily(identity, operationId, bindingSha256, serviceKey)');
    expect(parentSource).toContain("sha256('tzudong:release-auth-revocation:v1\\n', receipt)");
    expect(parentSource).toContain("const baseEnv = { PATH: process.env.PATH || '', TMP: directory, TEMP: directory, TMPDIR: directory }");
    expect(parentSource).not.toContain('...process.env');

    const fakeChild = createFakeSpawnedChild();
    let argv: string[] = [];
    let spawnedEnvironment: Record<string, string> | undefined;
    const execution = parent.runChild(
        { PATH: process.env.PATH || '', RELEASE_AUTH_STORAGE_STATE_B64: validState() },
        [],
        tmpdir(),
        'https://tzudong.app',
        20,
        {
            spawnChild: (_command: string, args: string[], options: { env: Record<string, string> }) => {
                argv = args;
                spawnedEnvironment = options.env;
                queueMicrotask(() => {
                    fakeChild.emit('spawn');
                    fakeChild.emit('close', 0);
                });
                return fakeChild;
            },
            processController: { capture: async () => [41], cleanup: async () => true },
        },
    );
    await expect(execution).resolves.toMatchObject({ code: 0 });
    expect(argv).toEqual(expect.arrayContaining(['--origin', 'https://tzudong.app/']));
    expect(spawnedEnvironment).not.toHaveProperty('RELEASE_AUTH_SUPABASE_URL');
    expect(spawnedEnvironment).not.toHaveProperty('RELEASE_AUTH_SUPABASE_ANON_KEY');
    expect(spawnedEnvironment).not.toHaveProperty('RELEASE_AUTH_SUPABASE_SERVICE_ROLE_KEY');
});

test('revocation migration, active-session authorization, and containment are fail closed', async () => {
    const migration = await readFile(resolve(root, '../../backend/supabase/migrations/20260711000100_release_auth_session_revocation.sql'), 'utf8');
    const parentSource = await readFile(resolve(root, 'scripts/run-auth-release-smoke.mjs'), 'utf8');
    const requireAdminSource = await readFile(resolve(root, 'lib/auth/require-admin.ts'), 'utf8');
    const middlewareSource = await readFile(resolve(root, 'lib/supabase/middleware.ts'), 'utf8');
    expect(migration).toContain("to_regclass('auth.sessions')");
    expect(migration).toContain("to_regclass('auth.refresh_tokens')");
    expect(migration).toContain("a.attname = 'token'");
    expect(migration).toContain("refresh_token_type IS DISTINCT FROM 'character varying(255)' OR refresh_token_not_null IS DISTINCT FROM false");
    expect(migration).toContain("extensions.digest('tzudong:release-auth-refresh-binding:v1' || pg_catalog.chr(10) || r.token, 'sha256')");
    expect(migration.indexOf("to_regprocedure('extensions.digest(text,text)')")).toBeLessThan(migration.indexOf("extensions.digest('tzudong:release-auth-refresh-binding:v1'"));
    expect(migration).toContain('matching_refresh_count <> 1');
    expect(migration).toContain('operation lease mismatch');
    expect(migration).toContain('session lease conflict');
    expect(migration).toContain('exact release lease is required');
    expect(migration).toContain('IF NOT EXISTS (SELECT 1 FROM public.release_auth_identities i WHERE i.user_id = current_user_id) THEN RETURN true; END IF;');
    expect(migration).not.toContain('i.user_id = current_user_id AND i.enabled');
    expect(migration).toContain('SELECT * INTO lease FROM public.release_auth_session_leases l WHERE l.user_id = p_user_id AND l.session_id = p_session_id FOR UPDATE;');
    expect(migration).toContain('expired release lease reclamation verification failed');
    expect(migration).toContain('expired release lease reclamation closure failed');
    expect(migration).toContain("VALUES (lease.operation_id, lease.user_id, lease.session_id, lease.refresh_sha256, 'expired_reclaimed'");
    expect(migration).toContain("'status', 'expired_reclaimed', 'dedicatedIdentity', false, 'sessionBound', false, 'refreshBound', false, 'leaseActive', false");
    expect(migration.indexOf("'status', 'expired_reclaimed'")).toBeLessThan(
      migration.indexOf('SELECT count(*) INTO enabled_count'),
    );
    expect(migration).toContain("status text NOT NULL CHECK (status IN ('revoked_verified', 'expired_reclaimed'))");
    expect(migration).toContain('sessions_deleted integer NOT NULL CHECK (sessions_deleted >= 0)');
    expect(migration).toContain('DELETE FROM auth.refresh_tokens r WHERE r.session_id = current_session_id;');
    expect(migration).toContain('DELETE FROM auth.sessions s WHERE s.id = current_session_id AND s.user_id = current_user_id;');
    expect(parentSource.indexOf('await preflightReleaseSessionFamily(identity, operationId, release.expiresAt, serviceKey)')).toBeLessThan(parentSource.indexOf('const canary = await runChild'));
    expect(migration).toContain('CREATE TABLE public.release_auth_identities');
    expect(migration).toContain('CREATE TABLE public.release_auth_session_leases');
    expect(migration).toContain('CREATE TABLE public.release_auth_revocation_receipts');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS');
    expect(migration).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(migration).toContain("CREATE FUNCTION public.is_current_auth_session_active()");
    expect(migration).toContain('LANGUAGE plpgsql VOLATILE SECURITY DEFINER');
    expect(migration).toContain("auth.jwt() ->> 'session_id'");
    expect(migration).toContain('s.id = jwt_session_id AND s.user_id = auth.uid()');
    expect(migration).toContain('lease.expires_at > pg_catalog.clock_timestamp()');
    expect(migration).toContain('DELETE FROM public.release_auth_session_leases');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.is_current_auth_session_active() TO authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.read_release_auth_revocation_by_operation(uuid) TO anon, authenticated');
    expect(migration).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(6);
    expect(migration.match(/service role required/g)).toHaveLength(3);
    expect(migration.match(/request\.jwt\.claims/g)).toHaveLength(4);
    expect(migration).toContain('DELETE FROM auth.refresh_tokens');
    expect(migration).toContain('DELETE FROM auth.sessions');
    expect(migration).toContain('release_auth_identities_single_enabled_idx');
    expect(migration).toContain('UNIQUE (user_id, session_id)');
    expect(migration).toContain('refresh_sha256 text NOT NULL');
    expect(migration).toContain('binding_sha256 text NOT NULL');
    expect(migration).not.toMatch(/\b(access_token|refresh_token|password|cookie|service_key)\b/i);
    expect(parentSource.indexOf('cleanupRequired = true')).toBeLessThan(parentSource.indexOf('await validateReleaseSessionIdentity'));
    expect(parentSource).toContain("'--user', '--map-root-user', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL'");
    expect(parentSource).toContain("fs.writeSync(3, 'READY ' + nonce + ' ' + deadline + '\\n')");
    expect(parentSource).toContain("fs.writeSync(3, 'COMPLETE ' + nonce + ' ' + deadline + '\\n')");
    expect(parentSource).toContain("control.write(`ACK ${containmentNonce} ${containmentDeadline}\\n`)");
    expect(parentSource).toContain("if (!protocolAcknowledged || !protocolStarted || !protocolComplete || (useNativeWindowsJobSupervisor && !protocolClosed))");
    expect(parentSource).toContain("const complete = (code) => {");
    expect(parentSource).toContain("process.exit(code);");
    expect(parentSource).toContain("child.once('close', (code, signal) => { if (signal || !Number.isInteger(code) || code < 0 || code > 255) abort(); else complete(code); });");
    expect(parentSource).toContain("const watchControl = () => {");
    expect(parentSource).toContain("control.once('end', abort)");
    expect(parentSource).not.toContain('process.kill(parentPid, 0)');
    expect(parentSource).toContain("watchdog = setInterval(() => { if (Date.now() > deadline) abort(); }, 50)");
    expect(parentSource).toContain('TerminateJobObject(job,125)');
    expect(parentSource).toContain('ActiveProcessCount(job)!=0');
    expect(parentSource).toContain("stdio: useNativeLinuxPidNamespace ? ['ignore', 'pipe', 'pipe', 'pipe']");
    expect(parentSource).not.toContain('kill(-pid');
    expect(parentSource).toContain('export function selectLinuxSupervisorExecutable');
    expect(parentSource).toContain("if (protocolTimer) { clearTimeout(protocolTimer); protocolTimer = undefined; }");
    expect(parentSource).toContain("if (teardown) return;");

    const getUserIndex = requireAdminSource.indexOf('supabase.auth.getUser()');
    const activeSessionIndex = requireAdminSource.indexOf("rpc('is_current_auth_session_active' as never)");
    const roleIndex = requireAdminSource.indexOf(".from('user_roles' as never)");
    expect(activeSessionIndex).toBeGreaterThan(getUserIndex);
    expect(activeSessionIndex).toBeLessThan(roleIndex);
    expect(requireAdminSource).toContain('activeSessionError || activeSession !== true');
    expect(requireAdminSource).toContain("NextResponse.json({ error: 'Unauthorized' }, { status: 401 })");
    expect(middlewareSource).toContain("pathname.startsWith('/api/admin/')");
    expect(middlewareSource).toContain('const isProtectedAdminRequest');
    expect(middlewareSource).toContain('isAdminNavigationRequest(request)');
    expect(middlewareSource).toContain("adminJsonResponseWithSessionCookies(sourceResponse, 'Unauthorized', 401)");
    expect(middlewareSource).toContain("adminJsonResponseWithSessionCookies(sourceResponse, 'Forbidden', 403)");
    expect(middlewareSource).toContain("accountStatusError || accountStatus?.account_status !== 'active'");
    expect(middlewareSource).not.toContain('isMissingOptionalAdminStatusStoreError');
});
test('Linux supervisor runtime selection fails closed outside verified Node 24', () => {
    const configured = resolve(tmpdir(), 'configured-node24');
    const validFallback = resolve(tmpdir(), 'valid-fallback-node24');
    const fallback = resolve(tmpdir(), 'fallback-runtime');
    const wrongVersion = resolve(tmpdir(), 'wrong-node');
    const versions = new Map([
        [configured, 'v24.6.0'],
        [validFallback, 'v24.6.0'],
        [fallback, 'v20.19.0'],
        [wrongVersion, 'v23.0.0'],
    ]);
    const probe = (candidate: string) => versions.get(candidate) ?? null;
    expect(parent.selectLinuxSupervisorExecutable(configured, fallback, probe)).toBe(configured);
    expect(parent.selectLinuxSupervisorExecutable('relative-node24', validFallback, probe)).toBe(validFallback);
    expect(parent.selectLinuxSupervisorExecutable(wrongVersion, fallback, probe)).toBeNull();
    expect(parent.selectLinuxSupervisorExecutable(undefined, wrongVersion, probe)).toBeNull();
});