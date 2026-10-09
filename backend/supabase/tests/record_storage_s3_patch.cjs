'use strict';

// Experimental provider patch for the owned fixture only. This is not a
// Supabase release, a hosted change, or admissible evidence for production.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PREIMAGE = 'bd03a1fa8083fc81504373af72cc2fdf858626417a63d0f9894bd080c2da40d1';
const START = '  async deleteObjects(bucket, prefixes) {';
const END = '\n  /**';
const ORIGINAL = '      await this.client.send(command);';
const REPLACEMENT = `      const response = await this.client.send(command);
      if (response.Errors !== undefined &&
          (!Array.isArray(response.Errors) || response.Errors.length > 0)) {
        throw new Error("S3_DELETE_PARTIAL_FAILURE");
      }`;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function patchBundle(bytes) {
  if (digest(bytes) !== PREIMAGE) throw new Error('FIXTURE_PATCH_PREIMAGE_MISMATCH');
  const source = bytes.toString('utf8');
  const start = source.indexOf(START);
  const end = source.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error('FIXTURE_PATCH_METHOD_MISSING');
  const method = source.slice(start, end);
  if (method.split(ORIGINAL).length !== 2) throw new Error('FIXTURE_PATCH_ANCHOR_MISMATCH');
  return Buffer.from(source.slice(0, start) + method.replace(ORIGINAL, REPLACEMENT) + source.slice(end));
}

function install() {
  if (process.env.TZUDONG_STORAGE_FIXTURE_PATCH !== '1' || process.cwd() !== '/app') {
    throw new Error('OWNED_FIXTURE_PATCH_REQUIRED');
  }
  const target = '/app/dist/storage/backend/s3/adapter.js';
  const original = fs.readFileSync(target);
  const changed = patchBundle(original);
  const temporary = path.join(path.dirname(target), '.record-storage-patch-' + process.pid);
  fs.writeFileSync(temporary, changed, { flag: 'wx', mode: fs.statSync(target).mode });
  fs.renameSync(temporary, target);
  process.stdout.write(JSON.stringify({
    schema: 'record-storage-fixture-provider-patch-v1',
    preimageSha256: digest(original), patchedBundleSha256: digest(changed),
    patchSha256: digest(fs.readFileSync(__filename)), officialRelease: false,
  }) + '\n');
}

module.exports = { patchBundle, digest, PREIMAGE };
if (process.env.TZUDONG_STORAGE_FIXTURE_PATCH === '1') install();
