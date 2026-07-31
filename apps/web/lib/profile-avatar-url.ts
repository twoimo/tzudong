const PROFILE_AVATAR_BUCKET = "profile-avatars";
const PROFILE_AVATAR_PUBLIC_PATH = `/storage/v1/object/public/${PROFILE_AVATAR_BUCKET}/`;
const GOOGLE_OAUTH_AVATAR_ORIGIN = "https://lh3.googleusercontent.com";
const GOOGLE_OAUTH_AVATAR_PATH_PREFIX = "/a/";
const MAX_AVATAR_URL_LENGTH = 4_096;
const MAX_USER_ID_LENGTH = 128;
const MAX_GOOGLE_AVATAR_KEY_LENGTH = 1_024;
export type ProfileAvatarKind = "owned_storage" | "google_oauth" | "invalid";

export type ProfileAvatarClassification =
  | { kind: "owned_storage"; storageKey: string }
  | { kind: "google_oauth" }
  | { kind: "invalid" };


export function resolveConfiguredSupabaseOrigin(
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!configuredUrl || configuredUrl !== configuredUrl.trim()) return null;

  try {
    const url = new URL(configuredUrl);
    const origin = url.origin;
    const isCanonicalOrigin = configuredUrl === origin || configuredUrl === `${origin}/`;

    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".supabase.co") ||
      url.hostname === "supabase.co" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !isCanonicalOrigin
    ) {
      return null;
    }

    return origin;
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }

  return false;
}

function isCanonicalAuthenticatedUserId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_USER_ID_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 0x30 && code <= 0x39;
    const isUppercaseLetter = code >= 0x41 && code <= 0x5a;
    const isLowercaseLetter = code >= 0x61 && code <= 0x7a;
    if (!isDigit && !isUppercaseLetter && !isLowercaseLetter && value[index] !== "-") {
      return false;
    }
  }

  return true;
}

function getCanonicalAvatarStorageKey(authenticatedUserId: unknown): string | null {
  return isCanonicalAuthenticatedUserId(authenticatedUserId)
    ? `${authenticatedUserId}/avatar.jpg`
    : null;
}

function isSafeAvatarUrlValue(value: unknown): value is string {
  return typeof value === "string"
    && Boolean(value)
    && value.length <= MAX_AVATAR_URL_LENGTH
    && value === value.trim()
    && !value.includes("\\")
    && !value.includes("%")
    && !hasControlCharacter(value);
}

function resolveStorageAvatarUrl(
  value: string,
  authenticatedUserId: unknown,
): string | null {
  const configuredOrigin = resolveConfiguredSupabaseOrigin();
  const storageKey = getCanonicalAvatarStorageKey(authenticatedUserId);
  if (!configuredOrigin || !storageKey) return null;

  const expectedUrl = `${configuredOrigin}${PROFILE_AVATAR_PUBLIC_PATH}${storageKey}`;
  if (value !== expectedUrl) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== configuredOrigin ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== `${PROFILE_AVATAR_PUBLIC_PATH}${storageKey}` ||
      url.toString() !== expectedUrl
    ) {
      return null;
    }

    return expectedUrl;
  } catch {
    return null;
  }
}

function isCanonicalGoogleAvatarKey(value: string): boolean {
  if (
    !value ||
    value.length > MAX_GOOGLE_AVATAR_KEY_LENGTH ||
    value === "." ||
    value === ".." ||
    value.toLowerCase().includes(".svg")
  ) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 0x30 && code <= 0x39;
    const isUppercaseLetter = code >= 0x41 && code <= 0x5a;
    const isLowercaseLetter = code >= 0x61 && code <= 0x7a;
    if (
      !isDigit &&
      !isUppercaseLetter &&
      !isLowercaseLetter &&
      value[index] !== "." &&
      value[index] !== "-" &&
      value[index] !== "_" &&
      value[index] !== "="
    ) {
      return false;
    }
  }

  return true;
}

function resolveGoogleOAuthAvatarUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const avatarKey = url.pathname.slice(GOOGLE_OAUTH_AVATAR_PATH_PREFIX.length);
    if (
      url.protocol !== "https:" ||
      url.origin !== GOOGLE_OAUTH_AVATAR_ORIGIN ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(GOOGLE_OAUTH_AVATAR_PATH_PREFIX) ||
      !isCanonicalGoogleAvatarKey(avatarKey) ||
      url.toString() !== value
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Resolves the only avatar URLs that may be requested for the signed-in user:
 * their exact profile-avatars public object or a canonical Google OAuth avatar.
 */
export function resolveProfileAvatarUrl(
  value: unknown,
  authenticatedUserId: unknown,
): string | null {
  if (!isSafeAvatarUrlValue(value) || !isCanonicalAuthenticatedUserId(authenticatedUserId)) {
    return null;
  }

  return resolveStorageAvatarUrl(value, authenticatedUserId)
    ?? resolveGoogleOAuthAvatarUrl(value);
}

/**
 * Returns the sole removable storage key after verifying that the current URL
 * is the signed-in user's canonical profile avatar URL.
 */
export function getProfileAvatarDeletionKey(
  currentUrl: unknown,
  authenticatedUserId: unknown,
): string | null {
  const storageKey = getCanonicalAvatarStorageKey(authenticatedUserId);
  if (!storageKey || !isSafeAvatarUrlValue(currentUrl)) return null;

  return resolveStorageAvatarUrl(currentUrl, authenticatedUserId)
    ? storageKey
    : null;
}
/**
 * Classifies an avatar reference for deletion without permitting arbitrary
 * storage paths or treating an OAuth-hosted avatar as an owned object.
 */
export function classifyProfileAvatarUrl(
  value: unknown,
  authenticatedUserId: unknown,
): ProfileAvatarClassification {
  if (!isSafeAvatarUrlValue(value) || !isCanonicalAuthenticatedUserId(authenticatedUserId)) {
    return { kind: "invalid" };
  }

  const storageKey = getProfileAvatarDeletionKey(value, authenticatedUserId);
  if (storageKey) {
    return { kind: "owned_storage", storageKey };
  }

  return resolveGoogleOAuthAvatarUrl(value)
    ? { kind: "google_oauth" }
    : { kind: "invalid" };
}
