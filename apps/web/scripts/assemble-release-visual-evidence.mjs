import { createHash, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, '..');
const templatePath = path.resolve(directory, '../tests/release-visual-cells.template.json');
const HASH = /^[a-f0-9]{64}$/;
export const G009_ISSUER_KEY_ID = 'g009-release-visual-issuer-r2-202607';
export const G009_ISSUER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADwnzGbf8at0hvjdS7I0QUDgLuMo8s/PTJiewWDDv9Hg=
-----END PUBLIC KEY-----`;
const G009_CHANNEL_DOMAIN = 'tzudong:g009:release-visual-channel:v1\n';
const G009_TEMPLATE_SHA256 = 'fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MASK = [255, 0, 255, 255];
const SENSITIVE = /(?:authorization|bearer|cookie|token|password|secret|credential|storageState|localStorage|session|supabase|(?:^|["'\s])(?:[A-Za-z]:[\\/]|\/(?:home|users|tmp|var|private)\/))/i;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PNG_CHUNKS = 4096;
const MAX_IDAT_BYTES = 16 * 1024 * 1024;
const MAX_MASK_RATIO = 0.25;
const MIN_CONTENT_VARIATION_RATIO = 0.01;
const MIN_CONTENT_VARIATION_PIXELS = 64;
const fail = (message) => { throw new Error(`release visual assembly rejected: ${message}`); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (child, root) => child === root || child.startsWith(`${root}${path.sep}`);
function exact(value, keys, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} has unknown or missing fields`); }
function safeDirectory(value, label, external = false) { if (!path.isAbsolute(value)) fail(`${label} must be absolute`); const lexical = path.resolve(value); if (external && inside(lexical, projectRoot)) fail(`${label} must be outside the project`); let stat; try { stat = lstatSync(lexical); } catch { fail(`${label} is missing`); } if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a non-symlink directory`); const resolved = realpathSync(lexical); if (external && inside(resolved, realpathSync(projectRoot))) fail(`${label} must be outside the project`); return resolved; }
function safeFile(value, root, label, maxBytes) { const lexical = path.resolve(value); if (!inside(lexical, root)) fail(`${label} escapes its directory`); let link; try { link = lstatSync(lexical); } catch { fail(`${label} is missing`); } if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1) fail(`${label} must be a single-link non-symlink regular file`); if (!inside(realpathSync(lexical), root)) fail(`${label} escapes its directory`); const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0); let fd; try { fd = openSync(lexical, flags); } catch { fail(`${label} cannot be opened without following links`); } try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== link.dev || stat.ino !== link.ino || !Number.isSafeInteger(stat.size) || stat.size > maxBytes) fail(`${label} changed or exceeds size limit`); const bytes = Buffer.alloc(maxBytes + 1); let offset = 0; while (offset <= maxBytes) { const count = readSync(fd, bytes, offset, maxBytes + 1 - offset, offset); if (!count) break; offset += count; } const after = fstatSync(fd); if (offset > maxBytes || after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== 1 || after.size !== stat.size || after.size !== offset) fail(`${label} changed or exceeds size limit`); return bytes.subarray(0, offset); } finally { closeSync(fd); } }
const ISSUER_PATHS = ['playwright.release.config.ts', 'scripts/assemble-release-visual-evidence.mjs', 'scripts/run-release-visual-evidence.mjs', 'scripts/verify-release-visual-evidence.mjs', 'tests/release-visual-cells.template.json', 'tests/release-visual.spec.ts'];
function validateIssuerBinding(value, gitSha) {
    exact(value, ['commitSha', 'executableDigests', 'manifestSha256', 'schemaVersion', 'treeSha'], 'issuer manifest');
    exact(value.executableDigests, ISSUER_PATHS, 'issuer executable digest map');
    const unsigned = { schemaVersion: value.schemaVersion, commitSha: value.commitSha, treeSha: value.treeSha, executableDigests: value.executableDigests };
    if (value.schemaVersion !== 1 || value.commitSha !== gitSha || !/^[a-f0-9]{40}$/.test(value.treeSha) || !HASH.test(value.manifestSha256) || digest(Buffer.from(canonicalJson(unsigned), 'utf8')) !== value.manifestSha256 || Object.values(value.executableDigests).some((item) => typeof item !== 'string' || !HASH.test(item))) fail('issuer manifest is invalid');
}
function issuerReplayDirectory() {
    return safeDirectory(path.resolve(projectRoot, '..', '.release-visual-protected-replay'), 'issuer replay store', true);
}
function boundedEntries(value, expected, label) { const directory = opendirSync(value); const entries = []; try { for (let entry = directory.readSync(); entry; entry = directory.readSync()) { if (entries.length >= expected) fail(`${label} contains too many entries`); entries.push(entry); } } finally { directory.closeSync(); } return entries; }
function pathExistsSafely(value, label) { try { lstatSync(value); return true; } catch (error) { const code = error && typeof error === 'object' && 'code' in error ? error.code : null; if (code === 'ENOENT') return false; fail(`${label} identity cannot be checked`); } }
function writePinnedFile(filename, bytes, parent, identity, label) { const before = lstatSync(parent); if (before.isSymbolicLink() || before.dev !== identity.dev || before.ino !== identity.ino) fail(`${label} parent identity changed`); let fd; const flags = process.platform === 'win32' ? 'wx' : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0); try { fd = openSync(filename, flags, 0o600); } catch (error) { const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN'; fail(`${label} cannot be created safely: ${code}`); } try { let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, offset); const file = fstatSync(fd); if (!file.isFile() || file.nlink !== 1 || file.size !== bytes.length) fail(`${label} write identity changed`); } finally { closeSync(fd); } const after = lstatSync(parent); if (after.isSymbolicLink() || after.dev !== identity.dev || after.ino !== identity.ino) fail(`${label} parent identity changed`); }
function json(bytes, label) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(`${label} must be UTF-8 JSON`); }
    if (text.includes('\r') || text.charCodeAt(0) === 0xfeff) fail(`${label} must be strict UTF-8 JSON`);
    let index = 0;
    const whitespace = () => { while (text[index] === ' ' || text[index] === '\n' || text[index] === '\t') index += 1; };
    const string = () => {
        const start = index;
        index += 1;
        let escaped = false;
        while (index < text.length) {
            const character = text[index++];
            if (!escaped && character === '"') return JSON.parse(text.slice(start, index));
            escaped = !escaped && character === '\\';
        }
        throw new Error('unterminated string');
    };
    const value = () => {
        whitespace();
        if (text[index] === '{') {
            index += 1;
            const keys = new Set();
            whitespace();
            if (text[index] === '}') { index += 1; return; }
            for (;;) {
                whitespace();
                if (text[index] !== '"') throw new Error('object key');
                const key = string();
                if (keys.has(key)) throw new Error('duplicate key');
                keys.add(key);
                whitespace();
                if (text[index++] !== ':') throw new Error('object separator');
                value();
                whitespace();
                if (text[index] === '}') { index += 1; return; }
                if (text[index++] !== ',') throw new Error('object separator');
            }
        }
        if (text[index] === '[') {
            index += 1;
            whitespace();
            if (text[index] === ']') { index += 1; return; }
            for (;;) {
                value();
                whitespace();
                if (text[index] === ']') { index += 1; return; }
                if (text[index++] !== ',') throw new Error('array separator');
            }
        }
        if (text[index] === '"') { string(); return; }
        const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
        if (!token) throw new Error('value');
        index += token[0].length;
    };
    try {
        value();
        whitespace();
        if (index !== text.length) throw new Error('trailing data');
        return JSON.parse(text);
    } catch { fail(`${label} must be duplicate-free strict UTF-8 JSON`); }
}
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; }
function pixels(bytes, width, height, boxes, label) {
    if (bytes.length < 45 || bytes.length > MAX_PNG_BYTES || !bytes.subarray(0, 8).equals(PNG)) fail(`${label} is not PNG`);
    let offset = 8; let w = 0; let h = 0; let channels = 0; const data = []; let chunkCount = 0; let idatBytes = 0; let state = 'IHDR';
    while (offset + 12 <= bytes.length) {
        if (++chunkCount > MAX_PNG_CHUNKS) fail(`${label} has too many PNG chunks`);
        const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8); const start = offset + 8; const end = start + length;
        if (end + 4 > bytes.length || crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) fail(`${label} has invalid PNG chunks`);
        if (state === 'IHDR') {
            if (type !== 'IHDR' || length !== 13) fail(`${label} has invalid IHDR`);
            w = bytes.readUInt32BE(start); h = bytes.readUInt32BE(start + 4);
            if (!w || !h || w !== width || h !== height || bytes[start + 8] !== 8 || ![2, 6].includes(bytes[start + 9]) || bytes[start + 10] || bytes[start + 11] || bytes[start + 12]) fail(`${label} has unsupported PNG encoding`);
            channels = bytes[start + 9] === 6 ? 4 : 3; state = 'IDAT';
        } else if (state === 'IDAT') {
            if (type !== 'IDAT') fail(`${label} has non-contiguous IDAT chunks`);
            idatBytes += length; if (idatBytes > MAX_IDAT_BYTES) fail(`${label} IDAT data exceeds size limit`);
            data.push(bytes.subarray(start, end)); state = 'IDAT_OR_IEND';
        } else if (state === 'IDAT_OR_IEND') {
            if (type === 'IDAT') { idatBytes += length; if (idatBytes > MAX_IDAT_BYTES) fail(`${label} IDAT data exceeds size limit`); data.push(bytes.subarray(start, end)); }
            else if (type === 'IEND' && length === 0 && end + 4 === bytes.length) { state = 'DONE'; break; }
            else fail(`${label} has invalid PNG chunk order`);
        }
        offset = end + 4;
    }
    if (state !== 'DONE' || !data.length) fail(`${label} has incomplete PNG data`);
    const stride = w * channels; const expectedLength = h * (stride + 1);
    let inflated; const compressed = Buffer.concat(data);
    try { inflated = inflateSync(compressed, { info: true, maxOutputLength: expectedLength }); } catch { fail(`${label} cannot be decompressed`); }
    const raw = inflated.buffer;
    if (inflated.engine.bytesWritten !== compressed.length || raw.length !== expectedLength) fail(`${label} has invalid decompressed data`);
    const image = Buffer.alloc(h * stride); let source = 0;
    for (let y = 0; y < h; y += 1) { const filter = raw[source++]; if (filter > 4) fail(`${label} has unknown PNG filter`); const row = y * stride; for (let x = 0; x < stride; x += 1) { const rawValue = raw[source++]; const left = x >= channels ? image[row + x - channels] : 0; const above = y ? image[row - stride + x] : 0; const upperLeft = y && x >= channels ? image[row - stride + x - channels] : 0; let add = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : 0; if (filter === 4) { const p = left + above - upperLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - above); const pc = Math.abs(p - upperLeft); add = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft; } image[row + x] = (rawValue + add) & 255; } }
    const covered = (x, y) => boxes.some(({ box }) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
    let firstRed; let firstGreen; let firstBlue; let firstAlpha; let maskedPixels = 0; let unmaskedPixels = 0; let variedPixels = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const index = (y * w + x) * channels; if (channels === 4 && image[index + 3] !== 255) fail(`${label} has transparent pixels`); const canonical = image[index] === MASK[0] && image[index + 1] === MASK[1] && image[index + 2] === MASK[2] && (channels === 3 || image[index + 3] === MASK[3]); const masked = covered(x, y); if (masked !== canonical) fail(`${label} has undeclared or incomplete mask pixels`); if (masked) { maskedPixels += 1; continue; } unmaskedPixels += 1; if (firstRed === undefined) { firstRed = image[index]; firstGreen = image[index + 1]; firstBlue = image[index + 2]; firstAlpha = image[index + 3]; } else if (image[index] !== firstRed || image[index + 1] !== firstGreen || image[index + 2] !== firstBlue || (channels === 4 && image[index + 3] !== firstAlpha)) variedPixels += 1; }
    if (maskedPixels > w * h * MAX_MASK_RATIO) fail(`${label} masks cover too much of the viewport`);
    if (variedPixels < Math.max(MIN_CONTENT_VARIATION_PIXELS, Math.ceil(unmaskedPixels * MIN_CONTENT_VARIATION_RATIO))) fail(`${label} has insufficient non-uniform content outside masks`);
}
function validateCell(cell) { exact(cell, ['artifact', 'auth', 'contract', 'environment', 'evidence', 'execution', 'id', 'masks', 'requirement', 'route', 'viewport'], 'frozen cell'); if (!cell.id || !['required', 'N/A'].includes(cell.requirement) || !['local', 'preview', 'production', 'alias'].includes(cell.environment) || !['playwright-public', 'playwright-synthetic', 'standalone-auth'].includes(cell.execution) || !['public', 'admin'].includes(cell.auth) || !['screenshot', 'metadata-only'].includes(cell.evidence) || !Array.isArray(cell.masks)) fail('frozen template has invalid cells'); if ((cell.execution === 'standalone-auth' && (cell.auth !== 'admin' || cell.evidence !== 'metadata-only' || cell.requirement !== 'required' || cell.environment === 'local')) || (cell.execution === 'playwright-public' && (cell.auth !== 'public' || cell.environment === 'local')) || (cell.execution === 'playwright-synthetic' && cell.environment !== 'local')) fail(`${cell.id} has an invalid execution class`); exact(cell.viewport, ['deviceScaleFactor', 'height', 'width'], `${cell.id} viewport`); for (const value of Object.values(cell.viewport)) if (!Number.isInteger(value) || value <= 0) fail(`${cell.id} viewport is invalid`); if (cell.requirement === 'N/A' ? cell.artifact !== 'N/A' : cell.evidence === 'screenshot' ? !cell.artifact.endsWith('.png') : cell.artifact !== 'metadata-only') fail(`${cell.id} has invalid artifact class`); if (cell.contract?.mode === 'reduced-motion-mobile') { exact(cell.contract, ['appShell', 'mapState', 'maxDurationMs', 'minimumTabStops', 'modalState', 'mode', 'navigation', 'navigationPath', 'safeAreaOwner', 'searchDialog', 'searchTrigger', 'sheetState', 'unchecked'], `${cell.id} contract`); if (cell.requirement !== 'required' || cell.evidence !== 'screenshot' || cell.route !== '/' || cell.viewport.width !== 390 || cell.viewport.height !== 844 || cell.contract.maxDurationMs !== 0 || !Number.isInteger(cell.contract.minimumTabStops) || cell.contract.minimumTabStops < 1 || cell.contract.navigationPath !== '/' || cell.contract.mapState !== 'visible' || cell.contract.modalState !== 'closed' || cell.contract.sheetState !== 'closed' || ![cell.contract.searchTrigger, cell.contract.searchDialog, cell.contract.appShell, cell.contract.navigation, cell.contract.safeAreaOwner].every((value) => typeof value === 'string' && value)) fail(`${cell.id} reduced-motion contract is invalid`); } else if (cell.contract?.mode === 'desktop-screenshot') { exact(cell.contract, ['mode', 'unchecked'], `${cell.id} contract`); if (cell.execution === 'standalone-auth' || cell.evidence !== 'screenshot' || !Array.isArray(cell.contract.unchecked) || cell.contract.unchecked.length !== 7 || new Set(cell.contract.unchecked).size !== 7 || !cell.contract.unchecked.every((value) => ['reducedMotion', 'keyboard', 'focus', 'dialog', 'sheet', 'map', 'shellGeometry'].includes(value))) fail(`${cell.id} desktop contract is invalid`); } else if (cell.contract?.mode === 'standalone-auth-metadata-only') { exact(cell.contract, ['mode'], `${cell.id} contract`); if (cell.execution !== 'standalone-auth') fail(`${cell.id} auth contract is invalid`); } else fail(`${cell.id} has an invalid contract`); }
function validateInteraction(value, cell, expectedOrigin) {
    const reduced = cell.contract.mode === 'reduced-motion-mobile';
    exact(value, ['dialog', 'geometry', 'navigation', 'selectors', 'tabTrace'], `${cell.id} interaction`);
    if (!reduced) { if (Object.values(value).some((item) => item !== 'unchecked')) fail(`${cell.id} desktop interaction must be unchecked`); return; }
    const contract = cell.contract;
    exact(value.selectors, ['appShell', 'navigation', 'safeAreaOwner', 'searchDialog', 'searchTrigger'], `${cell.id} interaction selectors`);
    const expectedSelectors = [contract.appShell, contract.navigation, contract.safeAreaOwner, contract.searchDialog, contract.searchTrigger];
    if (new Set(expectedSelectors).size !== expectedSelectors.length || Object.entries(value.selectors).some(([key, selector]) => selector !== contract[key] || typeof selector !== 'string')) fail(`${cell.id} interaction selector changed`);
    exact(value.navigation, ['after', 'before'], `${cell.id} interaction navigation`);
    let before; let after; try { before = new URL(value.navigation.before); after = new URL(value.navigation.after); } catch { fail(`${cell.id} interaction navigation changed`); }
    if (before.toString() !== after.toString() || before.origin !== expectedOrigin || before.pathname !== cell.route || before.username || before.password || before.search || before.hash) fail(`${cell.id} interaction navigation changed`);
    const focusIdentity = (item, label) => {
        exact(item, ['dialogIndex', 'documentIndex', 'focusVisible', 'inDialog', 'isTrigger'], label);
        if (!Number.isSafeInteger(item.documentIndex) || item.documentIndex < 0 || item.documentIndex >= 512 || !Number.isSafeInteger(item.dialogIndex) || item.dialogIndex < -1 || item.dialogIndex >= 64 || typeof item.focusVisible !== 'boolean' || typeof item.inDialog !== 'boolean' || typeof item.isTrigger !== 'boolean' || item.inDialog !== (item.dialogIndex >= 0)) fail(`${cell.id} focus identity is invalid`);
        return item;
    };
    exact(value.tabTrace, ['backward', 'forward', 'initial'], `${cell.id} interaction tab trace`);
    const initial = focusIdentity(value.tabTrace.initial, `${cell.id} initial focus`);
    if (!initial.isTrigger || initial.inDialog || initial.dialogIndex !== -1 || !Array.isArray(value.tabTrace.forward) || !Array.isArray(value.tabTrace.backward) || value.tabTrace.forward.length !== contract.minimumTabStops || value.tabTrace.backward.length !== contract.minimumTabStops) fail(`${cell.id} interaction tab trace is invalid`);
    const forward = value.tabTrace.forward.map((item) => focusIdentity(item, `${cell.id} forward focus`));
    const backward = value.tabTrace.backward.map((item) => focusIdentity(item, `${cell.id} backward focus`));
    if (forward.some((item) => !item.focusVisible) || backward.some((item) => !item.focusVisible) || new Set(forward.map((item) => item.documentIndex)).size !== forward.length) fail(`${cell.id} interaction tab trace is invalid`);
    const expectedBackward = [...forward.slice(0, -1).reverse(), initial];
    if (backward.some((item, index) => item.documentIndex !== expectedBackward[index].documentIndex) || backward.at(-1).documentIndex !== initial.documentIndex || !backward.at(-1).isTrigger) fail(`${cell.id} interaction tab trace is invalid`);
    exact(value.dialog, ['activeAfterEscape', 'activeDuringTrap', 'afterEscapeCount', 'afterOpenCount', 'beforeCount', 'restoredTo', 'tabBackwardAfter', 'tabForwardAfter', 'tabbableCount'], `${cell.id} interaction dialog`);
    const activeDuringTrap = focusIdentity(value.dialog.activeDuringTrap, `${cell.id} trap focus`);
    const activeAfterEscape = focusIdentity(value.dialog.activeAfterEscape, `${cell.id} escape focus`);
    const restoredTo = focusIdentity(value.dialog.restoredTo, `${cell.id} restored focus`);
    const tabForwardAfter = focusIdentity(value.dialog.tabForwardAfter, `${cell.id} forward trap`);
    const tabBackwardAfter = focusIdentity(value.dialog.tabBackwardAfter, `${cell.id} backward trap`);
    if (value.dialog.beforeCount !== 0 || value.dialog.afterOpenCount !== 1 || value.dialog.afterEscapeCount !== 0 || !Number.isSafeInteger(value.dialog.tabbableCount) || value.dialog.tabbableCount < 2 || value.dialog.tabbableCount > 64 || !tabForwardAfter.inDialog || tabForwardAfter.dialogIndex !== 0 || !tabForwardAfter.focusVisible || !tabBackwardAfter.inDialog || tabBackwardAfter.dialogIndex !== value.dialog.tabbableCount - 1 || !tabBackwardAfter.focusVisible || tabForwardAfter.documentIndex === tabBackwardAfter.documentIndex || activeDuringTrap.documentIndex !== tabBackwardAfter.documentIndex || !activeAfterEscape.isTrigger || activeAfterEscape.documentIndex !== initial.documentIndex || !restoredTo.isTrigger || restoredTo.documentIndex !== initial.documentIndex) fail(`${cell.id} interaction dialog is invalid`);
    exact(value.geometry, ['appShell', 'navigation', 'safeAreaOwner'], `${cell.id} interaction geometry`);
    for (const key of ['appShell', 'navigation', 'safeAreaOwner']) { exact(value.geometry[key], ['bottom', 'height', 'left', 'right', 'top', 'width'], `${cell.id} interaction ${key} geometry`); const box = value.geometry[key]; if (!Object.values(box).every(Number.isSafeInteger) || box.width <= 0 || box.height <= 0 || box.right - box.left !== box.width || box.bottom - box.top !== box.height || box.left < 0 || box.top < 0 || box.right > cell.viewport.width || box.bottom > cell.viewport.height) fail(`${cell.id} interaction ${key} geometry is invalid`); }
    const { appShell, navigation, safeAreaOwner } = value.geometry;
    if (appShell.left !== 0 || appShell.top !== 0 || appShell.right !== cell.viewport.width || appShell.bottom !== cell.viewport.height || navigation.left !== appShell.left || navigation.right !== appShell.right || navigation.bottom !== appShell.bottom || safeAreaOwner.left < appShell.left || safeAreaOwner.right > appShell.right || safeAreaOwner.top < appShell.top || safeAreaOwner.bottom > navigation.top) fail(`${cell.id} interaction geometry is invalid`);
}
function originBinding(value, cell, trusted) { exact(value, ['certificationId', 'deploymentId', 'deploymentReceiptSha256', 'environment', 'expectedGitSha', 'expectedOrigin', 'observedOrigin', 'observedPath', 'releaseId'], `${cell.id} origin binding`); if (value.releaseId !== trusted.releaseId || value.certificationId !== trusted.certificationId || value.expectedGitSha !== trusted.gitSha || value.environment !== cell.environment || value.expectedOrigin !== trusted.origins.get(cell.environment) || value.deploymentId !== trusted.deploymentIds.get(cell.environment) || value.deploymentReceiptSha256 !== trusted.deploymentReceipts.get(cell.environment) || value.observedOrigin !== value.expectedOrigin || value.observedPath !== cell.route) fail(`${cell.id} origin binding is invalid`); let origin; try { origin = new URL(value.expectedOrigin); } catch { fail(`${cell.id} origin binding is invalid`); } const loopback = origin.hostname === 'localhost' || origin.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(origin.hostname); if (value.expectedOrigin !== origin.origin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || (cell.environment === 'local' ? (!['http:', 'https:'].includes(origin.protocol) || !loopback || !origin.port) : origin.protocol !== 'https:')) fail(`${cell.id} origin binding is invalid`); }
export function validateReleaseVisualMetadata(value, cell, trusted) { exact(value, ['accessibility', 'consoleErrors', 'httpErrors', 'hydrationErrors', 'interaction', 'maskProof', 'originBinding', 'pageErrors', 'requestErrors', 'responsive', 'route', 'surfaces', 'unchecked', 'viewport'], `${cell.id} metadata`); originBinding(value.originBinding, cell, trusted); if (!Array.isArray(value.unchecked) || value.unchecked.length !== cell.contract.unchecked.length || value.unchecked.some((item, index) => item !== cell.contract.unchecked[index])) fail(`${cell.id} unchecked declaration changed`); if (value.route !== cell.route) fail(`${cell.id} route changed`); exact(value.viewport, ['deviceScaleFactor', 'height', 'width'], `${cell.id} viewport`); for (const key of ['width', 'height', 'deviceScaleFactor']) if (value.viewport[key] !== cell.viewport[key]) fail(`${cell.id} viewport changed`); exact(value.responsive, ['devicePixelRatio', 'hasHorizontalOverflow', 'maxAnimationDurationMs', 'maxTransitionDurationMs', 'reducedMotion', 'shellMatchesViewport'], `${cell.id} responsive`); exact(value.accessibility, ['documentLanguage', 'documentTitle', 'duplicateIds', 'escapeCloses', 'focusRestore', 'focusTrap', 'imagesWithoutAlt', 'keyboardNavigation', 'visibleFocus'], `${cell.id} accessibility`); exact(value.surfaces, ['map', 'modal', 'sheet'], `${cell.id} surfaces`); validateInteraction(value.interaction, cell, trusted.origins.get(cell.environment)); const reduced = cell.contract.mode === 'reduced-motion-mobile'; const unchecked = new Set(value.unchecked); const mustBeUnchecked = (name, value) => unchecked.has(name) ? name === 'reducedMotion' ? value === false : value === 'unchecked' : value !== 'unchecked'; if (!mustBeUnchecked('reducedMotion', value.responsive.reducedMotion) || !mustBeUnchecked('shellGeometry', value.responsive.shellMatchesViewport) || !mustBeUnchecked('keyboard', value.accessibility.keyboardNavigation) || !mustBeUnchecked('focus', value.accessibility.visibleFocus) || !mustBeUnchecked('focus', value.accessibility.focusTrap) || !mustBeUnchecked('focus', value.accessibility.focusRestore) || !mustBeUnchecked('dialog', value.accessibility.escapeCloses) || !mustBeUnchecked('map', value.surfaces.map) || !mustBeUnchecked('dialog', value.surfaces.modal) || !mustBeUnchecked('sheet', value.surfaces.sheet)) fail(`${cell.id} unchecked value is laundered as passed`); if (value.responsive.devicePixelRatio !== cell.viewport.deviceScaleFactor || value.responsive.hasHorizontalOverflow !== false || (!unchecked.has('reducedMotion') && value.responsive.reducedMotion !== reduced) || (!unchecked.has('shellGeometry') && value.responsive.shellMatchesViewport !== true) || !(reduced ? [value.responsive.maxAnimationDurationMs, value.responsive.maxTransitionDurationMs].every((item) => Number.isFinite(item) && item >= 0) : value.responsive.maxAnimationDurationMs === 'unchecked' && value.responsive.maxTransitionDurationMs === 'unchecked') || value.accessibility.documentLanguage !== true || value.accessibility.documentTitle !== true || value.accessibility.duplicateIds !== 0 || value.accessibility.imagesWithoutAlt !== 0 || (!unchecked.has('keyboard') && value.accessibility.keyboardNavigation !== true) || (!unchecked.has('focus') && (value.accessibility.visibleFocus !== true || value.accessibility.focusTrap !== true || value.accessibility.focusRestore !== true)) || (!unchecked.has('dialog') && value.accessibility.escapeCloses !== true)) fail(`${cell.id} invariants failed`); if (reduced && (value.responsive.maxAnimationDurationMs > cell.contract.maxDurationMs || value.responsive.maxTransitionDurationMs > cell.contract.maxDurationMs || value.surfaces.map !== cell.contract.mapState || value.surfaces.modal !== cell.contract.modalState || value.surfaces.sheet !== cell.contract.sheetState)) fail(`${cell.id} reduced-motion contract failed`); if (!reduced && (value.responsive.maxAnimationDurationMs !== 'unchecked' || value.responsive.maxTransitionDurationMs !== 'unchecked')) fail(`${cell.id} desktop contract failed`); for (const key of ['consoleErrors', 'httpErrors', 'hydrationErrors', 'pageErrors', 'requestErrors']) if (!Array.isArray(value[key]) || value[key].length) fail(`${cell.id} has runtime errors`); if (!Array.isArray(value.maskProof) || value.maskProof.length !== cell.masks.length) fail(`${cell.id} mask proof count changed`); const seen = new Set(); for (const proof of value.maskProof) { exact(proof, ['box', 'redacted', 'selector'], `${cell.id} mask proof`); exact(proof.box, ['height', 'width', 'x', 'y'], `${cell.id} mask box`); if (proof.redacted !== true || !cell.masks.includes(proof.selector) || seen.has(proof.selector) || Object.values(proof.box).some((number) => !Number.isInteger(number) || number < 0) || !proof.box.width || !proof.box.height || proof.box.x + proof.box.width > cell.viewport.width || proof.box.y + proof.box.height > cell.viewport.height) fail(`${cell.id} mask proof is invalid`); seen.add(proof.selector); } return value.maskProof.map((proof) => ({ box: { x: proof.box.x * cell.viewport.deviceScaleFactor, y: proof.box.y * cell.viewport.deviceScaleFactor, width: proof.box.width * cell.viewport.deviceScaleFactor, height: proof.box.height * cell.viewport.deviceScaleFactor } })); }
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const CAPTURE_RECEIPT_DOMAIN = 'tzudong:release-visual-capture-receipt:v1\n';
const metadataDigest = (metadata) => digest(Buffer.from(canonicalJson(metadata), 'utf8'));
const captureReceiptHash = (payload) => digest(Buffer.from(`${CAPTURE_RECEIPT_DOMAIN}${canonicalJson(payload)}`, 'utf8'));
const canonicalJson = (value) => { if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value); if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('receipt has non-integer number'); return String(value); } if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (!value || typeof value !== 'object') fail('receipt has invalid value'); return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; };
const receiptHash = (payload) => digest(Buffer.from(`tzudong:release-auth-receipt:v1\n${canonicalJson(payload)}`, 'utf8'));
const REVOCATION_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revocationBindingHash = (release, item, deployment, result) => digest(Buffer.from(`tzudong:release-auth-revocation-binding:v1\n${canonicalJson({
    releaseId: release.releaseId,
    certificationId: release.certificationId,
    gitSha: release.gitSha,
    cellId: item.id,
    origin: item.origin,
    challenge: release.challenge,
    issuedAt: release.issuedAt,
    expiresAt: release.expiresAt,
    deploymentReceiptSha256: deployment.receiptSha256,
    capturedAt: result.capturedAt,
    authProofSha256: result.authProofSha256,
    revocationOperationId: result.revocationOperationId,
    outcome: 'certified',
})}`, 'utf8'));
function validateCaptureReceipt(receipt, cell, record, trusted) { exact(receipt, ['artifactSha256', 'capturedAt', 'cellId', 'certificationId', 'challenge', 'deploymentId', 'deploymentReceiptSha256', 'environment', 'expiresAt', 'finalUrl', 'gitSha', 'issuedAt', 'metadataSha256', 'origin', 'releaseId', 'route', 'version'], `${cell.id} capture receipt`); if (receipt.version !== 1 || receipt.cellId !== cell.id || receipt.environment !== cell.environment || receipt.releaseId !== trusted.releaseId || receipt.certificationId !== trusted.certificationId || receipt.gitSha !== trusted.gitSha || receipt.deploymentId !== trusted.deploymentIds.get(cell.environment) || receipt.deploymentReceiptSha256 !== trusted.deploymentReceipts.get(cell.environment) || receipt.origin !== trusted.origins.get(cell.environment) || receipt.route !== cell.route || receipt.artifactSha256 !== record.sha256 || receipt.metadataSha256 !== metadataDigest(record.metadata) || !HASH.test(receipt.artifactSha256) || !HASH.test(receipt.metadataSha256) || !BASE64URL_32.test(receipt.challenge) || Buffer.from(receipt.challenge, 'base64url').length !== 32 || Buffer.from(receipt.challenge, 'base64url').toString('base64url') !== receipt.challenge || !Number.isSafeInteger(receipt.issuedAt) || !Number.isSafeInteger(receipt.capturedAt) || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt - receipt.issuedAt < 1 || receipt.expiresAt - receipt.issuedAt > 900 || receipt.capturedAt < receipt.issuedAt || receipt.capturedAt > receipt.expiresAt || trusted.now < receipt.issuedAt - 60 || trusted.now > receipt.expiresAt || receipt.capturedAt > trusted.now + 60) fail(`${cell.id} capture receipt binding or timing is invalid`); let finalUrl; try { finalUrl = new URL(receipt.finalUrl); } catch { fail(`${cell.id} capture final URL is invalid`); } const expectedUrl = new URL(cell.route, `${receipt.origin}/`); if (finalUrl.toString() !== expectedUrl.toString() || finalUrl.origin !== receipt.origin || finalUrl.username || finalUrl.password || finalUrl.search || finalUrl.hash || captureReceiptHash(receipt) !== record.captureReceiptSha256 || record.captureReceiptSha256 !== trusted.captureReceipts.get(cell.id)) fail(`${cell.id} capture receipt hash does not match trusted input`); return { challenge: receipt.challenge, hash: record.captureReceiptSha256, deploymentId: receipt.deploymentId, deploymentReceiptSha256: receipt.deploymentReceiptSha256, origin: receipt.origin, cellId: cell.id }; }
function receiptInteger(value, label) { if (!Number.isSafeInteger(value)) fail(`${label} is invalid`); return value; }
function receiptHost(value, label) { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)) fail(`${label} is invalid`); return value; }
function validateAuthMetadata(metadata, cell, trusted) {
    exact(metadata, ['payload', 'receiptSha256', 'receiptVersion'], `${cell.id} auth metadata`);
    if (metadata.receiptVersion !== 1 || !HASH.test(metadata.receiptSha256)) fail(`${cell.id} auth receipt is invalid`);
    exact(metadata.payload, ['cell', 'deployment', 'release', 'result'], `${cell.id} auth payload`);
    const { release, cell: item, deployment, result } = metadata.payload;
    exact(release, ['certificationId', 'challenge', 'expiresAt', 'gitSha', 'issuedAt', 'releaseId'], `${cell.id} auth release`);
    exact(item, ['environment', 'finalUrl', 'id', 'origin', 'route'], `${cell.id} auth cell`);
    exact(deployment, ['aliasHost', 'deploymentId', 'environment', 'host', 'observedAt', 'receiptSha256'], `${cell.id} auth deployment`);
    exact(result, ['authProofSha256', 'capturedAt', 'headingCount', 'navigationCount', 'ok', 'reasonCode', 'revocationBindingSha256', 'revocationOperationId', 'revocationReceipt', 'shellHeight', 'shellWidth', 'status'], `${cell.id} auth result`);
    if (release.releaseId !== trusted.releaseId || release.certificationId !== trusted.certificationId || release.gitSha !== trusted.gitSha || !BASE64URL_32.test(release.challenge) || Buffer.from(release.challenge, 'base64url').length !== 32 || Buffer.from(release.challenge, 'base64url').toString('base64url') !== release.challenge) fail(`${cell.id} auth release binding is invalid`);
    const issuedAt = receiptInteger(release.issuedAt, `${cell.id} issuedAt`);
    const expiresAt = receiptInteger(release.expiresAt, `${cell.id} expiresAt`);
    const observedAt = receiptInteger(deployment.observedAt, `${cell.id} observedAt`);
    const capturedAt = receiptInteger(result.capturedAt, `${cell.id} capturedAt`);
    if (expiresAt - issuedAt < 1 || expiresAt - issuedAt > 900 || observedAt < issuedAt || capturedAt < issuedAt || capturedAt < observedAt || capturedAt > expiresAt || trusted.now < issuedAt - 60 || trusted.now > expiresAt || capturedAt > trusted.now + 60) fail(`${cell.id} auth receipt timing is invalid`);
    if (item.id !== cell.id || item.environment !== cell.environment || item.route !== cell.route) fail(`${cell.id} auth cell binding is invalid`);
    const host = receiptHost(deployment.host, `${cell.id} host`);
    const aliasHost = receiptHost(deployment.aliasHost, `${cell.id} alias host`);
    if (!/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(host)) fail(`${cell.id} deployment host is invalid`);
    if (deployment.environment === 'production' && !new Set(['tzudong.app', 'www.tzudong.app']).has(aliasHost)) fail(`${cell.id} production alias is invalid`);
    const expectedHost = cell.environment === 'alias' ? aliasHost : host;
    const expectedOrigin = `https://${expectedHost}/`;
    const expectedUrl = `${new URL(expectedOrigin).origin}/admin`;
    let finalUrl;
    try { finalUrl = new URL(item.finalUrl); } catch { fail(`${cell.id} final URL is invalid`); }
    if (item.origin !== expectedOrigin || item.origin !== `${trusted.origins.get(cell.environment)}/` || deployment.deploymentId !== trusted.deploymentIds.get(cell.environment) || deployment.receiptSha256 !== trusted.deploymentReceipts.get(cell.environment) || finalUrl.protocol !== 'https:' || finalUrl.pathname !== '/admin' || finalUrl.search || finalUrl.hash || finalUrl.username || finalUrl.password || finalUrl.toString() !== expectedUrl || !HASH.test(deployment.receiptSha256) || !/^dpl_[A-Za-z0-9]+$/.test(deployment.deploymentId)) fail(`${cell.id} auth deployment binding is invalid`);
    if (cell.environment === 'preview' ? deployment.environment !== 'preview' || host !== aliasHost : !['production', 'alias'].includes(cell.environment) || deployment.environment !== 'production' || host === aliasHost) fail(`${cell.id} deployment mapping is invalid`);
    if (result.ok !== true || result.reasonCode !== 'OK' || !HASH.test(result.authProofSha256) || !REVOCATION_OPERATION_ID.test(result.revocationOperationId) || !HASH.test(result.revocationBindingSha256) || result.revocationBindingSha256 !== revocationBindingHash(release, item, deployment, result) || !HASH.test(result.revocationReceipt)) fail(`${cell.id} auth outcome is invalid`);
    for (const key of ['shellHeight', 'shellWidth', 'headingCount', 'navigationCount']) if (!Number.isInteger(result[key]) || result[key] <= 0 || result[key] > 100000) fail(`${cell.id} auth result is invalid`);
    if (!Number.isInteger(result.status) || result.status < 200 || result.status >= 300 || receiptHash(metadata.payload) !== metadata.receiptSha256 || metadata.receiptSha256 !== trusted.receipts.get(cell.id)) fail(`${cell.id} auth receipt hash does not match trusted input`);
    return { hash: metadata.receiptSha256, challenge: release.challenge, operationId: result.revocationOperationId, release, deployment };
}
function validateAuthSet(auth) { if (auth.length !== 3 || new Set(auth.map((item) => item.challenge)).size !== 3 || new Set(auth.map((item) => item.hash)).size !== 3 || new Set(auth.map((item) => item.operationId)).size !== 3) fail('auth receipts must have distinct challenges, operations, and hashes'); const release = auth[0].release; if (auth.some((item) => item.release.releaseId !== release.releaseId || item.release.certificationId !== release.certificationId || item.release.gitSha !== release.gitSha || item.release.issuedAt !== release.issuedAt || item.release.expiresAt !== release.expiresAt)) fail('auth receipts do not share release binding and window'); const production = auth.find((item) => item.cellId === 'production-admin-auth-smoke-metadata'); const alias = auth.find((item) => item.cellId === 'alias-admin-auth-smoke-metadata'); if (!production || !alias || ['receiptSha256', 'deploymentId', 'host', 'aliasHost'].some((key) => production.deployment[key] !== alias.deployment[key])) fail('production and alias deployments do not match'); }
function parseAuthCli(argv, issuer) {
    const values = new Map();
    const bindings = { origins: new Map(), deploymentIds: new Map(), deploymentReceipts: new Map() };
    const required = ['--cells', '--output', '--release-id', '--certification-id', '--expected-git-sha', '--receipt-channel'];
    const bindingFlags = new Map([['--expected-origin', bindings.origins], ['--deployment-id', bindings.deploymentIds], ['--deployment-receipt-sha256', bindings.deploymentReceipts]]);
    for (let i = 2; i < argv.length; i += 2) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (!flag || value === undefined) fail('usage has missing option value');
        if (bindingFlags.has(flag)) {
            const match = /^(local|preview|production|alias)=(.+)$/.exec(value);
            const target = bindingFlags.get(flag);
            if (!match || target.has(match[1])) fail('deployment trust input is invalid or duplicate');
            target.set(match[1], match[2]);
        } else {
            if (!required.includes(flag) || values.has(flag)) fail('usage has unknown or duplicate option');
            values.set(flag, value);
        }
    }
    if (values.size !== required.length || required.some((key) => !values.has(key)) || [...bindingFlags.values()].some((map) => map.size !== 4)) fail('usage requires strict release, origin, deployment, receipt channel, and issuer replay store options');
    const releaseId = values.get('--release-id');
    const certificationId = values.get('--certification-id');
    const gitSha = values.get('--expected-git-sha');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(releaseId) || !HASH.test(certificationId) || !/^[a-f0-9]{40}$/.test(gitSha) || [...bindings.deploymentIds.values()].some((value) => !/^[A-Za-z0-9._-]{1,128}$/.test(value)) || [...bindings.deploymentReceipts.values()].some((value) => !HASH.test(value))) fail('trusted release binding is invalid');
    const channelPath = values.get('--receipt-channel');
    if (!path.isAbsolute(channelPath)) fail('receipt channel must be absolute');
    const channelDirectory = safeDirectory(path.dirname(channelPath), 'receipt channel directory', true);
    const channel = json(safeFile(channelPath, channelDirectory, 'receipt channel', MAX_JSON_BYTES), 'receipt channel');
    exact(channel, ['authReceipts', 'captureChallenges', 'captureReceipts', 'certificationId', 'channelId', 'claim', 'expiresAt', 'gitSha', 'issuedAt', 'issuerBinding', 'issuerKeyId', 'issuerSignature', 'releaseId', 'runNonce', 'schemaVersion'], 'receipt channel');
    const unsigned = { schemaVersion: channel.schemaVersion, claim: channel.claim, issuerKeyId: channel.issuerKeyId, releaseId: channel.releaseId, certificationId: channel.certificationId, gitSha: channel.gitSha, channelId: channel.channelId, runNonce: channel.runNonce, issuedAt: channel.issuedAt, expiresAt: channel.expiresAt, authReceipts: channel.authReceipts, captureReceipts: channel.captureReceipts, captureChallenges: channel.captureChallenges, issuerBinding: channel.issuerBinding };
    const now = Math.floor(Date.now() / 1000);
    if (channel.schemaVersion !== 4 || channel.claim !== 'G009-release-visual-channel-v1' || channel.issuerKeyId !== issuer.keyId || typeof channel.issuerSignature !== 'string' || !/^[A-Za-z0-9_-]{64,256}$/.test(channel.issuerSignature) || !verify(null, Buffer.from(`${G009_CHANNEL_DOMAIN}${canonicalJson(unsigned)}`, 'utf8'), issuer.publicKey, Buffer.from(channel.issuerSignature, 'base64url')) || channel.releaseId !== releaseId || channel.certificationId !== certificationId || channel.gitSha !== gitSha || typeof channel.channelId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(channel.channelId) || !BASE64URL_32.test(channel.runNonce) || Buffer.from(channel.runNonce, 'base64url').length !== 32 || Buffer.from(channel.runNonce, 'base64url').toString('base64url') !== channel.runNonce || !Number.isSafeInteger(channel.issuedAt) || !Number.isSafeInteger(channel.expiresAt) || channel.expiresAt - channel.issuedAt < 1 || channel.expiresAt - channel.issuedAt > 900 || now < channel.issuedAt - 60 || now > channel.expiresAt) fail('receipt channel authentication is invalid');
    exact(channel.authReceipts, Object.keys(channel.authReceipts), 'receipt channel auth receipts');
    exact(channel.captureReceipts, Object.keys(channel.captureReceipts), 'receipt channel capture receipts');
    exact(channel.captureChallenges, Object.keys(channel.captureReceipts), 'receipt channel capture challenges');
    validateIssuerBinding(channel.issuerBinding, gitSha);
    const receipts = new Map(Object.entries(channel.authReceipts));
    const captureReceipts = new Map(Object.entries(channel.captureReceipts));
    const captureChallenges = new Map(Object.entries(channel.captureChallenges));
    if ([...receipts.values(), ...captureReceipts.values()].some((value) => typeof value !== 'string' || !HASH.test(value)) || [...captureChallenges.values()].some((value) => typeof value !== 'string' || !BASE64URL_32.test(value))) fail('receipt channel digest is invalid');
    const nonceDirectory = issuerReplayDirectory();
    const nonceIdentity = lstatSync(nonceDirectory);
    writePinnedFile(path.join(nonceDirectory, `${channel.channelId}.${channel.runNonce}.assemble`), Buffer.from(`${channel.channelId}\n`, 'utf8'), nonceDirectory, nonceIdentity, 'receipt nonce');
    return { values, releaseId, certificationId, gitSha, receipts, captureReceipts, captureChallenges, channel, ...bindings, now };
}
export function assembleReleaseVisualEvidence(argv, issuer) {
    exact(issuer, ['keyId', 'publicKey'], 'issuer trust root');
    if (typeof issuer.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(issuer.keyId) || typeof issuer.publicKey !== 'string' || !issuer.publicKey.includes('BEGIN PUBLIC KEY')) fail('issuer trust root is invalid');
    const cli = parseAuthCli(argv, issuer);
    const cellsDirectory = safeDirectory(cli.values.get('--cells'), 'cells directory', true); const outputPath = path.resolve(cli.values.get('--output')); if (!path.isAbsolute(cli.values.get('--output')) || inside(outputPath, projectRoot) || lstatSync(path.dirname(outputPath)).isSymbolicLink()) fail('output path must be external with a non-symlink parent'); const outputDirectory = safeDirectory(path.dirname(outputPath), 'output directory', true); const outputIdentity = lstatSync(outputDirectory); if (path.dirname(outputPath) !== outputDirectory || pathExistsSafely(outputPath, 'output')) fail('output must be create-only'); const artifactsDirectory = path.join(outputDirectory, 'artifacts'); if (pathExistsSafely(artifactsDirectory, 'artifacts output')) fail('artifacts output must be create-only');
    const templateDirectory = safeDirectory(path.dirname(templatePath), 'template directory'); const templateBytes = safeFile(templatePath, templateDirectory, 'frozen template', MAX_JSON_BYTES); const template = json(templateBytes, 'frozen template'); exact(template, ['cells', 'schemaVersion'], 'frozen template'); if (template.schemaVersion !== 5 || digest(templateBytes) !== G009_TEMPLATE_SHA256 || !Array.isArray(template.cells)) fail('frozen template is invalid'); const ids = new Set(); const artifactNames = new Set(); const authIds = new Set(); const screenshotIds = new Set(); for (const cell of template.cells) { validateCell(cell); if (ids.has(cell.id)) fail('frozen template has duplicate cells'); ids.add(cell.id); if (cell.evidence === 'screenshot') { artifactNames.add(cell.artifact); if (cell.requirement === 'required') screenshotIds.add(cell.id); } if (cell.execution === 'standalone-auth') authIds.add(cell.id); } if (cli.receipts.size !== authIds.size || [...cli.receipts.keys()].some((id) => !authIds.has(id)) || new Set(cli.receipts.values()).size !== cli.receipts.size || cli.captureReceipts.size !== screenshotIds.size || [...cli.captureReceipts.keys()].some((id) => !screenshotIds.has(id)) || new Set(cli.captureReceipts.values()).size !== cli.captureReceipts.size) fail('expected receipts do not exactly match frozen cells');
    const entries = boundedEntries(cellsDirectory, ids.size, 'cells directory'); if (entries.length !== ids.size || entries.some((entry) => !entry.isDirectory() || !ids.has(entry.name))) fail('isolated cell directories do not exactly match template'); const files = {}; const artifactBytes = {}; const cells = []; const auth = []; const captures = [];
    for (const cell of template.cells) { const cellDirectory = safeDirectory(path.join(cellsDirectory, cell.id), `${cell.id} directory`, true); if (path.dirname(cellDirectory) !== cellsDirectory) fail(`${cell.id} directory escapes cells root`); const expectedFiles = cell.evidence === 'screenshot' && cell.requirement === 'required' ? ['metadata.json', 'capture-receipt.json', cell.artifact] : ['metadata.json']; const output = boundedEntries(cellDirectory, expectedFiles.length, `${cell.id} output`); if (output.length !== expectedFiles.length || output.some((entry) => !entry.isFile() || !expectedFiles.includes(entry.name))) fail(`${cell.id} contains unallowlisted output`); const recordBytes = safeFile(path.join(cellDirectory, 'metadata.json'), cellDirectory, `${cell.id} metadata`, MAX_JSON_BYTES); if (SENSITIVE.test(new TextDecoder('utf-8', { fatal: true }).decode(recordBytes))) fail(`${cell.id} metadata contains sensitive text`); const record = json(recordBytes, `${cell.id} metadata`); exact(record, ['artifact', 'captureReceiptSha256', 'evidence', 'execution', 'id', 'metadata', 'schemaVersion', 'sha256', 'status'], `${cell.id} record`); if (record.status === 'access_blocked') fail(`${cell.id} is access_blocked`); if (record.schemaVersion !== 5 || record.id !== cell.id || record.status !== cell.requirement || record.evidence !== cell.evidence || record.execution !== cell.execution) fail(`${cell.id} descriptor changed`); const masks = cell.execution === 'standalone-auth' ? null : validateReleaseVisualMetadata(record.metadata, cell, cli); if (cell.execution === 'standalone-auth') auth.push({ ...validateAuthMetadata(record.metadata, cell, cli), cellId: cell.id }); if (cell.requirement === 'N/A') { if (record.artifact !== 'N/A' || record.sha256 !== 'N/A' || record.captureReceiptSha256 !== 'N/A') fail(`${cell.id} N/A descriptor changed`); cells.push({ id: cell.id, status: record.status, execution: cell.execution, evidence: cell.evidence, artifact: record.artifact, sha256: record.sha256, captureReceiptSha256: record.captureReceiptSha256, metadata: record.metadata }); continue; } if (cell.evidence === 'metadata-only') { if (record.artifact !== 'metadata-only' || record.sha256 !== 'metadata-only' || record.captureReceiptSha256 !== 'metadata-only') fail(`${cell.id} metadata-only receipt contains PNG descriptor`); cells.push({ id: cell.id, status: 'required', execution: cell.execution, evidence: cell.evidence, artifact: record.artifact, sha256: record.sha256, captureReceiptSha256: record.captureReceiptSha256, metadata: record.metadata }); continue; } const captureBytes = safeFile(path.join(cellDirectory, 'capture-receipt.json'), cellDirectory, `${cell.id} capture receipt`, MAX_JSON_BYTES); if (SENSITIVE.test(new TextDecoder('utf-8', { fatal: true }).decode(captureBytes))) fail(`${cell.id} capture receipt contains sensitive text`); const captureReceipt = json(captureBytes, `${cell.id} capture receipt`); captures.push({ ...validateCaptureReceipt(captureReceipt, cell, record, cli), receipt: captureReceipt }); if (record.artifact !== cell.artifact || !HASH.test(record.sha256) || !HASH.test(record.captureReceiptSha256) || Object.hasOwn(files, record.artifact)) fail(`${cell.id} screenshot descriptor changed`); const bytes = safeFile(path.join(cellDirectory, cell.artifact), cellDirectory, `${cell.id} artifact`, MAX_PNG_BYTES); if (!bytes.length || digest(bytes) !== record.sha256) fail(`${cell.id} screenshot hash changed`); pixels(bytes, cell.viewport.width * cell.viewport.deviceScaleFactor, cell.viewport.height * cell.viewport.deviceScaleFactor, masks, cell.id); files[record.artifact] = record.sha256; artifactBytes[record.artifact] = bytes; cells.push({ id: cell.id, status: 'required', execution: cell.execution, evidence: cell.evidence, artifact: record.artifact, sha256: record.sha256, captureReceiptSha256: record.captureReceiptSha256, metadata: record.metadata }); }
    validateAuthSet(auth); if (captures.length !== artifactNames.size || new Set(captures.map((item) => item.challenge)).size !== captures.length || new Set(captures.map((item) => item.hash)).size !== captures.length || captures.some((item) => cli.captureChallenges.get(item.cellId) !== item.challenge)) fail('capture receipts must have distinct issuer challenges and hashes'); const preview = captures.find((item) => item.cellId === 'preview-reduced-motion'), production = captures.find((item) => item.cellId === 'production-reduced-motion'), alias = captures.find((item) => item.cellId === 'alias-reduced-motion'); if (!preview || !production || !alias || preview.origin === production.origin || production.origin === alias.origin || production.deploymentId !== alias.deploymentId || production.deploymentReceiptSha256 !== alias.deploymentReceiptSha256) fail('capture receipt topology is invalid'); if (Object.keys(files).length !== artifactNames.size || Object.keys(files).some((name) => !artifactNames.has(name))) fail('screenshot allowlist changed'); const currentOutputIdentity = lstatSync(outputDirectory); if (currentOutputIdentity.isSymbolicLink() || currentOutputIdentity.dev !== outputIdentity.dev || currentOutputIdentity.ino !== outputIdentity.ino) fail('output parent identity changed'); mkdirSync(artifactsDirectory, { recursive: false }); const artifactsIdentity = lstatSync(artifactsDirectory); if (artifactsIdentity.isSymbolicLink() || !artifactsIdentity.isDirectory()) fail('artifact directory identity is unsafe'); for (const [name, bytes] of Object.entries(artifactBytes)) writePinnedFile(path.join(artifactsDirectory, name), bytes, artifactsDirectory, artifactsIdentity, 'artifact'); const finalOutputIdentity = lstatSync(outputDirectory); if (finalOutputIdentity.dev !== outputIdentity.dev || finalOutputIdentity.ino !== outputIdentity.ino || lstatSync(artifactsDirectory).dev !== artifactsIdentity.dev || lstatSync(artifactsDirectory).ino !== artifactsIdentity.ino) fail('output parent identity changed'); writePinnedFile(outputPath, Buffer.from(`${canonicalJson({ schemaVersion: 5, templateSha256: digest(templateBytes), files, captureReceipts: Object.fromEntries(captures.map(({ cellId, receipt }) => [cellId, receipt])), cells })}\n`, 'utf8'), outputDirectory, outputIdentity, 'ledger');
}
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.on('uncaughtException', () => { process.stderr.write('RELEASE_VISUAL_ASSEMBLY_FAILED\n'); process.exit(1); });
if (isMain) {
    assembleReleaseVisualEvidence(process.argv, { keyId: G009_ISSUER_KEY_ID, publicKey: G009_ISSUER_PUBLIC_KEY });
    process.stdout.write('release visual evidence assembled\n');
}
