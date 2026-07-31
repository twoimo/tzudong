const MAX_SAFE_EXTERNAL_URL_LENGTH = 2_048;
const MAX_GITHUB_ACTIONS_RUN_URL_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const GITHUB_ACTIONS_RUN_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/actions\/runs\/[1-9][0-9]{0,19}$/;

export function resolveSafeExternalUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_SAFE_EXTERNAL_URL_LENGTH ||
    rawUrl.trim() !== rawUrl ||
    CONTROL_CHARACTER_PATTERN.test(rawUrl) ||
    !rawUrl.startsWith('https://')
  ) {
    return null;
  }

  try {
    const resolved = new URL(rawUrl);
    if (
      resolved.protocol !== 'https:' ||
      resolved.username ||
      resolved.password ||
      resolved.port ||
      resolved.hash
    ) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

export function resolveGitHubActionsRunUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length > MAX_GITHUB_ACTIONS_RUN_URL_LENGTH ||
    !GITHUB_ACTIONS_RUN_URL_PATTERN.test(rawUrl)
  ) {
    return null;
  }

  const safeUrl = resolveSafeExternalUrl(rawUrl);
  if (!safeUrl) {
    return null;
  }

  const resolved = new URL(safeUrl);
  return resolved.hostname === 'github.com' && resolved.search === ''
    ? safeUrl
    : null;
}

export function openExternalUrl(rawUrl: string | null | undefined): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const safeUrl = resolveSafeExternalUrl(rawUrl);
  if (!safeUrl) {
    return false;
  }

  const popup = window.open(safeUrl, '_blank', 'noopener,noreferrer');
  if (popup) {
    popup.opener = null;
  }

  return Boolean(popup);
}
