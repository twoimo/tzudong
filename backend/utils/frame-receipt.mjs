/** Verified per-segment media reuse with a cross-process single writer. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hashes = new Map();
let broker = null;
const signature = file => {
    const value = fs.statSync(file, { bigint: true });
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
};

export async function mediaInputHash(file) {
    const before = signature(file);
    const cached = hashes.get(file);
    if (cached?.signature === before) return cached.hash;
    const digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    if (signature(file) !== before) throw new Error('FRAME_INPUT_CHANGED');
    const hash = digest.digest('hex');
    if (hashes.size >= 256) hashes.delete(hashes.keys().next().value);
    hashes.set(file, { signature: before, hash });
    return hash;
}

export function frameInputFingerprint(configuration) {
    return createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
}

async function frameOutputs(directory, extension) {
    const files = fs.readdirSync(directory).filter(file => file.endsWith(`.${extension}`)).sort();
    const result = [];
    for (const file of files) {
        if (fs.lstatSync(path.join(directory, file)).isSymbolicLink()) throw new Error('FRAME_OUTPUT_INVALID');
        result.push([file, await mediaInputHash(path.join(directory, file))]);
    }
    return result;
}

export async function reusableFrames(directory, extension, inputHash) {
    try {
        const stat = fs.statSync(path.join(directory, '.receipt.json'));
        if (fs.lstatSync(path.join(directory, '.receipt.json')).isSymbolicLink()) return null;
        if (stat.size > 1024 * 1024) return null;
        const receipt = JSON.parse(fs.readFileSync(path.join(directory, '.receipt.json'), 'utf8'));
        if (receipt.schemaVersion !== 1 || receipt.inputHash !== inputHash) return null;
        const outputs = await frameOutputs(directory, extension);
        return outputs.length && JSON.stringify(outputs) === JSON.stringify(receipt.outputs) ? outputs.length : null;
    } catch { return null; }
}

function lockBroker() {
    if (broker) return broker;
    const child = spawn(process.env.RUN_DAILY_PYTHON || 'python3',
        ['-m', 'backend.utils.frame_lock_server'],
        { cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
    const state = { child, pending: new Map(), sequence: 0, active: 0, closed: false };
    broker = state;
    function references() {
        const method = state.pending.size || state.active ? 'ref' : 'unref';
        child[method]();child.stdin[method]?.();child.stdout[method]?.();
    }
    const failed = () => {
        if (state.closed) return;
        state.closed = true;
        if (broker === state) broker = null;
        for (const pending of state.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('FRAME_LOCK_UNAVAILABLE')); }
        state.pending.clear();
        child.kill();
    };
    child.once('error',failed);child.once('close',failed);child.stdin.on('error',failed);
    let buffer = '';
    child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 16384) { failed(); return; }
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
            let response;
            try { response = JSON.parse(buffer.slice(0,boundary)); } catch { failed(); return; }
            buffer = buffer.slice(boundary+1);
            const pending = state.pending.get(response.id);
            if (!pending) { failed(); return; }
            state.pending.delete(response.id);clearTimeout(pending.timer);
            if (response.ok === true) pending.resolve(response.id);
            else pending.reject(new Error('FRAME_LOCK_UNAVAILABLE'));
        }
        references();
    });
    state.request = value => new Promise((resolve,reject) => {
        if (state.closed) { reject(new Error('FRAME_LOCK_UNAVAILABLE')); return; }
        const id = ++state.sequence;
        const timer = setTimeout(() => { failed(); reject(new Error('FRAME_LOCK_TIMEOUT')); },600000);
        state.pending.set(id,{resolve,reject,timer});references();
        child.stdin.write(JSON.stringify({id,...value})+'\n');
    });
    state.references = references;
    process.once('beforeExit', () => {
        if (!state.closed && !state.pending.size && !state.active) {
            // Close and reap the broker normally; its CPU belongs to this run.
            child.ref();child.stdout.ref?.();child.stdin.end();
        }
    });
    references();
    return state;
}

export async function withFrameWriter(directory, work) {
    const state = lockBroker();
    state.active++;state.references();
    let identity;
    try {
        identity = await state.request({operation:'acquire',receipt:path.join(directory,'.receipt.json')});
        return await work(() => {
            if (state.closed) throw new Error('FRAME_LOCK_UNAVAILABLE');
        });
    } finally {
        try {
            if (identity !== undefined) await state.request({operation:'release',lockId:identity});
        } finally { state.active--;state.references(); }
    }
}

export async function publishFrames(directory, staged, extension, inputHash) {
    const outputs = await frameOutputs(staged, extension);
    if (!outputs.length) throw new Error('FRAME_SEGMENT_OUTPUT_MISSING');
    // Keep previous images until every new image exists; preserve overwritten
    // outputs for recovery instead of deleting a partial or legacy cache.
    const existing = await frameOutputs(directory, extension);
    if (existing.length) {
        const history = path.join(directory, '.history');
        const archive = path.join(history, frameInputFingerprint(existing));
        for (const target of [history, archive]) {
            if (fs.existsSync(target) && (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink())) throw new Error('FRAME_HISTORY_INVALID');
        }
        fs.mkdirSync(archive, { recursive: true });
        for (const [file, hash] of existing) {
            const target = path.join(archive, file);
            if (fs.existsSync(target) && await mediaInputHash(target) !== hash) throw new Error('FRAME_HISTORY_INVALID');
            fs.renameSync(path.join(directory, file), target);
        }
    }
    for (const [file] of outputs) fs.renameSync(path.join(staged, file), path.join(directory, file));
    const temporary = path.join(directory, `.receipt-${process.pid}-${Date.now()}.tmp`);
    const handle = fs.openSync(temporary, 'wx');
    try {
        fs.writeFileSync(handle, JSON.stringify({ schemaVersion: 1, inputHash, outputs }));
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        fs.renameSync(temporary, path.join(directory, '.receipt.json'));
    } catch (error) {
        try { fs.closeSync(handle); } catch { /* already closed */ }
        throw error;
    } finally {
        fs.rmSync(temporary, { force: true });
    }
    return outputs.length;
}
