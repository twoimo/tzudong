import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const raster = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
export function admitReferences(rows) {
  if (!Array.isArray(rows) || rows.length > 64) throw Error('REFERENCE_BOUND');
  for (const r of rows) {
    if (!uuid.test(r.id) || !uuid.test(r.user_id) || typeof r.verification_photo !== 'string') throw Error('REFERENCE_SHAPE');
    const key = r.verification_photo;
    const owner = r.user_id.toLowerCase();
    const canonical = key.startsWith(`${owner}/reviews/${r.id.toLowerCase()}/verification/`)
      && /^[0-9a-f-]{36}\/reviews\/[0-9a-f-]{36}\/verification\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.(?:avif|jpe?g|png|webp)$/i.test(key);
    const legacy = key.startsWith(owner + '/') && /^[0-9a-f-]{36}\/[0-9]{10,16}_verification_[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(?:avif|jpe?g|png|webp)$/.test(key);
    if (!canonical && !legacy) throw Error('REFERENCE_OWNER_PURPOSE');
    if ((r.food_photos ?? []).some(p => p === key || (typeof p === 'string' && p.includes('/review-photos/' + key)))) throw Error('REFERENCE_SHARED_FOOD');
  }
  const sorted = [...rows].sort((a,b) => a.id.localeCompare(b.id));
  return { hash: digest(JSON.stringify(sorted.map(r => [r.id,r.user_id,r.verification_photo]))), keys: [...new Set(sorted.map(r => r.verification_photo))].sort() };
}
function admittedInfo(info) {
  if (!info || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > 5 * 1024 * 1024 || !raster.has(info.contentType)) throw Error('IMAGE_METADATA');
}
async function byteHash(deps, bucket, key, info) {
  admittedInfo(info);
  const bytes = await deps.read(bucket,key);
  if (!(bytes instanceof Uint8Array) || bytes.length !== info.size) throw Error('IMAGE_READBACK');
  return digest(bytes);
}
const aggregate = pairs => digest(JSON.stringify([...pairs].sort((a,b) => a[0].localeCompare(b[0]))));
export async function planVerificationTransfer(deps) {
  const references = admitReferences(await deps.references());
  const pairs = []; let totalBytes = 0;
  for (const key of references.keys) {
    const info = await deps.info('review-photos',key);
    admittedInfo(info); totalBytes += info.size;
    pairs.push([digest(key),await byteHash(deps,'review-photos',key,info)]);
  }
  return { schemaVersion:1, referencesHash:references.hash, expectedFiles:references.keys.length,
    sourceBytesHash:aggregate(pairs), totalBytes, imageContentsPersisted:false, keysPersisted:false, operatingWrites:false };
}
export async function applyVerificationTransfer(deps, plan) {
  const references = admitReferences(await deps.references());
  if (references.hash !== plan.referencesHash || references.keys.length !== plan.expectedFiles) throw Error('REFERENCE_CHANGED');
  const bucket = await deps.privateBucket();
  if (!bucket || bucket.public !== false || bucket.file_size_limit !== 5*1024*1024) throw Error('PRIVATE_BUCKET_UNCONFIRMED');
  const pairs = []; let copied = 0;
  for (const key of references.keys) {
    const original = await deps.info('review-photos',key);
    let target = await deps.info('review-verifications',key);
    if (!target) {
      if (!original) throw Error('SOURCE_UNAVAILABLE');
      try { await deps.copy(key); } catch { /* outcome is reconciled below */ }
      target = await deps.info('review-verifications',key);
      if (!target) throw Error('COPY_UNCONFIRMED');
      copied++;
    }
    const privateHash = await byteHash(deps,'review-verifications',key,target);
    if (original && await byteHash(deps,'review-photos',key,original) !== privateHash) throw Error('BYTE_MISMATCH');
    pairs.push([digest(key),privateHash]);
  }
  if (aggregate(pairs) !== plan.sourceBytesHash) throw Error('BYTE_AGGREGATE_MISMATCH');
  if (admitReferences(await deps.references()).hash !== plan.referencesHash) throw Error('REFERENCE_CHANGED_AFTER_COPY');
  // Delete only after every private copy's exact bytes and the authoritative
  // reference set have been independently read back. No overwrite or blind retry.
  const remaining = [];
  for (const key of references.keys) if (await deps.info('review-photos',key)) remaining.push(key);
  if (remaining.length) { try { await deps.remove(remaining); } catch { /* bounded metadata reconciliation */ } }
  let publicRemaining = 0, publicReadable = 0, privatePublicReadable = 0, inconclusivePublicChecks = 0;
  const publicStatuses = {}, privatePublicStatuses = {};
  for (const key of references.keys) {
    if (await deps.info('review-photos',key)) publicRemaining++;
    const status = await deps.publicStatus('review-photos',key), privateStatus = await deps.publicStatus('review-verifications',key);
    publicStatuses[status] = (publicStatuses[status] ?? 0)+1;
    privatePublicStatuses[privateStatus] = (privatePublicStatuses[privateStatus] ?? 0)+1;
    if (status >= 200 && status < 300) publicReadable++;
    if (privateStatus >= 200 && privateStatus < 300) privatePublicReadable++;
    if (![401,403,404].includes(status) || ![401,403,404].includes(privateStatus)) inconclusivePublicChecks++;
  }
  return { files:references.keys.length, copiedThisAttempt:copied, byteEqualityVerified:references.keys.length,
    referenceSetUnchanged:true, publicMetadataRemaining:publicRemaining, publicReadable, privatePublicReadable,
    publicStatuses, privatePublicStatuses, inconclusivePublicChecks, sourceBytesHash:plan.sourceBytesHash,
    completed:publicRemaining===0 && publicReadable===0 && privatePublicReadable===0 && inconclusivePublicChecks===0,
    imageContentsPersisted:false, keysPersisted:false };
}
