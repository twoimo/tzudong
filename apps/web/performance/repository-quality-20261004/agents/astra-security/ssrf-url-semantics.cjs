// Offline URL destination probe only. No requests, app startup, auth or source writes.
const assert = require('node:assert/strict');
const upstream = 'http://127.0.0.1:18792';
const origin = 'http://127.0.0.1:18794';
const inputs = ['/', '/safe?x=1', '//attacker.invalid/a', 'https://attacker.invalid/a', 'http://user@attacker.invalid/a', '/\\attacker.invalid/a', '///attacker.invalid/a', '/%2f%2fattacker.invalid/a', '/%5c%5cattacker.invalid/a', '/@attacker.invalid/a', '/a/../b', '/\t@attacker.invalid/a', 'http://127.0.0.1:80/x', '/?url=https://attacker.invalid/a'];
const results = inputs.map((input,index) => {
  const parsed = new URL(input, origin);
  const destination = new URL(`${upstream}${parsed.pathname}${parsed.search}`);
  assert.equal(destination.origin,upstream);
  return {case:index+1,origin:destination.origin};
});
process.stdout.write(JSON.stringify({node:process.version,network_requests:0,case_count:results.length,all_origins_fixed:true})+'\n');
