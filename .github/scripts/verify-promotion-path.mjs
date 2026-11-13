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
  if (typeof head !== 'string' || !head || !/^(?!0{40}$)[0-9a-f]{40}$/.test(pr.head?.sha ?? '')
      || typeof pr.head?.repo?.full_name !== 'string' || !pr.head.repo.full_name) {
    return { passed: false, code: 'PROMOTION_SOURCE_INVALID' };
  }
  if (!protectedBranches.has(base)) {
    return { passed: true, code: 'PROMOTION_NON_RELEASE_BASE' };
  }
  if (base !== 'main') {
    return { passed: false, code: 'PROMOTION_LEGACY_BASE_RETIRED' };
  }
  // This trusted policy reaches main through the previous policy's final
  // develop -> data -> main promotion. Once installed, legacy data consumers
  // may keep their ref, but that ref is no longer a source-release conduit.
  if (protectedBranches.has(head)) {
    return { passed: false, code: 'PROMOTION_RELEASE_BRANCH_SOURCE_DENIED' };
  }
  return { passed: true, code: 'PROMOTION_FEATURE_TO_MAIN' };
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
