import { test, type Page } from '@playwright/test';

const { createHash } = process.getBuiltinModule('crypto');
const { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeSync } = process.getBuiltinModule('fs');
const path = process.getBuiltinModule('path');

type Evidence = 'screenshot' | 'metadata-only';
type Unchecked = 'reducedMotion' | 'keyboard' | 'focus' | 'dialog' | 'sheet' | 'map' | 'shellGeometry';
type MobileContract = {
    mode: 'reduced-motion-mobile';
    maxDurationMs: 0;
    minimumTabStops: number;
    navigationPath: '/';
    mapState: 'visible';
    modalState: 'closed';
    sheetState: 'closed';
    searchTrigger: string;
    searchDialog: string;
    appShell: string;
    navigation: string;
    safeAreaOwner: string;
    unchecked: [];
};
type DesktopContract = { mode: 'desktop-screenshot'; unchecked: Unchecked[] };
type Contract = DesktopContract | MobileContract | { mode: 'standalone-auth-metadata-only' };
type Cell = {
    id: string;
    environment: 'local' | 'preview' | 'production' | 'alias';
    execution: 'playwright-public' | 'playwright-synthetic' | 'standalone-auth';
    route: string;
    auth: 'public' | 'admin';
    requirement: 'required' | 'N/A';
    evidence: Evidence;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    masks: string[];
    artifact: string;
    contract: Contract;
};
type Template = { schemaVersion: 5; cells: Cell[] };
type DeploymentBinding = { expectedOrigin: string; deploymentId: string; deploymentReceiptSha256: string; environment: Cell['environment']; releaseId: string; certificationId: string; expectedGitSha: string };

const testDirectory = path.resolve(process.cwd(), 'tests');
const template = JSON.parse(readFileSync(path.join(testDirectory, 'release-visual-cells.template.json'), 'utf8')) as Template;
const cellId = process.env.RELEASE_VISUAL_CELL_ID?.trim();
const outputRoot = process.env.RELEASE_VISUAL_OUTPUT_DIR?.trim();

const canonicalJson = (value: unknown): string => value === null || typeof value === 'boolean' || typeof value === 'string' ? JSON.stringify(value) : typeof value === 'number' ? String(value) : Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
const receiptHash = (payload: unknown) => createHash('sha256').update(`tzudong:release-visual-capture-receipt:v1\n${canonicalJson(payload)}`).digest('hex');
function emitTrustedCaptureDigest(cellId: string, digest: string) {
    const output = process.env.RELEASE_VISUAL_RECEIPT_CHANNEL_FD;
    const acknowledgement = process.env.RELEASE_VISUAL_RECEIPT_ACK_FD;
    const channelId = process.env.RELEASE_VISUAL_RECEIPT_CHANNEL_ID?.trim();
    const runNonce = process.env.RELEASE_VISUAL_RUN_NONCE?.trim();
    if (!output || acknowledgement !== '0' || !/^\d+$/.test(output) || Number(output) < 3 || !channelId || !/^[A-Za-z0-9_-]{16,64}$/.test(channelId) || !runNonce || !/^[A-Za-z0-9_-]{43}$/.test(runNonce) || Buffer.from(runNonce, 'base64url').length !== 32) throw new Error('RELEASE_VISUAL_CHANNEL_UNAVAILABLE');
    const frame = Buffer.from(`${canonicalJson({ version: 1, channelId, runNonce, cellId, captureReceiptSha256: digest })}\n`, 'utf8');
    if (frame.length > 512 || writeSync(Number(output), frame) !== frame.length) throw new Error('RELEASE_VISUAL_CHANNEL_UNAVAILABLE');
    const ack = Buffer.alloc(128);
    const count = readSync(Number(acknowledgement), ack, 0, ack.length, null);
    if (ack.subarray(0, count).toString('utf8') !== `ACK ${channelId} ${cellId}\n`) throw new Error('RELEASE_VISUAL_CHANNEL_UNAVAILABLE');
    const commit = Buffer.from(`${canonicalJson({ version: 2, status: 'ACKED', channelId, runNonce, cellId, captureReceiptSha256: digest })}\n`, 'utf8');
    if (commit.length > 512 || writeSync(Number(output), commit) !== commit.length) throw new Error('RELEASE_VISUAL_CHANNEL_UNAVAILABLE');
}
function captureInputs() { const challenge = process.env.RELEASE_VISUAL_CAPTURE_CHALLENGE?.trim(); const issuedAt = Number(process.env.RELEASE_VISUAL_CAPTURE_ISSUED_AT); const expiresAt = Number(process.env.RELEASE_VISUAL_CAPTURE_EXPIRES_AT); if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || Buffer.from(challenge, 'base64url').length !== 32 || Buffer.from(challenge, 'base64url').toString('base64url') !== challenge || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt - issuedAt < 1 || expiresAt - issuedAt > 900) throw new Error('RELEASE_VISUAL_CAPTURE_CHALLENGE and bounded capture window are required'); return { challenge, issuedAt, expiresAt }; }
function comparisonPath(value: string): string {
    return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
}

function isInside(child: string, root: string): boolean {
    const relative = path.relative(comparisonPath(root), comparisonPath(child));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function rejectReparseTraversal(value: string, label: string) {
    const resolved = path.resolve(value);
    const parsed = path.parse(resolved);
    let current = parsed.root;
    for (const component of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        let stat;
        try { stat = lstatSync(current); } catch { throw new Error(`${label} must already exist without symlink, junction, or reparse traversal`); }
        if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse a symlink, junction, or reparse point`);
    }
}

function requireExternalOutput(value: string | undefined): string {
    if (!value || !path.isAbsolute(value)) throw new Error('RELEASE_VISUAL_OUTPUT_DIR must be an absolute external directory');
    rejectReparseTraversal(value, 'RELEASE_VISUAL_OUTPUT_DIR');
    const output = realpathSync(path.resolve(value));
    const outputStat = lstatSync(output);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error('RELEASE_VISUAL_OUTPUT_DIR must be a non-reparse directory');
    const projectRoot = realpathSync(path.resolve(testDirectory, '..'));
    if (isInside(output, projectRoot)) throw new Error('RELEASE_VISUAL_OUTPUT_DIR must be outside the project canonical filesystem identity');
    return output;
}

function requireCell(id: string | undefined): Cell {
    if (!id) throw new Error('RELEASE_VISUAL_CELL_ID is required');
    const matches = template.cells.filter((item) => item.id === id);
    if (matches.length !== 1) throw new Error('RELEASE_VISUAL_CELL_ID must identify exactly one frozen cell');
    return matches[0];
}

function projectFor(cell: Cell): string {
    if (cell.execution === 'standalone-auth') throw new Error(`Playwright Test cannot run ${cell.id}: standalone authenticated metadata receipts must use the direct browser API`);
    if (cell.requirement === 'N/A') throw new Error(`Playwright Test cannot run ${cell.id}: frozen N/A cells have no evidence artifact`);
    if (cell.execution === 'playwright-public' && cell.auth === 'public' && cell.evidence === 'screenshot') return 'release-public-remote-chromium';
    if (cell.execution === 'playwright-synthetic' && cell.evidence === 'screenshot') return 'release-localhost-synthetic-chromium';
    throw new Error(`Playwright Test cannot run ${cell.id}: execution and evidence class are invalid`);
}

function requireDeploymentBinding(cell: Cell): DeploymentBinding {
    const expectedOrigin = process.env.RELEASE_VISUAL_EXPECTED_ORIGIN?.trim();
    const deploymentId = process.env.RELEASE_VISUAL_DEPLOYMENT_ID?.trim();
    const deploymentReceiptSha256 = process.env.RELEASE_VISUAL_DEPLOYMENT_RECEIPT_SHA256?.trim();
    const environment = process.env.RELEASE_VISUAL_DEPLOYMENT_ENVIRONMENT?.trim();
    const releaseId = process.env.RELEASE_VISUAL_RELEASE_ID?.trim();
    const certificationId = process.env.RELEASE_VISUAL_CERTIFICATION_ID?.trim();
    const expectedGitSha = process.env.RELEASE_VISUAL_EXPECTED_GIT_SHA?.trim();
    if (!expectedOrigin || !deploymentId || !deploymentReceiptSha256 || !environment || !releaseId || !certificationId || !expectedGitSha) throw new Error('RELEASE_VISUAL_EXPECTED_ORIGIN, RELEASE_VISUAL_DEPLOYMENT_ID, RELEASE_VISUAL_DEPLOYMENT_RECEIPT_SHA256, RELEASE_VISUAL_DEPLOYMENT_ENVIRONMENT, RELEASE_VISUAL_RELEASE_ID, RELEASE_VISUAL_CERTIFICATION_ID, and RELEASE_VISUAL_EXPECTED_GIT_SHA are required');
    let parsed: URL;
    try { parsed = new URL(expectedOrigin); } catch { throw new Error('RELEASE_VISUAL_EXPECTED_ORIGIN must be an exact origin'); }
    if (expectedOrigin !== parsed.origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('RELEASE_VISUAL_EXPECTED_ORIGIN must contain only the exact origin');
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname);
    if (cell.environment === 'local' ? (!['http:', 'https:'].includes(parsed.protocol) || !loopback || !parsed.port) : parsed.protocol !== 'https:') throw new Error(`${cell.id} expected origin uses an invalid protocol`);
    if (environment !== cell.environment || !/^[A-Za-z0-9._-]{1,128}$/.test(deploymentId) || !/^[a-f0-9]{64}$/.test(deploymentReceiptSha256) || !/^[A-Za-z0-9._-]{1,64}$/.test(releaseId) || !/^[a-f0-9]{64}$/.test(certificationId) || !/^[a-f0-9]{40}$/.test(expectedGitSha)) throw new Error(`${cell.id} release or deployment identity input is invalid or mislabeled`);
    return { expectedOrigin, deploymentId, deploymentReceiptSha256, environment: cell.environment, releaseId, certificationId, expectedGitSha };
}

function clip(box: { x: number; y: number; width: number; height: number }, viewport: Cell['viewport']) {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const right = Math.min(viewport.width, Math.ceil(box.x + box.width));
    const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height));
    if (right <= x || bottom <= y) throw new Error('masked locator must occupy the viewport');
    return { x, y, width: right - x, height: bottom - y };
}
function normalizedRect(box: { x: number; y: number; width: number; height: number }, viewport: Cell['viewport']) {
    return clip(box, viewport);
}
function writeExclusiveEvidence(root: string, name: string, bytes: Buffer) {
    const rootIdentity = lstatSync(root);
    if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) throw new Error('release visual output directory is unsafe');
    const target = path.join(root, name);
    const flags = process.platform === 'win32' ? 'wx' : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(target, flags, 0o600);
    try {
        const written = process.getBuiltinModule('fs').writeSync(fd, bytes);
        const identity = fstatSync(fd);
        const parent = lstatSync(root);
        if (written !== bytes.length || !identity.isFile() || identity.nlink !== 1 || parent.dev !== rootIdentity.dev || parent.ino !== rootIdentity.ino) throw new Error('release visual output identity changed');
    } finally { closeSync(fd); }
}
async function collectMotion(page: Page) {
    return page.evaluate(() => {
        const duration = (value: string) => {
            let maximum = 0;
            for (const part of value.split(',')) {
                const match = /^\s*([0-9.]+)(ms|s)\s*$/.exec(part);
                if (match) maximum = Math.max(maximum, Number(match[1]) * (match[2] === 's' ? 1000 : 1));
            }
            return maximum;
        };
        const elements = document.querySelectorAll<HTMLElement>('*');
        if (elements.length > 2048) return { overflow: true, maxAnimationDurationMs: 0, maxTransitionDurationMs: 0 };
        let maxAnimationDurationMs = 0;
        let maxTransitionDurationMs = 0;
        for (const element of elements) {
            for (const pseudo of ['', '::before', '::after']) {
                const style = getComputedStyle(element, pseudo || null);
                maxAnimationDurationMs = Math.max(maxAnimationDurationMs, duration(style.animationDuration));
                maxTransitionDurationMs = Math.max(maxTransitionDurationMs, duration(style.transitionDuration));
            }
        }
        return { overflow: false, maxAnimationDurationMs, maxTransitionDurationMs };
    });
}


async function verifyReducedMotionCell(cell: Cell, page: Page) {
    if (cell.contract.mode !== 'reduced-motion-mobile') return null;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const contract = cell.contract;
    const trigger = page.locator(contract.searchTrigger);
    const dialog = page.locator(contract.searchDialog);
    const activeIdentity = async () => {
        const identity = await page.evaluate(({ triggerSelector, dialogSelector }) => {
            const selector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
            const focusable = [...document.querySelectorAll<HTMLElement>(selector)];
            if (focusable.length > 512) return { overflow: true, documentIndex: -1, dialogIndex: -1, inDialog: false, isTrigger: false, focusVisible: false };
            const active = document.activeElement as HTMLElement | null;
            const dialogElement = document.querySelector<HTMLElement>(dialogSelector);
            const dialogFocusable = dialogElement ? [...dialogElement.querySelectorAll<HTMLElement>(selector)] : [];
            return {
                overflow: false,
                documentIndex: active ? focusable.indexOf(active) : -1,
                dialogIndex: active ? dialogFocusable.indexOf(active) : -1,
                inDialog: Boolean(active && dialogElement?.contains(active)),
                isTrigger: Boolean(active && active === document.querySelector(triggerSelector)),
                focusVisible: Boolean(active?.matches(':focus-visible')),
            };
        }, { triggerSelector: contract.searchTrigger, dialogSelector: contract.searchDialog });
        if (identity.overflow || identity.documentIndex < 0) throw new Error('RELEASE_VISUAL_FOCUS_OBSERVATION_INVALID');
        const { documentIndex, dialogIndex, inDialog, isTrigger, focusVisible } = identity;
        return { documentIndex, dialogIndex, inDialog, isTrigger, focusVisible };
    };
    if (!(await page.getByTestId('map-container').isVisible()) || !(await trigger.isVisible()) || await dialog.count() !== 0) throw new Error('RELEASE_VISUAL_SURFACE_INVALID');
    const beforeUrl = page.url();
    await trigger.focus();
    const initial = await activeIdentity();
    if (!initial.isTrigger) throw new Error('RELEASE_VISUAL_FOCUS_OBSERVATION_INVALID');
    const forward = [];
    for (let index = 0; index < contract.minimumTabStops; index += 1) {
        await page.keyboard.press('Tab');
        forward.push(await activeIdentity());
    }
    if (new Set(forward.map((item) => item.documentIndex)).size !== forward.length) throw new Error('RELEASE_VISUAL_KEYBOARD_NAVIGATION_INVALID');
    const backward = [];
    for (let index = 0; index < contract.minimumTabStops; index += 1) {
        await page.keyboard.press('Shift+Tab');
        backward.push(await activeIdentity());
    }
    const expectedBackward = [...forward.slice(0, -1).reverse(), initial];
    if (backward.some((item, index) => item.documentIndex !== expectedBackward[index]?.documentIndex)) throw new Error('RELEASE_VISUAL_KEYBOARD_NAVIGATION_INVALID');
    await trigger.focus();
    const beforeCount = await dialog.count();
    await page.keyboard.press('Enter');
    if (await dialog.count() !== 1) throw new Error('RELEASE_VISUAL_DIALOG_INVALID');
    const afterOpenCount = await dialog.count();
    const tabbables = dialog.locator('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
    const tabbableCount = await tabbables.count();
    if (tabbableCount < 2 || tabbableCount > 64) throw new Error('RELEASE_VISUAL_DIALOG_INVALID');
    await tabbables.nth(tabbableCount - 1).focus();
    await page.keyboard.press('Tab');
    const tabForwardAfter = await activeIdentity();
    await tabbables.nth(0).focus();
    await page.keyboard.press('Shift+Tab');
    const tabBackwardAfter = await activeIdentity();
    const activeDuringTrap = await activeIdentity();
    const focusTrap = tabForwardAfter.inDialog && tabForwardAfter.dialogIndex === 0 && tabBackwardAfter.inDialog && tabBackwardAfter.dialogIndex === tabbableCount - 1 && tabForwardAfter.documentIndex !== tabBackwardAfter.documentIndex;
    if (!focusTrap) throw new Error('RELEASE_VISUAL_DIALOG_INVALID');
    await page.keyboard.press('Escape');
    if (await dialog.count() !== 0) throw new Error('RELEASE_VISUAL_DIALOG_INVALID');
    const afterEscapeCount = await dialog.count();
    const activeAfterEscape = await activeIdentity();
    const focusRestore = activeAfterEscape.isTrigger && activeAfterEscape.documentIndex === initial.documentIndex;
    if (!focusRestore) throw new Error('RELEASE_VISUAL_FOCUS_OBSERVATION_INVALID');
    const motion = await collectMotion(page);
    if (motion.overflow || motion.maxAnimationDurationMs !== 0 || motion.maxTransitionDurationMs !== 0) throw new Error('RELEASE_VISUAL_MOTION_INVALID');
    const state = await page.evaluate(({ appShell, navigation, safeAreaOwner }) => {
        const rect = (selector: string) => { const element = document.querySelector<HTMLElement>(selector); if (!element) return null; const box = element.getBoundingClientRect(); const left = Math.floor(box.left); const top = Math.floor(box.top); const right = Math.ceil(box.right); const bottom = Math.ceil(box.bottom); return { left, top, right, bottom, width: right - left, height: bottom - top }; };
        return { map: Boolean(document.querySelector('[data-testid="map-container"]')), modal: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')), sheet: Boolean(document.querySelector('[data-bottom-sheet-layout-source]')), shell: rect(appShell), nav: rect(navigation), safeArea: rect(safeAreaOwner), viewport: { width: window.innerWidth, height: window.innerHeight } };
    }, contract);
    if (!state.map || state.modal || state.sheet || !state.shell || !state.nav || !state.safeArea) throw new Error('RELEASE_VISUAL_SURFACE_INVALID');
    const shellGeometry = state.shell.left === 0 && state.shell.top === 0 && state.shell.right === state.viewport.width && state.shell.bottom === state.viewport.height && state.nav.left === state.shell.left && state.nav.right === state.shell.right && state.nav.bottom === state.shell.bottom && state.safeArea.left >= state.shell.left && state.safeArea.right <= state.shell.right && state.safeArea.top >= state.shell.top && state.safeArea.bottom <= state.nav.top;
    if (!shellGeometry) throw new Error('RELEASE_VISUAL_GEOMETRY_INVALID');
    const visibleFocus = [...forward, tabForwardAfter, tabBackwardAfter].every((item) => item.focusVisible);
    if (!visibleFocus) throw new Error('RELEASE_VISUAL_FOCUS_OBSERVATION_INVALID');
    const keyboardNavigation = beforeUrl === page.url() && backward.at(-1)?.documentIndex === initial.documentIndex;
    if (!keyboardNavigation) throw new Error('RELEASE_VISUAL_KEYBOARD_NAVIGATION_INVALID');
    return { maxAnimationDurationMs: motion.maxAnimationDurationMs, maxTransitionDurationMs: motion.maxTransitionDurationMs, keyboardNavigation, visibleFocus, focusTrap, focusRestore, escapeCloses: afterEscapeCount === 0, shellGeometry, surfaces: { map: 'visible', modal: 'closed', sheet: 'closed' }, interaction: { selectors: { searchTrigger: contract.searchTrigger, searchDialog: contract.searchDialog, appShell: contract.appShell, navigation: contract.navigation, safeAreaOwner: contract.safeAreaOwner }, tabTrace: { initial, forward, backward }, navigation: { before: beforeUrl, after: page.url() }, dialog: { beforeCount, afterOpenCount, tabbableCount, activeDuringTrap, tabForwardAfter, tabBackwardAfter, afterEscapeCount, activeAfterEscape, restoredTo: initial }, geometry: { appShell: state.shell, navigation: state.nav, safeAreaOwner: state.safeArea } } };
}


const outputDirectory = requireExternalOutput(outputRoot);
const cell = requireCell(cellId);
const expectedProject = projectFor(cell);
const deployment = requireDeploymentBinding(cell);

test(`release visual cell ${cell.id}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== expectedProject, 'release visual project mismatch');
    if (testInfo.attachments.length) throw new Error('RELEASE_VISUAL_ATTACHMENT_FORBIDDEN');
    const cellDirectory = path.join(outputDirectory, cell.id);
    if (existsSync(cellDirectory)) throw new Error('RELEASE_VISUAL_OUTPUT_EXISTS');
    mkdirSync(cellDirectory, { recursive: false });

    const runtimeFailures = { console: 0, page: 0, request: 0, http: 0, hydration: 0, navigation: 0 };
    let navigationLocked = false;
    page.on('console', (message) => {
        if (message.type() === 'error') {
            runtimeFailures.console += 1;
            if (/hydration|server rendered|did not match/i.test(message.text().slice(0, 256))) runtimeFailures.hydration += 1;
        }
    });
    page.on('pageerror', (error) => {
        runtimeFailures.page += 1;
        if (/hydration|server rendered|did not match/i.test(String(error?.message ?? '').slice(0, 256))) runtimeFailures.hydration += 1;
    });
    page.on('requestfailed', () => { runtimeFailures.request += 1; });
    page.on('response', (response) => { if (response.status() >= 400) runtimeFailures.http += 1; });
    page.on('framenavigated', (frame) => { if (navigationLocked && frame === page.mainFrame()) runtimeFailures.navigation += 1; });

    await page.setViewportSize({ width: cell.viewport.width, height: cell.viewport.height });
    if (cell.contract.mode === 'reduced-motion-mobile') await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(cell.route, { waitUntil: 'networkidle' });
    const observed = new URL(page.url());
    const expectedUrl = new URL(cell.route, `${deployment.expectedOrigin}/`);
    if (observed.toString() !== expectedUrl.toString() || observed.origin !== deployment.expectedOrigin || observed.pathname !== expectedUrl.pathname || observed.search || observed.hash || observed.username || observed.password) throw new Error('RELEASE_VISUAL_ORIGIN_MISMATCH');
    navigationLocked = true;
    const mobile = await verifyReducedMotionCell(cell, page);
    const invariants = await page.evaluate(() => ({
        devicePixelRatio: window.devicePixelRatio,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        documentLanguage: document.documentElement.lang.trim().length > 0,
        documentTitle: document.title.trim().length > 0,
        duplicateIds: document.querySelectorAll('[id]').length - new Set([...document.querySelectorAll('[id]')].map((element) => element.id)).size,
        imagesWithoutAlt: [...document.images].filter((image) => !image.hasAttribute('alt')).length,
    }));
    if (invariants.devicePixelRatio !== cell.viewport.deviceScaleFactor || invariants.hasHorizontalOverflow || !invariants.documentLanguage || !invariants.documentTitle || invariants.duplicateIds !== 0 || invariants.imagesWithoutAlt !== 0) throw new Error('RELEASE_VISUAL_DOCUMENT_INVARIANT_INVALID');

    const masks = cell.masks.map((selector) => page.locator(selector));
    const maskProof: Array<{ selector: string; redacted: true; box: { x: number; y: number; width: number; height: number } }> = [];
    for (let index = 0; index < cell.masks.length; index += 1) {
        const locator = masks[index];
        if (await locator.count() !== 1 || !(await locator.isVisible())) throw new Error('RELEASE_VISUAL_MASK_INVALID');
        const box = await locator.boundingBox();
        if (!box) throw new Error('RELEASE_VISUAL_MASK_INVALID');
        maskProof.push({ selector: cell.masks[index], redacted: true, box: clip(box, cell.viewport) });
    }

    const preScreenshotUrl = new URL(page.url());
    if (preScreenshotUrl.toString() !== expectedUrl.toString()) throw new Error('RELEASE_VISUAL_ORIGIN_MISMATCH');
    const screenshot = await page.screenshot({ fullPage: false, mask: masks, maskColor: '#FF00FF', animations: 'disabled', caret: 'hide' });
    const sha256 = createHash('sha256').update(screenshot).digest('hex');
    await page.waitForTimeout(100);
    const postScreenshotUrl = new URL(page.url());
    if (postScreenshotUrl.toString() !== expectedUrl.toString() || postScreenshotUrl.toString() !== preScreenshotUrl.toString()) throw new Error('RELEASE_VISUAL_ORIGIN_MISMATCH');
    runtimeFailures.hydration += await page.locator('[data-nextjs-dialog-overlay], nextjs-portal').count();
    if (Object.values(runtimeFailures).some(Boolean)) throw new Error('RELEASE_VISUAL_RUNTIME_INVALID');
    if (testInfo.attachments.length) throw new Error('RELEASE_VISUAL_ATTACHMENT_FORBIDDEN');
    const unchecked = cell.contract.mode === 'desktop-screenshot' ? cell.contract.unchecked : [];
    const metadata = {
        route: cell.route, viewport: cell.viewport, maskProof,
        originBinding: { ...deployment, observedOrigin: postScreenshotUrl.origin, observedPath: postScreenshotUrl.pathname },
        responsive: { devicePixelRatio: invariants.devicePixelRatio, hasHorizontalOverflow: invariants.hasHorizontalOverflow, reducedMotion: cell.contract.mode === 'reduced-motion-mobile', shellMatchesViewport: mobile?.shellGeometry ?? 'unchecked', maxAnimationDurationMs: mobile?.maxAnimationDurationMs ?? 'unchecked', maxTransitionDurationMs: mobile?.maxTransitionDurationMs ?? 'unchecked' },
        accessibility: { documentLanguage: invariants.documentLanguage, documentTitle: invariants.documentTitle, duplicateIds: invariants.duplicateIds, imagesWithoutAlt: invariants.imagesWithoutAlt, keyboardNavigation: mobile?.keyboardNavigation ?? 'unchecked', visibleFocus: mobile?.visibleFocus ?? 'unchecked', focusTrap: mobile?.focusTrap ?? 'unchecked', focusRestore: mobile?.focusRestore ?? 'unchecked', escapeCloses: mobile?.escapeCloses ?? 'unchecked' },
        surfaces: mobile?.surfaces ?? { map: 'unchecked', modal: 'unchecked', sheet: 'unchecked' },
        interaction: mobile?.interaction ?? { selectors: 'unchecked', tabTrace: 'unchecked', navigation: 'unchecked', dialog: 'unchecked', geometry: 'unchecked' },
        unchecked, consoleErrors: [], pageErrors: [], requestErrors: [], httpErrors: [], hydrationErrors: [],
    };
    const capture = captureInputs();
    const capturedAt = Math.floor(Date.now() / 1000);
    if (capturedAt < capture.issuedAt || capturedAt > capture.expiresAt) throw new Error('RELEASE_VISUAL_WINDOW_INVALID');
    const receipt = { version: 1, cellId: cell.id, environment: cell.environment, releaseId: deployment.releaseId, certificationId: deployment.certificationId, gitSha: deployment.expectedGitSha, deploymentId: deployment.deploymentId, deploymentReceiptSha256: deployment.deploymentReceiptSha256, origin: postScreenshotUrl.origin, route: cell.route, finalUrl: postScreenshotUrl.toString(), artifactSha256: sha256, metadataSha256: createHash('sha256').update(canonicalJson(metadata)).digest('hex'), challenge: capture.challenge, issuedAt: capture.issuedAt, capturedAt, expiresAt: capture.expiresAt };
    const captureReceiptSha256 = receiptHash(receipt);
    writeExclusiveEvidence(cellDirectory, cell.artifact, screenshot);
    writeExclusiveEvidence(cellDirectory, 'capture-receipt.json', Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'));
    writeExclusiveEvidence(cellDirectory, 'metadata.json', Buffer.from(`${JSON.stringify({ schemaVersion: 5, id: cell.id, status: 'required', evidence: cell.evidence, execution: cell.execution, artifact: cell.artifact, sha256, captureReceiptSha256, metadata })}\n`, 'utf8'));
    emitTrustedCaptureDigest(cell.id, captureReceiptSha256);
});
