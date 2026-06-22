#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);

const readArg = (name, fallback) => {
    const exactIndex = args.indexOf(name);
    if (exactIndex >= 0) {
        return args[exactIndex + 1] ?? fallback;
    }

    const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(name.length + 1) : fallback;
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
    stdio: 'inherit',
});

if (syncResult.error) {
    console.error(syncResult.error instanceof Error ? syncResult.error.message : String(syncResult.error));
    process.exit(1);
}

if (syncResult.status !== 0) {
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
        stdio: 'inherit',
    },
);

child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
