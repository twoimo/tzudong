import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repository = 'twoimo/tzudong';
const protectedBranches = new Set(['develop', 'data', 'main']);

export function verifyPromotionPath(event, repositoryName) {
  const pr = event?.pull_request;
  if (repositoryName !== repository || pr?.base?.repo?.full_name !== repository) {
    return { passed: false, code: 'PROMOTION_REPOSITORY_MISMATCH' };
  }
  const base = pr.base.ref;
  const head = pr.head?.ref;
  if (typeof head !== 'string' || !head || !/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '')) {
    return { passed: false, code: 'PROMOTION_SOURCE_INVALID' };
  }
  if (!protectedBranches.has(base)) {
    return { passed: true, code: 'PROMOTION_NON_RELEASE_BASE' };
  }
  if (base === 'develop') {
    return protectedBranches.has(head)
      ? { passed: false, code: 'PROMOTION_REVERSE_PATH_DENIED' }
      : { passed: true, code: 'PROMOTION_FEATURE_TO_DEVELOP' };
  }
  if (pr.head?.repo?.full_name !== repository) {
    return { passed: false, code: 'PROMOTION_FOREIGN_SOURCE_DENIED' };
  }
  const expected = base === 'data' ? 'develop' : 'data';
  return head === expected
    ? { passed: true, code: 'PROMOTION_SERIAL_PATH_VERIFIED' }
    : { passed: false, code: 'PROMOTION_SERIAL_PATH_REQUIRED' };
}

function main() {
  let result;
  try {
    result = ['pull_request', 'pull_request_target'].includes(process.env.GITHUB_EVENT_NAME)
      ? verifyPromotionPath(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), process.env.GITHUB_REPOSITORY)
      : { passed: false, code: 'PROMOTION_EVENT_INVALID' };
  } catch {
    result = { passed: false, code: 'PROMOTION_EVENT_INVALID' };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
