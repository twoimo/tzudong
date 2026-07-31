import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dir, '..');
const read = (file: string) => readFileSync(path.join(webRoot, file), 'utf8');

test('schema-v5 release visual evidence keeps detached capture receipts independently verified', () => {
    const assembler = read('scripts/assemble-release-visual-evidence.mjs');
    const verifier = read('scripts/verify-release-visual-evidence.mjs');
    const runner = read('tests/release-visual.spec.ts');
    for (const source of [assembler, verifier]) {
        expect(source).toContain("CAPTURE_RECEIPT_DOMAIN = 'tzudong:release-visual-capture-receipt:v1\\n'");
        expect(source).toContain('validateCaptureReceipt');
        expect(source).toContain('capture receipts must have distinct issuer challenges and hashes');
        expect(source).toContain('capture receipt topology is invalid');
        expect(source).toContain('metadataSha256');
    }
    expect(verifier).toContain("'--receipt-channel'");
    expect(verifier).toContain("exact(ledger, ['captureReceipts', 'cells', 'files', 'schemaVersion', 'templateSha256']");
    expect(runner).toContain("tabTrace: { initial, forward, backward }");
    expect(runner).toContain('afterEscapeCount');
    expect(runner).toContain('safeAreaOwner: state.safeArea');
});
