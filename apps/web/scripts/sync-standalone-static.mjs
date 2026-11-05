import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const configuredNextDistDir = process.env.TZUDONG_NEXT_DIST_DIR?.trim();
if (configuredNextDistDir && !/^\.next-[a-z0-9](?:[a-z0-9-]{0,47})$/.test(configuredNextDistDir)) {
  throw new Error('InvalidDistDir');
}
const nextDirectoryName = configuredNextDistDir || '.next';
const standaloneAppDir = path.join(projectRoot, nextDirectoryName, 'standalone', 'apps', 'web');
const staticSource = path.join(projectRoot, nextDirectoryName, 'static');
const staticTarget = path.join(standaloneAppDir, nextDirectoryName, 'static');
const publicSource = path.join(projectRoot, 'public');
const publicTarget = path.join(standaloneAppDir, 'public');

function copyDirectory({ label, source, target, required = true }) {
  if (!fs.existsSync(source)) {
    if (!required) return false;
    throw new Error(`${label} source directory is missing: ${source}`);
  }

  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
  return true;
}

function main() {
  if (!fs.existsSync(standaloneAppDir)) {
    throw new Error(`Standalone app directory is missing. Run \`bun run build\` first: ${standaloneAppDir}`);
  }

  const copiedStatic = copyDirectory({
    label: 'Next static assets',
    source: staticSource,
    target: staticTarget,
  });
  const copiedPublic = copyDirectory({
    label: 'public assets',
    source: publicSource,
    target: publicTarget,
    required: false,
  });

  console.log(JSON.stringify({
    standaloneAppDir,
    copiedStatic,
    copiedPublic,
    staticTarget,
    publicTarget,
  }, null, 2));
}

main();
