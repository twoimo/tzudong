// Native Node 24 TypeScript import: the web sanitizer is the sole privacy policy.
// stdin and diagnostics are never echoed, including import/JSON/assert failures.
const LIMIT = 65536;
let size = 0;
const chunks = [];
try {
  if (process.versions.node.split('.')[0] !== '24') throw new Error();
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMIT) throw new Error();
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const { assertPrivacySafe } = await import('../../apps/web/lib/privacy/sanitize.ts');
  assertPrivacySafe(value, { locationClass: 'business', maxDepth: 16, maxEntries: 1000 });
  process.stdout.write('PRIVACY_SAFE\n');
} catch {
  process.stdout.write('PRIVACY_REJECTED\n');
  process.exitCode = 1;
}
