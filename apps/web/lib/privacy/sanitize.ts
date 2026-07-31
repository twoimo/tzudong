export const PRIVACY_UNSAFE_VALUE_REASON = "PRIVACY_UNSAFE_VALUE" as const;

export type PrivacyFindingKind =
  | "rrn"
  | "email"
  | "phone"
  | "credential"
  | "token"
  | "cookie"
  | "session"
  | "diagnostic"
  | "precise_location"
  | "raw_ocr"
  | "bounded_value";

export type PrivacyFinding = Readonly<{
  kind: PrivacyFindingKind;
  path: string;
  count: number;
}>;

export type PrivacySanitizationContext = Readonly<{
  /**
   * Device coordinates are sensitive by default. Callers that intentionally
   * handle restaurant/business coordinates must opt in to that separate class.
   */
  locationClass?: "device" | "business";
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
}>;

export type PrivacySanitizationResult = Readonly<{
  value: unknown;
  findings: readonly PrivacyFinding[];
}>;

const REDACTED_PREFIX = "[REDACTED:";
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_STRING_LENGTH = 4_096;
const RRN_LIKE_PATTERN = /\b\d{6}[-\s]?[1-8]\d{6}\b/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KOREAN_PHONE_PATTERN =
  /(?:^|[^\d])(?:(?:\+?82[-.\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5])|(?:\+?82[-.\s]?70|070))[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gm;
const PRECISE_LOCATION_TEXT_PATTERN =
  /(?:\b(?:lat|latitude|lng|lon|longitude)\b|(?:위도|경도))\s*[:=]\s*-?\d{1,3}\.\d{4,}/gim;
const PRECISE_LOCATION_QUERY_PATTERN =
  /[?&](?:lat|latitude|lng|lon|longitude)=-?\d{1,3}\.\d{4,}(?:&|$)/gim;
const LABELED_COORDINATE_PAIR_PATTERN =
  /(?:coordinates?|coords?|좌표)\s*[:=]\s*\(?\s*-?\d{1,3}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,}\s*\)?/gim;
const CREDENTIAL_PATTERN =
  /\b(?:password|passphrase|secret|api[_-]?key|access[_-]?key|authorization|client[_-]?secret|service[_-]?role|private[_-]?key)\s*[:=]\s*[^\s&]+/gi;
const BEARER_TOKEN_PATTERN = /\bbearer\s+[^\s]+/gi;
const TOKEN_ASSIGNMENT_PATTERN =
  /\b(?:access|refresh|id)?[_-]?token\s*[:=]\s*[^\s&]+/gi;
const COOKIE_ASSIGNMENT_PATTERN =
  /\b(?:set[_-]?cookie|cookie)\s*[:=]\s*[^\s&]+/gi;
const SESSION_ASSIGNMENT_PATTERN =
  /\b(?:session(?:[_-]?(?:id|token|key|secret))?|onboarding(?:[_-]?(?:token|session|state|code|value))?|challenge)\s*[:=]\s*[^\s&]+/gi;
const COMPACT_TOKEN_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

const HARD_MAX_DEPTH = 32;
const HARD_MAX_ENTRIES = 1_000;
const HARD_MAX_STRING_LENGTH = 4_096;
const HARD_MAX_INPUT_BYTES = 64 * 1_024;
const HARD_MAX_OUTPUT_BYTES = 64 * 1_024;
const HARD_MAX_WORK_UNITS = 256 * 1_024;
const OUTPUT_TRUNCATION_RESERVE_BYTES = 512;
const MAX_PROPERTY_KEY_LENGTH = 128;
const MAX_PATH_LENGTH = 512;
const MAX_FINDINGS = 2_048;
const STRING_PATTERN_WORK_MULTIPLIER = 12;
const FINDING_OUTPUT_OVERHEAD_BYTES = 48;
const PRIMITIVE_OUTPUT_BYTES = 64;
const COORDINATE_CONTAINER_KEYS = new Set([
  "coord",
  "coords",
  "coordinate",
  "coordinates",
  "position",
  "location",
  "devicelocation",
  "currentlocation",
  "geolocation",
  "gps",
  "devicecoord",
  "devicecoords",
  "devicecoordinate",
  "devicecoordinates",
  "deviceposition",
  "currentcoord",
  "currentcoords",
  "currentcoordinate",
  "currentcoordinates",
  "currentposition",
]);

type SanitizationState = {
  readonly findings: PrivacyFinding[];
  readonly coordinateInventorySeen: WeakSet<object>;
  readonly seen: WeakSet<object>;
  entriesVisited: number;
  inputBytes: number;
  outputBytes: number;
  workUnits: number;
  outputExhausted: boolean;
  unsafe: boolean;
  truncated: boolean;
};
const unsafeSanitizationResults = new WeakSet<PrivacySanitizationResult>();
type NodeBuiltinProcess = Readonly<{
  getBuiltinModule?: (name: string) => unknown;
}>;

type NodeUtilTypes = Readonly<{
  isProxy?: (value: unknown) => boolean;
}>;

type NodeUtilModule = Readonly<{
  types?: NodeUtilTypes;
}>;

const getReliableProxyDetector = () => {
  try {
    const processLike = (
      globalThis as typeof globalThis & { process?: NodeBuiltinProcess }
    ).process;
    const utilModule = processLike?.getBuiltinModule?.("node:util") as
      | NodeUtilModule
      | undefined;
    return typeof utilModule?.types?.isProxy === "function"
      ? utilModule.types.isProxy
      : null;
  } catch {
    return null;
  }
};

const isOrdinaryBrowserDataContainer = (value: object) => {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      return prototype === Array.prototype
        && length !== undefined
        && "value" in length
        && typeof length.value === "number";
    }

    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

/**
 * Node and Bun provide a native, trap-free Proxy detector. Browser JavaScript
 * does not, so that branch accepts only ordinary arrays and plain-object
 * prototypes at the JSON/data boundary. Arbitrary in-process Proxy code is
 * outside that boundary; own accessors are still reduced through descriptors
 * without invocation during the later bounded inventory.
 */
const isSupportedContainer = (value: object) => {
  const detector = getReliableProxyDetector();
  if (detector) {
    try {
      return !detector(value);
    } catch {
      return false;
    }
  }

  return isOrdinaryBrowserDataContainer(value);
};

type SanitizationLimits = Required<
  Pick<PrivacySanitizationContext, "maxDepth" | "maxEntries" | "maxStringLength">
>;

const redacted = (kind: PrivacyFindingKind | "unsupported") =>
  `${REDACTED_PREFIX}${kind}]`;

const boundedPath = (path: string) =>
  path.length <= MAX_PATH_LENGTH ? path : "$[bounded_value]";

const toPath = (
  path: string,
  key: string | number,
  sensitiveKey: { kind: PrivacyFindingKind; count: number } | null = null,
  boundedKey = false,
) => {
  const basePath = boundedPath(path);
  if (typeof key === "number") {
    const candidate = `${basePath}[${key}]`;
    return boundedPath(candidate);
  }

  if (boundedKey || key.length > MAX_PROPERTY_KEY_LENGTH) {
    return boundedPath(`${basePath}[bounded_value]`);
  }

  if (sensitiveKey) {
    return boundedPath(`${basePath}[${sensitiveKey.kind}]`);
  }

  const candidate = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${basePath}.${key}`
    : `${basePath}[${JSON.stringify(key)}]`;
  return boundedPath(candidate);
};

const safeOutputKey = (
  target: Record<string, unknown>,
  key: string,
  sensitiveKey: { kind: PrivacyFindingKind; count: number } | null,
  boundedKey: boolean,
) => {
  if (!boundedKey && !sensitiveKey && key.length <= MAX_PROPERTY_KEY_LENGTH) {
    return key;
  }

  const base = `__privacy_redacted_${sensitiveKey?.kind ?? "bounded_value"}__`;
  let outputKey = base;
  let suffix = 1;
  while (Object.prototype.hasOwnProperty.call(target, outputKey)) {
    outputKey = `${base}_${suffix}`;
    suffix += 1;
  }
  return outputKey;
};

const normalizedKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();
const isApiKeyValueKey = (normalized: string) =>
  normalized === "apikey"
  || normalized.endsWith("apikey")
  || normalized.endsWith("apikeyvalue");


const sensitiveKindForKey = (key: string): PrivacyFindingKind | null => {
  const normalized = normalizedKey(key);

  if (
    normalized.includes("rawocr") ||
    normalized === "ocrraw" ||
    normalized === "ocrresult" ||
    normalized === "ocrtext"
  ) {
    return "raw_ocr";
  }

  if (normalized === "rrn" || normalized.includes("residentregistration")) {
    return "rrn";
  }

  if (
    normalized === "error" ||
    normalized === "message" ||
    normalized === "details" ||
    normalized === "detail" ||
    normalized === "hint" ||
    normalized === "stack" ||
    normalized.includes("errormessage") ||
    normalized.includes("errordetails") ||
    normalized.includes("errorhint") ||
    normalized.includes("errorstack")
  ) {
    return "diagnostic";
  }

  if (normalized.includes("cookie")) {
    return "cookie";
  }

  if (
    normalized === "session" ||
    normalized.includes("sessionid") ||
    normalized.includes("sessionkey") ||
    normalized.includes("sessionsecret") ||
    normalized.includes("onboarding") ||
    normalized.includes("challenge")
  ) {
    return "session";
  }

  if (
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("secret") ||
    isApiKeyValueKey(normalized) ||
    normalized === "accesskey" ||
    normalized.startsWith("xaccesskey") ||
    normalized.startsWith("accesskey") ||
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized.includes("servicerole") ||
    normalized.includes("privatekey")
  ) {
    return "credential";
  }

  if (
    normalized.includes("token") ||
    normalized.includes("jwt") ||
    normalized.includes("bearer")
  ) {
    return "token";
  }

  if (
    normalized === "email" ||
    normalized.endsWith("email") ||
    normalized.endsWith("emailaddress")
  ) {
    return "email";
  }

  if (
    normalized === "phone" ||
    normalized.endsWith("phone") ||
    normalized === "tel" ||
    normalized.endsWith("telephone") ||
    normalized === "mobile" ||
    normalized.endsWith("mobile") ||
    normalized.endsWith("contactnumber") ||
    key.includes("전화") ||
    key.includes("연락처") ||
    key.includes("휴대폰")
  ) {
    return "phone";
  }

  return null;
};

const isLatitudeKey = (key: string) => {
  const normalized = normalizedKey(key);
  return normalized === "lat" || normalized === "latitude";
};

const isLongitudeKey = (key: string) => {
  const normalized = normalizedKey(key);
  return normalized === "lng" || normalized === "lon" || normalized === "longitude";
};

const isCoordinateContainerKey = (key: string) =>
  COORDINATE_CONTAINER_KEYS.has(normalizedKey(key));

const countMatches = (value: string, pattern: RegExp) => {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(value) !== null) {
    count += 1;
  }
  pattern.lastIndex = 0;
  return count;
};

const sensitiveKindForString = (
  value: string,
): { kind: PrivacyFindingKind; count: number } | null => {
  const rrns = countMatches(value, RRN_LIKE_PATTERN);
  if (rrns > 0) return { kind: "rrn", count: rrns };

  const emails = countMatches(value, EMAIL_PATTERN);
  if (emails > 0) return { kind: "email", count: emails };

  const phones = countMatches(value, KOREAN_PHONE_PATTERN);
  if (phones > 0) return { kind: "phone", count: phones };
  const preciseLocationText = countMatches(value, PRECISE_LOCATION_TEXT_PATTERN)
    + countMatches(value, PRECISE_LOCATION_QUERY_PATTERN)
    + countMatches(value, LABELED_COORDINATE_PAIR_PATTERN);
  if (preciseLocationText > 0) {
    return { kind: "precise_location", count: preciseLocationText };
  }

  const credentials = countMatches(value, CREDENTIAL_PATTERN);
  if (credentials > 0) return { kind: "credential", count: credentials };

  const cookies = countMatches(value, COOKIE_ASSIGNMENT_PATTERN);
  if (cookies > 0) return { kind: "cookie", count: cookies };

  const sessions = countMatches(value, SESSION_ASSIGNMENT_PATTERN);
  if (sessions > 0) return { kind: "session", count: sessions };

  const bearerTokens = countMatches(value, BEARER_TOKEN_PATTERN);
  const tokenAssignments = countMatches(value, TOKEN_ASSIGNMENT_PATTERN);
  const compactTokens = countMatches(value, COMPACT_TOKEN_PATTERN);
  if (bearerTokens + tokenAssignments + compactTokens > 0) {
    return {
      kind: "token",
      count: bearerTokens + tokenAssignments + compactTokens,
    };
  }

  return null;
};

const utf8ByteLengthUpTo = (value: string, limit: number) => {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > limit) return limit + 1;
  }

  return bytes;
};

const outputStringBytes = (value: string) => value.length * 6 + 2;

const consumeWork = (state: SanitizationState, units: number) => {
  if (units > HARD_MAX_WORK_UNITS - state.workUnits) {
    state.workUnits = HARD_MAX_WORK_UNITS;
    return false;
  }

  state.workUnits += units;
  return true;
};

const consumeInputBytes = (state: SanitizationState, bytes: number) => {
  if (bytes > HARD_MAX_INPUT_BYTES - state.inputBytes) {
    state.inputBytes = HARD_MAX_INPUT_BYTES;
    return false;
  }

  state.inputBytes += bytes;
  return true;
};

const reserveOutputBytes = (
  state: SanitizationState,
  bytes: number,
  preserveTruncationReserve = true,
) => {
  const available = HARD_MAX_OUTPUT_BYTES
    - state.outputBytes
    - (preserveTruncationReserve ? OUTPUT_TRUNCATION_RESERVE_BYTES : 0);
  if (bytes > available) {
    state.outputExhausted = true;
    return false;
  }

  state.outputBytes += bytes;
  return true;
};
const COMPACT_UNSAFE_SENTINEL: PrivacyFinding = {
  kind: "bounded_value",
  path: "$[bounded_value]",
  count: 1,
};

const compactUnsafeSentinelBytes = FINDING_OUTPUT_OVERHEAD_BYTES
  + outputStringBytes(COMPACT_UNSAFE_SENTINEL.kind)
  + outputStringBytes(COMPACT_UNSAFE_SENTINEL.path)
  + PRIMITIVE_OUTPUT_BYTES;

const ensureCompactUnsafeSentinel = (state: SanitizationState) => {
  if (state.findings.some((finding) => finding.kind === "bounded_value")) return;

  if (state.findings.length >= MAX_FINDINGS) {
    state.findings[state.findings.length - 1] = { ...COMPACT_UNSAFE_SENTINEL };
    return;
  }

  if (reserveOutputBytes(state, compactUnsafeSentinelBytes, false)) {
    state.findings.push({ ...COMPACT_UNSAFE_SENTINEL });
  }
};


const addFinding = (
  state: SanitizationState,
  kind: PrivacyFindingKind,
  path: string,
  count = 1,
) => {
  state.unsafe = true;
  if (state.findings.length >= MAX_FINDINGS) {
    ensureCompactUnsafeSentinel(state);
    return;
  }

  const normalizedCount = Number.isFinite(count) && count > 0
    ? Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER)
    : 1;
  const safePath = boundedPath(path);
  const findingBytes = FINDING_OUTPUT_OVERHEAD_BYTES
    + outputStringBytes(kind)
    + outputStringBytes(safePath)
    + PRIMITIVE_OUTPUT_BYTES;

  if (!reserveOutputBytes(state, findingBytes, false)) {
    ensureCompactUnsafeSentinel(state);
    return;
  }
  state.findings.push({ kind, path: safePath, count: normalizedCount });
};

const emitRedacted = (
  state: SanitizationState,
  kind: PrivacyFindingKind | "unsupported",
): unknown => {
  const value = redacted(kind);
  return reserveOutputBytes(state, outputStringBytes(value), false)
    ? value
    : undefined;
};

const boundedValue = (
  state: SanitizationState,
  path: string,
  count = 1,
): unknown => {
  state.truncated = true;
  addFinding(state, "bounded_value", path, count);
  return emitRedacted(state, "bounded_value");
};

const emitPrimitive = (
  state: SanitizationState,
  value: unknown,
  path: string,
): unknown =>
  reserveOutputBytes(state, PRIMITIVE_OUTPUT_BYTES) ? value : boundedValue(state, path);

const emitSafeString = (
  state: SanitizationState,
  value: string,
  path: string,
): unknown =>
  reserveOutputBytes(state, outputStringBytes(value))
    ? value
    : boundedValue(state, path);

const getOwnDataProperty = (value: object, key: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};
const LATITUDE_PROPERTY_KEYS = [
  "lat",
  "latitude",
  "Lat",
  "Latitude",
  "LAT",
  "LATITUDE",
] as const;
const LONGITUDE_PROPERTY_KEYS = [
  "lng",
  "lon",
  "longitude",
  "Lng",
  "Lon",
  "Longitude",
  "LNG",
  "LON",
  "LONGITUDE",
] as const;
const X_PROPERTY_KEYS = ["x", "X"] as const;
const Y_PROPERTY_KEYS = ["y", "Y"] as const;
const NESTED_COORDINATE_PROPERTY_KEYS = [
  "coord",
  "coords",
  "coordinate",
  "coordinates",
  "position",
  "location",
  "deviceCoord",
  "deviceCoords",
  "deviceCoordinate",
  "deviceCoordinates",
  "devicePosition",
  "deviceLocation",
  "currentCoord",
  "currentCoords",
  "currentCoordinate",
  "currentCoordinates",
  "currentPosition",
  "currentLocation",
  "geolocation",
  "geoLocation",
  "GPS",
  "gps",
] as const;


const isLatitude = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;

const isLongitude = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;

const isCoordinatePair = (first: unknown, second: unknown) =>
  (isLatitude(first) && isLongitude(second))
  || (isLongitude(first) && isLatitude(second));

const coordinateObjectHasPair = (value: object) => {
  if (!isSupportedContainer(value)) return false;

  for (const latitudeKey of LATITUDE_PROPERTY_KEYS) {
    const latitude = getOwnDataProperty(value, latitudeKey);
    for (const longitudeKey of LONGITUDE_PROPERTY_KEYS) {
      if (isLatitude(latitude) && isLongitude(getOwnDataProperty(value, longitudeKey))) {
        return true;
      }
    }
  }

  for (const yKey of Y_PROPERTY_KEYS) {
    const y = getOwnDataProperty(value, yKey);
    for (const xKey of X_PROPERTY_KEYS) {
      if (isLatitude(y) && isLongitude(getOwnDataProperty(value, xKey))) {
        return true;
      }
    }
  }

  return false;
};

const hasCoordinatePair = (
  value: unknown,
  remainingDepth = 2,
  seen = new WeakSet<object>(),
): boolean => {
  if (
    value === null
    || typeof value !== "object"
    || !isSupportedContainer(value)
    || seen.has(value)
  ) return false;
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return getOwnDataProperty(value, "length") === 2
        && isCoordinatePair(
          getOwnDataProperty(value, "0"),
          getOwnDataProperty(value, "1"),
        );
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (coordinateObjectHasPair(value)) return true;
    if (remainingDepth === 0) return false;

    for (const key of NESTED_COORDINATE_PROPERTY_KEYS) {
      const nested = getOwnDataProperty(value, key);
      if (hasCoordinatePair(nested, remainingDepth - 1, seen)) return true;
    }
  } catch {
    return false;
  }

  return false;
};

const resolveLimit = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
};

const readContextValue = (
  context: PrivacySanitizationContext,
  key: keyof PrivacySanitizationContext,
): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const resolveLimits = (
  context: PrivacySanitizationContext,
): SanitizationLimits => ({
  maxDepth: resolveLimit(
    readContextValue(context, "maxDepth"),
    DEFAULT_MAX_DEPTH,
    0,
    HARD_MAX_DEPTH,
  ),
  maxEntries: resolveLimit(
    readContextValue(context, "maxEntries"),
    DEFAULT_MAX_ENTRIES,
    1,
    HARD_MAX_ENTRIES,
  ),
  maxStringLength: resolveLimit(
    readContextValue(context, "maxStringLength"),
    DEFAULT_MAX_STRING_LENGTH,
    1,
    HARD_MAX_STRING_LENGTH,
  ),
});

const allowsBusinessLocation = (context: PrivacySanitizationContext) =>
  readContextValue(context, "locationClass") === "business";

const defineSafeProperty = (target: Record<string, unknown>, key: string, value: unknown) => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
};
const isArrayIndexKey = (key: string) => {
  const index = Number(key);
  return Number.isInteger(index)
    && index >= 0
    && index < 2 ** 32 - 1
    && String(index) === key;
};

const sensitiveKindForSymbolKey = (key: symbol) => {
  const description = key.description;
  return description && description.length <= MAX_PROPERTY_KEY_LENGTH
    ? sensitiveKindForKey(description)
    : null;
};
/**
 * Whole-node coordinate redaction hides the entire graph below this node. A
 * bounded descriptor-only pass preserves direct sibling categories without
 * invoking accessors or recursively traversing that hidden graph.
 */
const inventoryCoordinateSiblingFindings = (
  value: object,
  path: string,
  depth: number,
  limits: SanitizationLimits,
  state: SanitizationState,
) => {
  if (state.coordinateInventorySeen.has(value)) return;
  state.coordinateInventorySeen.add(value);

  const isArray = Array.isArray(value);
  const permittedEntries = Math.max(0, limits.maxEntries - state.entriesVisited);
  let inspectedEntries = 0;
  let truncated = false;

  try {
    for (const key of Reflect.ownKeys(value)) {
      if (isArray && key === "length") continue;
      if (!consumeWork(state, 1) || inspectedEntries >= permittedEntries) {
        truncated = true;
        break;
      }

      inspectedEntries += 1;
      state.entriesVisited += 1;

      if (typeof key === "symbol") {
        const keyKind = sensitiveKindForSymbolKey(key);
        if (keyKind) {
          addFinding(state, keyKind, toPath(path, "", null, true));
        }
        if (state.outputExhausted) {
          truncated = true;
          break;
        }
        continue;
      }

      let keySensitivity: { kind: PrivacyFindingKind; count: number } | null = null;
      let keyKind: PrivacyFindingKind | null = null;
      let boundedKey = key.length > MAX_PROPERTY_KEY_LENGTH;

      if (boundedKey) {
        consumeInputBytes(state, HARD_MAX_INPUT_BYTES);
      } else {
        const keyBytes = utf8ByteLengthUpTo(
          key,
          HARD_MAX_INPUT_BYTES - state.inputBytes,
        );
        if (
          !consumeInputBytes(state, keyBytes)
          || !consumeWork(state, key.length * STRING_PATTERN_WORK_MULTIPLIER)
        ) {
          boundedKey = true;
        } else {
          keySensitivity = sensitiveKindForString(key);
          keyKind = sensitiveKindForKey(key);
        }
      }

      const propertyPath = toPath(
        path,
        isArray && isArrayIndexKey(key) ? Number(key) : key,
        keySensitivity,
        boundedKey,
      );
      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (keySensitivity) {
        addFinding(
          state,
          keySensitivity.kind,
          propertyPath,
          keySensitivity.count,
        );
      } else if (boundedKey) {
        addFinding(state, "bounded_value", propertyPath);
      }

      if (!descriptor || !("value" in descriptor)) {
        if (keyKind) addFinding(state, keyKind, propertyPath);
        addFinding(state, "bounded_value", propertyPath);
      } else if (!consumeWork(state, 1)) {
        truncated = true;
        break;
      } else if (keyKind) {
        addFinding(state, keyKind, propertyPath);
      } else if (depth + 1 > limits.maxDepth) {
        addFinding(state, "bounded_value", propertyPath);
      } else if (!boundedKey && typeof descriptor.value === "string") {
        if (descriptor.value.length > limits.maxStringLength) {
          addFinding(state, "bounded_value", propertyPath);
        } else {
          const inputBytes = utf8ByteLengthUpTo(
            descriptor.value,
            HARD_MAX_INPUT_BYTES - state.inputBytes,
          );
          if (
            !consumeInputBytes(state, inputBytes)
            || !consumeWork(
              state,
              descriptor.value.length * STRING_PATTERN_WORK_MULTIPLIER,
            )
          ) {
            truncated = true;
            addFinding(state, "bounded_value", propertyPath);
          } else {
            const sensitive = sensitiveKindForString(descriptor.value);
            if (sensitive) {
              addFinding(state, sensitive.kind, propertyPath, sensitive.count);
            }
          }
        }
      }

      if (state.outputExhausted) {
        truncated = true;
        break;
      }
    }
  } catch {
    truncated = true;
  }

  if (truncated) {
    state.truncated = true;
    addFinding(state, "bounded_value", path);
  }
};
const sanitizeValue = (
  value: unknown,
  path: string,
  depth: number,
  allowsBusinessLocation: boolean,
  limits: SanitizationLimits,
  state: SanitizationState,
  forcedKind: PrivacyFindingKind | null = null,
): unknown => {
  if (!consumeWork(state, 1)) return boundedValue(state, path);

  if (forcedKind) {
    addFinding(state, forcedKind, path);
    const sanitized = emitRedacted(state, forcedKind);
    if (
      forcedKind === "precise_location"
      && value !== null
      && typeof value === "object"
      && isSupportedContainer(value)
    ) {
      inventoryCoordinateSiblingFindings(value, path, depth, limits, state);
    }
    return sanitized;
  }

  if (depth > limits.maxDepth) {
    return boundedValue(state, path);
  }

  if (typeof value === "string") {
    if (value.length > limits.maxStringLength) {
      return boundedValue(state, path);
    }

    const inputBytes = utf8ByteLengthUpTo(
      value,
      HARD_MAX_INPUT_BYTES - state.inputBytes,
    );
    if (
      !consumeInputBytes(state, inputBytes)
      || !consumeWork(state, value.length * STRING_PATTERN_WORK_MULTIPLIER)
    ) {
      return boundedValue(state, path);
    }

    const sensitive = sensitiveKindForString(value);
    if (sensitive) {
      addFinding(state, sensitive.kind, path, sensitive.count);
      return emitRedacted(state, sensitive.kind);
    }

    return emitSafeString(state, value, path);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return emitPrimitive(state, value, path);
  }

  if (
    typeof value !== "object"
    || !isSupportedContainer(value)
    || state.seen.has(value)
  ) {
    return boundedValue(state, path);
  }

  if (!allowsBusinessLocation && hasCoordinatePair(value, 0)) {
    addFinding(state, "precise_location", path);
    const sanitized = emitRedacted(state, "precise_location");
    inventoryCoordinateSiblingFindings(value, path, depth, limits, state);
    return sanitized;
  }

  state.seen.add(value);
  if (
    state.entriesVisited >= limits.maxEntries
    || state.workUnits >= HARD_MAX_WORK_UNITS
  ) {
    return boundedValue(state, path);
  }

  try {
    const isArray = Array.isArray(value);
    if (!isArray) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return boundedValue(state, path);
      }
    }

    if (isArray) {
      const output: unknown[] = [];
      if (!reserveOutputBytes(state, 2)) return boundedValue(state, path);

      const keys = Reflect.ownKeys(value);
      const permittedEntries = Math.max(0, limits.maxEntries - state.entriesVisited);
      let inspectedEntries = 0;
      let truncated = false;

      for (const key of keys) {
        if (key === "length") continue;
        if (!consumeWork(state, 1) || inspectedEntries >= permittedEntries) {
          truncated = true;
          break;
        }

        inspectedEntries += 1;
        state.entriesVisited += 1;

        if (typeof key === "symbol") {
          const propertyPath = toPath(path, "", null, true);
          const keyKind = sensitiveKindForSymbolKey(key);
          if (keyKind) addFinding(state, keyKind, propertyPath);
          boundedValue(state, propertyPath);

          if (state.outputExhausted) {
            truncated = true;
            break;
          }
          continue;
        }

        let keySensitivity: { kind: PrivacyFindingKind; count: number } | null = null;
        let keyKind: PrivacyFindingKind | null = null;
        let boundedKey = key.length > MAX_PROPERTY_KEY_LENGTH;

        if (boundedKey) {
          consumeInputBytes(state, HARD_MAX_INPUT_BYTES);
        } else {
          const keyBytes = utf8ByteLengthUpTo(
            key,
            HARD_MAX_INPUT_BYTES - state.inputBytes,
          );
          if (
            !consumeInputBytes(state, keyBytes)
            || !consumeWork(state, key.length * STRING_PATTERN_WORK_MULTIPLIER)
          ) {
            boundedKey = true;
          } else {
            keySensitivity = sensitiveKindForString(key);
            keyKind = sensitiveKindForKey(key);
          }
        }

        const arrayIndex = isArrayIndexKey(key);
        const propertyPath = toPath(
          path,
          arrayIndex ? Number(key) : key,
          keySensitivity,
          boundedKey,
        );
        const outputKey = arrayIndex
          ? ""
          : safeOutputKey(output as unknown as Record<string, unknown>, key, keySensitivity, boundedKey);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        const isCoordinateContainer = !allowsBusinessLocation
          && !boundedKey
          && isCoordinateContainerKey(key)
          && descriptor !== undefined
          && "value" in descriptor
          && hasCoordinatePair(descriptor.value);
        const forcedKind =
          keyKind ??
          (!allowsBusinessLocation
            && (isLatitudeKey(key) || isLongitudeKey(key) || isCoordinateContainer)
            ? "precise_location"
            : null);

        if (
          !reserveOutputBytes(
            state,
            arrayIndex ? 1 : outputStringBytes(outputKey) + 1,
          )
        ) {
          truncated = true;
          break;
        }

        if (keySensitivity) {
          addFinding(
            state,
            keySensitivity.kind,
            propertyPath,
            keySensitivity.count,
          );
        } else if (boundedKey) {
          addFinding(state, "bounded_value", propertyPath);
        }

        let sanitized: unknown;
        if (!descriptor || !("value" in descriptor)) {
          if (forcedKind) addFinding(state, forcedKind, propertyPath);
          sanitized = boundedValue(state, propertyPath);
        } else {
          sanitized = sanitizeValue(
            descriptor.value,
            propertyPath,
            depth + 1,
            allowsBusinessLocation,
            limits,
            state,
            forcedKind,
          );
        }

        if (arrayIndex) {
          output.push(sanitized);
        } else {
          defineSafeProperty(
            output as unknown as Record<string, unknown>,
            outputKey,
            sanitized,
          );
        }

        if (state.outputExhausted) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        state.truncated = true;
        addFinding(state, "bounded_value", path);
        const marker = emitRedacted(state, "bounded_value");
        if (marker !== undefined && reserveOutputBytes(state, 1, false)) {
          output.push(marker);
        }
      }

      return output;
    }

    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    if (!reserveOutputBytes(state, 2)) return boundedValue(state, path);

    const keys = Reflect.ownKeys(source);
    const permittedEntries = Math.max(0, limits.maxEntries - state.entriesVisited);
    let inspectedEntries = 0;
    let truncated = false;

    for (const key of keys) {
      if (!consumeWork(state, 1) || inspectedEntries >= permittedEntries) {
        truncated = true;
        break;
      }

      inspectedEntries += 1;
      state.entriesVisited += 1;

      if (typeof key === "symbol") {
        const propertyPath = toPath(path, "", null, true);
        const keyKind = sensitiveKindForSymbolKey(key);
        if (keyKind) addFinding(state, keyKind, propertyPath);
        boundedValue(state, propertyPath);

        if (state.outputExhausted) {
          truncated = true;
          break;
        }
        continue;
      }

      let keySensitivity: { kind: PrivacyFindingKind; count: number } | null = null;
      let keyKind: PrivacyFindingKind | null = null;
      let boundedKey = key.length > MAX_PROPERTY_KEY_LENGTH;

      if (boundedKey) {
        consumeInputBytes(state, HARD_MAX_INPUT_BYTES);
      } else {
        const keyBytes = utf8ByteLengthUpTo(
          key,
          HARD_MAX_INPUT_BYTES - state.inputBytes,
        );
        if (
          !consumeInputBytes(state, keyBytes)
          || !consumeWork(state, key.length * STRING_PATTERN_WORK_MULTIPLIER)
        ) {
          boundedKey = true;
        } else {
          keySensitivity = sensitiveKindForString(key);
          keyKind = sensitiveKindForKey(key);
        }
      }

      const propertyPath = toPath(path, key, keySensitivity, boundedKey);
      const outputKey = safeOutputKey(output, key, keySensitivity, boundedKey);
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      const isCoordinateContainer = !allowsBusinessLocation
        && !boundedKey
        && isCoordinateContainerKey(key)
        && descriptor !== undefined
        && "value" in descriptor
        && hasCoordinatePair(descriptor.value);
      const forcedKind =
        keyKind ??
        (!allowsBusinessLocation
          && (isLatitudeKey(key) || isLongitudeKey(key) || isCoordinateContainer)
          ? "precise_location"
          : null);

      if (!reserveOutputBytes(state, outputStringBytes(outputKey) + 1)) {
        truncated = true;
        break;
      }

      if (keySensitivity) {
        addFinding(
          state,
          keySensitivity.kind,
          propertyPath,
          keySensitivity.count,
        );
      } else if (boundedKey) {
        addFinding(state, "bounded_value", propertyPath);
      }

      let sanitized: unknown;
      if (!descriptor || !("value" in descriptor)) {
        if (forcedKind) addFinding(state, forcedKind, propertyPath);
        sanitized = boundedValue(state, propertyPath);
      } else {
        sanitized = sanitizeValue(
          descriptor.value,
          propertyPath,
          depth + 1,
          allowsBusinessLocation,
          limits,
          state,
          forcedKind,
        );
      }

      defineSafeProperty(output, outputKey, sanitized);

      if (state.outputExhausted) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      state.truncated = true;
      addFinding(state, "bounded_value", path);
      const marker = emitRedacted(state, "bounded_value");
      if (
        marker !== undefined
        && reserveOutputBytes(
          state,
          outputStringBytes("__privacy_truncated__") + 1,
          false,
        )
      ) {
        defineSafeProperty(output, "__privacy_truncated__", marker);
      }
    }

    return output;
  } catch {
    return boundedValue(state, path);
  }
};

/**
 * Produces a bounded, detached value suitable for low-trust text sinks.
 * Findings contain only a category, structural path, and count; they never
 * retain a matched string, coordinate, or original object reference.
 */
export const sanitizePrivacyValue = (
  value: unknown,
  context: PrivacySanitizationContext = {},
): PrivacySanitizationResult => {
  const state: SanitizationState = {
    entriesVisited: 0,
    findings: [],
    inputBytes: 0,
    outputBytes: 0,
    outputExhausted: false,
    coordinateInventorySeen: new WeakSet<object>(),
    seen: new WeakSet<object>(),
    truncated: false,
    unsafe: false,
    workUnits: 0,
  };
  const limits = resolveLimits(context);
  const allowBusinessLocation = allowsBusinessLocation(context);
  const result: PrivacySanitizationResult = {
    findings: state.findings,
    value: sanitizeValue(value, "$", 0, allowBusinessLocation, limits, state),
  };

  if (state.unsafe || state.truncated || state.outputExhausted) {
    unsafeSanitizationResults.add(result);
  }

  return result;
};

export class PrivacyUnsafeValueError extends Error {
  readonly code = PRIVACY_UNSAFE_VALUE_REASON;
  readonly findings: readonly PrivacyFinding[];

  constructor(findings: readonly PrivacyFinding[]) {
    super("민감정보가 포함된 값은 이 대상에 사용할 수 없습니다.");
    this.name = "PrivacyUnsafeValueError";
    this.findings = findings.map(({ kind, path, count }) => ({ kind, path, count }));
  }
}

/**
 * Blocks risky values at a sink without exposing their content in an error.
 */
export const assertPrivacySafe = (
  value: unknown,
  context: PrivacySanitizationContext = {},
): void => {
  const result = sanitizePrivacyValue(value, context);

  if (result.findings.length > 0 || unsafeSanitizationResults.has(result)) {
    throw new PrivacyUnsafeValueError(result.findings);
  }
};
