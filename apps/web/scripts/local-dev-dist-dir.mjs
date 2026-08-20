import path from 'node:path';

export function localDevDistDirName(port) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
    throw new Error('LOCAL_DEV_DIST_DIR_INVALID_PORT');
  }
  return `.next-local-${normalizedPort}`;
}

export function resolveLocalDevDistDir(projectRoot, port) {
  return path.join(projectRoot, localDevDistDirName(port));
}
