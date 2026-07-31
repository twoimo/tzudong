#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const args = process.argv.slice(2);

const readArg = (name, fallback) => {
    const exactIndex = args.indexOf(name);
    if (exactIndex >= 0) {
        return args[exactIndex + 1] ?? fallback;
    }

    const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(name.length + 1) : fallback;
};
const childOutputLimit = 4_096;

const writeRedactedChildOutput = (value, target) => {
    const text = typeof value === 'string'
        ? value
        : Buffer.isBuffer(value)
            ? value.toString('utf8')
            : '';
    if (text) {
        target.write(redactCliText(text, childOutputLimit));
    }
};

const forwardChildOutput = (stream, target) => {
    if (!stream?.on) {
        return;
    }

    stream.on('data', (chunk) => writeRedactedChildOutput(chunk, target));
};


const childEnv = { ...process.env };
const port = readArg('--port', childEnv.PORT);
const hostname = readArg('--hostname', childEnv.HOSTNAME);

if (port) {
    childEnv.PORT = port;
}

if (hostname) {
    childEnv.HOSTNAME = hostname;
}

const syncResult = spawnSync(process.execPath, ['scripts/sync-standalone-static.mjs'], {
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
});
writeRedactedChildOutput(syncResult.stdout, process.stdout);
writeRedactedChildOutput(syncResult.stderr, process.stderr);

if (syncResult.error) {
    logCliError(syncResult.error, (line) => process.stderr.write(`[start-standalone] static-sync ${line}`));
    process.exit(1);
}

if (syncResult.signal) {
    process.kill(process.pid, syncResult.signal);
} else if (syncResult.status !== 0) {
    process.exit(syncResult.status ?? 1);
}

const child = spawn(
    process.execPath,
    [
        'scripts/clean-next.mjs',
        '--skip-clean',
        '--',
        process.execPath,
        '.next/standalone/apps/web/server.js',
    ],
    {
        env: childEnv,
        stdio: ['inherit', 'pipe', 'pipe'],
    },
);
forwardChildOutput(child.stdout, process.stdout);
forwardChildOutput(child.stderr, process.stderr);


child.on('error', (error) => {
    logCliError(error, (line) => process.stderr.write(`[start-standalone] child-process ${line}`));
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
