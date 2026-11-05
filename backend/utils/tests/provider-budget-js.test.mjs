import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { withProjectBudget } from '../provider-budget.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-budget-js-test-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForFile(file, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file)) {
        if (Date.now() >= deadline) throw new Error('fixture_timeout');
        await pause(10);
    }
}

test('explicit worker environment scopes both budget acquisition and release', async () => {
    const script = path.join(directory, 'env-budget-fixture');
    const log = path.join(directory, 'env-budget-log');
    fs.writeFileSync(script, `#!${process.execPath}\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release','cooldown'].includes(value));\nconst lease=args[args.indexOf('--lease')+1];\nfs.appendFileSync(process.env.FX_ENV_LOG,JSON.stringify({action,project:process.env.GEMINI_BUDGET_PROJECT})+'\\n');\nif(action==='acquire')process.stdout.write(lease);\n`, { mode: 0o700 });
    const env = { ...process.env, RUN_DAILY_PYTHON: script, FX_ENV_LOG: log, GEMINI_BUDGET_PROJECT: 'worker-env-file' };

    assert.equal(await withProjectBudget(async () => 'scoped', { env, acquireTimeoutMs: 1000 }), 'scoped');

    const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(entries, [
        { action: 'acquire', project: 'worker-env-file' },
        { action: 'release', project: 'worker-env-file' },
    ]);
});

test('real helper accepts the parent lease identity and releases capacity', async () => {
    const env = {
        ...process.env,
        GEMINI_BUDGET_PATH: path.join(directory, 'real-budget.sqlite'),
        GEMINI_BUDGET_PROJECT: 'worker-real-fixture',
        GEMINI_REQUESTS_PER_MINUTE: '100000',
        GEMINI_MAX_INFLIGHT: '1',
    };
    delete env.RUN_DAILY_PYTHON;
    let calls = 0;

    assert.equal(await withProjectBudget(async () => ++calls, { env, acquireTimeoutMs: 1000 }), 1);
    assert.equal(await withProjectBudget(async () => ++calls, { env, acquireTimeoutMs: 1000 }), 2);
});

test('a spawn failure creates no fictitious release debt', async () => {
    let workStarted = false;
    await assert.rejects(withProjectBudget(async () => { workStarted = true; }, {
        env: { ...process.env, RUN_DAILY_PYTHON: path.join(directory, 'missing-python') },
        acquireTimeoutMs: 1000,
    }), /PROVIDER_BUDGET_UNAVAILABLE/);
    assert.equal(workStarted, false);

    const script = path.join(directory, 'recovered-budget-fixture');
    fs.writeFileSync(script, `#!${process.execPath}\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release'].includes(value));\nif(action==='acquire')process.stdout.write(args[args.indexOf('--lease')+1]);\n`, { mode: 0o700 });
    assert.equal(await withProjectBudget(async () => 'recovered', {
        env: { ...process.env, RUN_DAILY_PYTHON: script }, acquireTimeoutMs: 1000,
    }), 'recovered');
});

test('parent validation rejection creates no release debt for a corrected environment', async () => {
    const budgetPath = path.join(directory, 'rejected-budget.sqlite');
    const rejectedEnv = {
        ...process.env,
        GEMINI_BUDGET_PATH: budgetPath,
        GEMINI_BUDGET_PROJECT: 'invalid/project',
        GEMINI_REQUESTS_PER_MINUTE: '100000',
        GEMINI_MAX_INFLIGHT: '1',
    };
    delete rejectedEnv.RUN_DAILY_PYTHON;
    let workStarted = false;

    await assert.rejects(withProjectBudget(async () => { workStarted = true; }, {
        env: rejectedEnv,
        acquireTimeoutMs: 1000,
    }), /PROVIDER_BUDGET_UNAVAILABLE/);
    assert.equal(workStarted, false);

    const correctedEnv = { ...rejectedEnv, GEMINI_BUDGET_PROJECT: 'corrected-project' };
    assert.equal(await withProjectBudget(async () => 'recovered', {
        env: correctedEnv,
        acquireTimeoutMs: 1000,
    }), 'recovered');
});

test('canonical pre-commit rejection creates no release debt for a corrected path', async () => {
    const blockingParent = path.join(directory, 'not-a-directory');
    fs.writeFileSync(blockingParent, 'fixture');
    const rejectedEnv = {
        ...process.env,
        GEMINI_BUDGET_PATH: path.join(blockingParent, 'budget.sqlite'),
        GEMINI_BUDGET_PROJECT: 'canonical-rejection-fixture',
        GEMINI_REQUESTS_PER_MINUTE: '100000',
        GEMINI_MAX_INFLIGHT: '1',
    };
    delete rejectedEnv.RUN_DAILY_PYTHON;

    await assert.rejects(withProjectBudget(async () => 'unexpected', {
        env: rejectedEnv, acquireTimeoutMs: 1000,
    }), /PROVIDER_BUDGET_UNAVAILABLE/);
    assert.equal(await withProjectBudget(async () => 'recovered', {
        env: { ...rejectedEnv, GEMINI_BUDGET_PATH: path.join(directory, 'canonical-recovered.sqlite') },
        acquireTimeoutMs: 1000,
    }), 'recovered');
});

test('custom false rejection tuples after commit are ambiguous and release the selected lease', async () => {
    for (const exitCode of [1, 20]) {
        const script = path.join(directory, `ambiguous-exit-budget-fixture-${exitCode}`);
        const ledger = path.join(directory, `ambiguous-exit-budget-ledger-${exitCode}`);
        const releases = path.join(directory, `ambiguous-exit-budget-releases-${exitCode}`);
        fs.writeFileSync(script, `#!${process.execPath}\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release'].includes(value));\nconst lease=args[args.indexOf('--lease')+1];\nif(action==='acquire'){fs.writeFileSync(process.env.FX_LEDGER,lease);process.stderr.write('PROVIDER_BUDGET_UNAVAILABLE\\n');process.exit(Number(process.env.FX_EXIT_CODE));}\nif(action==='release'){if(fs.existsSync(process.env.FX_LEDGER)&&fs.readFileSync(process.env.FX_LEDGER,'utf8')===lease)fs.unlinkSync(process.env.FX_LEDGER);fs.appendFileSync(process.env.FX_RELEASES,lease+'\\n');}\n`, { mode: 0o700 });
        const env = {
            ...process.env, RUN_DAILY_PYTHON: script, FX_LEDGER: ledger,
            FX_RELEASES: releases, FX_EXIT_CODE: String(exitCode),
        };
        let workStarted = false;

        await assert.rejects(withProjectBudget(async () => { workStarted = true; }, {
            env, acquireTimeoutMs: 1000,
        }), /PROVIDER_BUDGET_UNAVAILABLE/);

        assert.equal(workStarted, false);
        assert.equal(fs.existsSync(ledger), false);
        assert.equal(fs.readFileSync(releases, 'utf8').trim().split('\n').length, 1);
    }
});

test('a healthy runner drains old-scope debt left by a disappeared runner', async () => {
    const broken = path.join(directory, 'disappearing-budget-fixture');
    const healthy = path.join(directory, 'healthy-budget-fixture');
    const ledger = path.join(directory, 'runner-recovery-ledger');
    const log = path.join(directory, 'runner-recovery-log');
    const lost = path.join(directory, 'runner-recovery-lost-release');
    fs.writeFileSync(broken, `#!${process.execPath}\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nconst lease=args[args.indexOf('--lease')+1];\nfs.writeFileSync(process.env.FX_LEDGER,lease);\nfs.unlinkSync(process.argv[1]);\nprocess.stdout.write(lease);\n`, { mode: 0o700 });
    fs.writeFileSync(healthy, `#!${process.execPath}\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release'].includes(value));\nconst lease=args[args.indexOf('--lease')+1];\nfs.appendFileSync(process.env.FX_LOG,JSON.stringify({action,lease,project:process.env.GEMINI_BUDGET_PROJECT,path:process.env.GEMINI_BUDGET_PATH})+'\\n');\nif(action==='release'){\n if(fs.existsSync(process.env.FX_LEDGER)&&fs.readFileSync(process.env.FX_LEDGER,'utf8')===lease)fs.unlinkSync(process.env.FX_LEDGER);\n if(!fs.existsSync(process.env.FX_LOST)){fs.writeFileSync(process.env.FX_LOST,'yes');process.exit(1);}\n}else if(action==='acquire'){\n if(fs.existsSync(process.env.FX_LEDGER))process.exit(1);\n fs.writeFileSync(process.env.FX_LEDGER,lease);process.stdout.write(lease);\n}\n`, { mode: 0o700 });
    const oldEnv = {
        ...process.env, RUN_DAILY_PYTHON: broken, FX_LEDGER: ledger,
        GEMINI_BUDGET_PROJECT: 'old-project', GEMINI_BUDGET_PATH: '/old/budget.sqlite',
    };
    assert.equal(await withProjectBudget(async () => 'paid-result', {
        env: oldEnv, acquireTimeoutMs: 1000,
    }), 'paid-result');
    assert.equal(fs.existsSync(ledger), true);

    const newEnv = {
        ...process.env, RUN_DAILY_PYTHON: healthy, FX_LEDGER: ledger, FX_LOG: log, FX_LOST: lost,
        GEMINI_BUDGET_PROJECT: 'new-project', GEMINI_BUDGET_PATH: '/new/budget.sqlite',
    };
    assert.equal(await withProjectBudget(async () => 'next-result', {
        env: newEnv, acquireTimeoutMs: 1000,
    }), 'next-result');
    assert.equal(fs.existsSync(ledger), false);
    const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(entries.map(({ action, project, path: budgetPath }) => ({ action, project, path: budgetPath })), [
        { action: 'release', project: 'old-project', path: '/old/budget.sqlite' },
        { action: 'release', project: 'old-project', path: '/old/budget.sqlite' },
        { action: 'acquire', project: 'new-project', path: '/new/budget.sqlite' },
        { action: 'release', project: 'new-project', path: '/new/budget.sqlite' },
    ]);
});

test('abort before a spawn error creates no fictitious release debt', async () => {
    const controller = new AbortController();
    const reason = new DOMException('fixture_cancelled_before_spawn', 'AbortError');
    const pending = withProjectBudget(async () => 'unexpected', {
        env: { ...process.env, RUN_DAILY_PYTHON: path.join(directory, 'missing-aborted-python') },
        signal: controller.signal,
        acquireTimeoutMs: 1000,
    });
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);

    const script = path.join(directory, 'abort-spawn-recovered-fixture');
    fs.writeFileSync(script, `#!${process.execPath}\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release'].includes(value));\nif(action==='acquire')process.stdout.write(args[args.indexOf('--lease')+1]);\n`, { mode: 0o700 });
    assert.equal(await withProjectBudget(async () => 'recovered', {
        env: { ...process.env, RUN_DAILY_PYTHON: script }, acquireTimeoutMs: 1000,
    }), 'recovered');
});

test('abort terminates a waiting acquire child and releases a commit-before-close lease exactly once', async () => {
    const script = path.join(directory, 'abort-budget-fixture');
    const started = path.join(directory, 'abort-budget-started.json');
    const terminated = path.join(directory, 'abort-budget-terminated');
    const ledger = path.join(directory, 'abort-budget-ledger');
    const released = path.join(directory, 'abort-budget-released');
    fs.writeFileSync(script, `#!${process.execPath}\nconst fs=require('fs');\nconst args=process.argv.slice(2);\nconst action=args.find(value=>['acquire','release','cooldown'].includes(value));\nconst lease=args[args.indexOf('--lease')+1];\nif(action==='acquire'){\n process.on('SIGTERM',()=>{fs.writeFileSync(process.env.FX_TERMINATED,'yes');process.exit(143);});\n fs.writeFileSync(process.env.FX_LEDGER,lease);\n fs.writeFileSync(process.env.FX_STARTED,JSON.stringify({pid:process.pid,lease}));\n process.stdout.write(lease);\n setInterval(()=>{},1000);\n}else if(action==='release'){\n if(fs.existsSync(process.env.FX_LEDGER)&&fs.readFileSync(process.env.FX_LEDGER,'utf8')===lease)fs.unlinkSync(process.env.FX_LEDGER);\n fs.appendFileSync(process.env.FX_RELEASED,lease+'\\n');\n}\n`, { mode: 0o700 });
    const env = {
        ...process.env, RUN_DAILY_PYTHON: script, FX_STARTED: started, FX_TERMINATED: terminated,
        FX_LEDGER: ledger, FX_RELEASED: released,
    };
    const controller = new AbortController();
    let workStarted = false;
    const pending = withProjectBudget(async () => { workStarted = true; return 'unexpected'; }, { env, signal: controller.signal });
    await waitForFile(started);
    const child = JSON.parse(fs.readFileSync(started, 'utf8'));
    const reason = new DOMException('fixture_cancelled', 'AbortError');
    controller.abort(reason);

    await assert.rejects(pending, (error) => error === reason);
    assert.equal(workStarted, false);
    assert.equal(fs.existsSync(terminated), true);
    assert.equal(fs.existsSync(ledger), false);
    assert.deepEqual(fs.readFileSync(released, 'utf8').trim().split('\n'), [child.lease]);
    assert.throws(() => process.kill(child.pid, 0), (error) => error.code === 'ESRCH');
});
