import { execFileSync } from "node:child_process";
import { createHash, createHmac, timingSafeEqual, verify } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = (value) => /^[a-f0-9]{64}$/.test(value || "");
const gitId = (value) => /^[a-f0-9]{40}$/.test(value || "");
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value || "");
const releaseId = (value) => /^ts7-[a-z0-9][a-z0-9-]{0,47}$/.test(value || "");
const deploymentId = (value) => /^dpl_[A-Za-z0-9]+$/.test(value || "");
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const SUPABASE_SERVICE_ROLE = "service_role";
const publishableGatewayKey = (value, capability) => {
  if (typeof value !== "string" || value.length < 20 || value.length > 512 || !/^[\x21-\x7e]+$/.test(value) || value === capability) return false;
  const jwt = value.split(".");
  if (jwt.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"));
      return claims?.role === "anon" && claims.role !== SUPABASE_SERVICE_ROLE;
    } catch {
      return false;
    }
  }
  return /^sb_publishable_[A-Za-z0-9_-]{16,480}$/.test(value);
};
const G009_VERIFIER_KEY_ID = "g009-release-visual-verifier-ed25519-2026-07";
const G009_VERIFIER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyvULURIQ0vf9RQeNmC59HJvrBz/MJ1pfbSS0BcTpaQE=
-----END PUBLIC KEY-----`;
const G009_VERIFICATION_DOMAIN = "tzudong:g009:release-visual-verification:v3\n";
const G009_TEMPLATE_SHA256 = "fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040";
const G009_ISSUER_PATHS = ["playwright.release.config.ts", "scripts/assemble-release-visual-evidence.mjs", "scripts/run-release-visual-evidence.mjs", "scripts/verify-release-visual-evidence.mjs", "tests/release-visual-cells.template.json", "tests/release-visual.spec.ts"];
const G009_AUTH_CELL_IDS = ["preview-admin-auth-smoke-metadata", "production-admin-auth-smoke-metadata", "alias-admin-auth-smoke-metadata"];
const G009_SCREENSHOT_ARTIFACTS = ["local-public-home-desktop.png", "local-synthetic-admin-console.png", "local-reduced-motion.png", "preview-public-home-desktop.png", "preview-reduced-motion.png", "production-public-home-desktop.png", "production-reduced-motion.png", "alias-public-home-desktop.png", "alias-reduced-motion.png"];
const G009_CELLS = [
  ["local-public-home-desktop", "playwright-synthetic", "screenshot", "local-public-home-desktop.png"],
  ["local-synthetic-admin-console", "playwright-synthetic", "screenshot", "local-synthetic-admin-console.png"],
  ["local-reduced-motion", "playwright-synthetic", "screenshot", "local-reduced-motion.png"],
  ["preview-public-home-desktop", "playwright-public", "screenshot", "preview-public-home-desktop.png"],
  ["preview-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
  ["preview-reduced-motion", "playwright-public", "screenshot", "preview-reduced-motion.png"],
  ["production-public-home-desktop", "playwright-public", "screenshot", "production-public-home-desktop.png"],
  ["production-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
  ["production-reduced-motion", "playwright-public", "screenshot", "production-reduced-motion.png"],
  ["alias-public-home-desktop", "playwright-public", "screenshot", "alias-public-home-desktop.png"],
  ["alias-admin-auth-smoke-metadata", "standalone-auth", "metadata-only", "metadata-only"],
  ["alias-reduced-motion", "playwright-public", "screenshot", "alias-reduced-motion.png"],
];
const base64url32 = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").length === 32 && Buffer.from(value, "base64url").toString("base64url") === value;
const scoredBacklogSchema = JSON.parse(fs.readFileSync(new URL("../performance/backlog-scored.schema.json", import.meta.url), "utf8"));
const schemaKeywords = new Set(["$defs", "$id", "$ref", "$schema", "additionalProperties", "allOf", "anyOf", "const", "enum", "items", "maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "oneOf", "pattern", "properties", "required", "title", "type", "x-arrayIdentity"]);
const assertSupportedSchema = (schema) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || Object.keys(schema).some((key) => !schemaKeywords.has(key))) throw new Error("unsupported scored backlog schema");
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) value.forEach((item) => { if (item && typeof item === "object") assertSupportedSchema(item); });
      else if (!["properties", "$defs"].some((key) => Object.hasOwn(schema, key))) assertSupportedSchema(value);
      else Object.values(value).forEach((item) => { if (item && typeof item === "object") assertSupportedSchema(item); });
    }
  }
};
assertSupportedSchema(scoredBacklogSchema);
function schemaFor(schema, root) { return schema.$ref ? schema.$ref.startsWith("#/$defs/") ? root.$defs[schema.$ref.slice(8)] : null : schema; }
function schemaValid(value, schema, root = scoredBacklogSchema) {
  schema = schemaFor(schema, root); if (!schema) return false;
  if (schema.allOf && !schema.allOf.every((part) => schemaValid(value, part, root))) return false;
  if (schema.anyOf && !schema.anyOf.some((part) => schemaValid(value, part, root))) return false;
  if (schema.oneOf && schema.oneOf.filter((part) => schemaValid(value, part, root)).length !== 1) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : type === "integer" ? Number.isSafeInteger(value) : typeof value === type)) return false;
  }
  if (typeof value === "string" && ((schema.pattern && !(new RegExp(schema.pattern).test(value))) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.minLength !== undefined && value.length < schema.minLength))) return false;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (Array.isArray(value)) return (!schema.minItems || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems) && value.every((item) => schemaValid(item, schema.items || {}, root));
  if (value && typeof value === "object") return !(schema.required?.some((key) => !Object.hasOwn(value, key)) || (schema.additionalProperties === false && Object.keys(value).some((key) => !schema.properties?.[key]))) && Object.entries(value).every(([key, nested]) => !schema.properties?.[key] || schemaValid(nested, schema.properties[key], root));
  return true;
}
const canonicalJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : fail("COMPONENT_SCHEMA_INVALID");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("COMPONENT_SCHEMA_INVALID");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};

const failureCodes = new Set(["VERIFIED", "ROLLED_BACK", "DISPATCH_REF_INVALID", "INPUT_GRAMMAR_INVALID", "CHECKOUT_IDENTITY_MISMATCH", "TARGET_TREE_MISMATCH", "WORKFLOW_AT_HEAD_MISMATCH", "RECEIPT_URL_NOT_ALLOWLISTED", "RECEIPT_FETCH_FAILED", "RECEIPT_HASH_MISMATCH", "RECEIPT_JSON_INVALID", "RECEIPT_IDENTITY_MISMATCH", "TUPLE_MISMATCH", "ROLLBACK_EVENT_MISMATCH", "FRESHNESS_MISMATCH", "COMPONENT_URL_INVALID", "COMPONENT_FETCH_FAILED", "COMPONENT_HASH_MISMATCH", "COMPONENT_SCHEMA_INVALID", "FINAL_BUNDLE_MISMATCH", "EVIDENCE_EMPTY", "EVIDENCE_SCHEMA_INVALID", "EVIDENCE_URL_INVALID", "EVIDENCE_FETCH_FAILED", "EVIDENCE_HASH_MISMATCH", "GITHUB_DEPLOYMENT_MISMATCH", "GITHUB_STATUS_MISMATCH", "HTTPS_HEALTH_MISMATCH", "HTTPS_IDENTITY_MISMATCH", "VERCEL_DEPLOYMENT_MISMATCH", "TRANSITION_SIGNATURE_MISMATCH", "TRANSITION_JOURNAL_MISMATCH", "AUTH_REVOCATION_MISMATCH", "VISUAL_LEDGER_MISMATCH", "UNKNOWN_VALIDATION_FAILURE"]);
export const manifestInputKeys = [
  "GITHUB_DEPLOYMENT_ID",
  "KNOWN_GOOD_DEPLOYMENT_ID",
  "KNOWN_GOOD_GIT_SHA",
  "KNOWN_GOOD_HOST",
  "KNOWN_GOOD_DEPLOYMENT_DOMAIN_RECEIPT_SHA256",
  "KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256",
  "KNOWN_GOOD_DEPLOYMENT_RECEIPT_URL",
  "PREVIEW_DEPLOYMENT_DOMAIN_RECEIPT_SHA256",
  "PREVIEW_DEPLOYMENT_ID",
  "PREVIEW_DEPLOYMENT_RECEIPT_SHA256",
  "PREVIEW_DEPLOYMENT_RECEIPT_URL",
  "PREVIEW_HOST",
  "PRODUCTION_ALIAS_DEPLOYMENT_DOMAIN_RECEIPT_SHA256",
  "PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256",
  "PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_URL",
  "PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256",
  "PRODUCTION_DEPLOYMENT_ID",
  "PRODUCTION_DEPLOYMENT_RECEIPT_SHA256",
  "PRODUCTION_DEPLOYMENT_RECEIPT_URL",
  "PRODUCTION_DEPLOYMENT_URL",
  "PROMOTION_EVENT_ID",
  "REPROMOTION_EVENT_ID",
  "RECEIPT_SHA256",
  "RECEIPT_URL",
  "ROLLBACK_EVENT_ID",
  "ROLLBACK_STATE",
  "SCORED_BACKLOG_SHA256",
  "SCORED_BACKLOG_URL",
  "STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256",
  "STANDALONE_AUTH_ALIAS_RECEIPT_SHA256",
  "STANDALONE_AUTH_ALIAS_RECEIPT_URL",
  "STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256",
  "STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256",
  "STANDALONE_AUTH_PREVIEW_RECEIPT_URL",
  "STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256",
  "STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256",
  "STANDALONE_AUTH_PRODUCTION_RECEIPT_URL",
  "VISUAL_CERTIFICATION_ID",
  "VISUAL_DOMAIN_RECEIPT_SHA256",
  "VISUAL_VERIFICATION_BUNDLE_SHA256",
  "VISUAL_VERIFICATION_BUNDLE_URL",
  "VISUAL_LEDGER_SHA256",
  "VISUAL_LEDGER_URL",
  "VISUAL_VERIFICATION_RECEIPT_SHA256",
  "VISUAL_VERIFICATION_RECEIPT_URL",
];
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

function duplicateFreeJson(text) {
  let index = 0; const whitespace = () => { while (/[ \n\t]/.test(text[index])) index += 1; };
  const string = () => { const start = index; index += 1; let escaped = false; while (index < text.length) { const character = text[index++]; if (!escaped && character === "\"") return JSON.parse(text.slice(start, index)); if (!escaped && character === "\\") escaped = true; else escaped = false; } throw new Error("string"); };
  const value = () => { whitespace(); if (text[index] === "{") { index += 1; const keys = new Set(); whitespace(); if (text[index] === "}") { index += 1; return; } for (;;) { whitespace(); if (text[index] !== "\"") throw new Error("object"); const key = string(); if (keys.has(key)) throw new Error("duplicate"); keys.add(key); whitespace(); if (text[index++] !== ":") throw new Error("object"); value(); whitespace(); if (text[index] === "}") { index += 1; return; } if (text[index++] !== ",") throw new Error("object"); } } if (text[index] === "[") { index += 1; whitespace(); if (text[index] === "]") { index += 1; return; } for (;;) { value(); whitespace(); if (text[index] === "]") { index += 1; return; } if (text[index++] !== ",") throw new Error("array"); } } if (text[index] === "\"") { string(); return; } const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index)); if (!match) throw new Error("value"); index += match[0].length; };
  value(); whitespace(); if (index !== text.length) throw new Error("trailing");
}
export function parseJson(bytes, code, canonical = false) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(code); }
  if (text.includes("\r") || text.charCodeAt(0) === 0xfeff) fail(code);
  let value;
  try { duplicateFreeJson(text); value = JSON.parse(text); } catch { fail(code); }
  if (canonical && text !== `${canonicalJson(value)}\n`) fail(code);
  return value;
}

export function publicUrl(value, hosts, component = false, expectedSha, expectedDigest = expectedSha) {
  let url;
  try { url = new URL(value); } catch { fail(component ? "COMPONENT_URL_INVALID" : "EVIDENCE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || (hosts.length && !hosts.includes(url.hostname))) fail(component ? "COMPONENT_URL_INVALID" : "RECEIPT_URL_NOT_ALLOWLISTED");
  if (component) {
    const raw = url.hostname === "raw.githubusercontent.com" && new RegExp(`^/twoimo/tzudong/${expectedSha}/[A-Za-z0-9._/-]+\\.json$`).test(url.pathname);
    const evidence = url.hostname === "release-evidence.tzudong.app" && new RegExp(`^/(?:[A-Za-z0-9._-]+/)*${expectedDigest}\\.json$`).test(url.pathname);
    if (!raw && !evidence) fail("COMPONENT_URL_INVALID");
  }
  return url;
}

export function fetchEvidence(raw, { request = https.request, html = false, headers = {}, method = "GET", body, maxBytes = 262144 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(raw); } catch { return reject(Object.assign(new Error("url"), { code: "EVIDENCE_URL_INVALID" })); }
    if (!["GET", "POST"].includes(method) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144 || (method === "GET" && body !== undefined) || (body !== undefined && !Buffer.isBuffer(body))) return reject(Object.assign(new Error("request"), { code: "EVIDENCE_FETCH_FAILED" }));
    const rawGithub = url.hostname === "raw.githubusercontent.com";
    const requestHandle = request(url, { method, timeout: 5000, headers: { accept: html ? "text/html" : rawGithub ? "text/plain" : "application/json", "user-agent": "tzudong-release-evidence", ...headers } }, (response) => {
      const type = String(response.headers["content-type"] || "").toLowerCase();
      if (response.statusCode !== 200 || response.headers.location || !(html ? type.startsWith("text/html") : rawGithub ? /^text\/plain(?:;|$)/.test(type) : type.startsWith("application/json"))) { response.resume(); return reject(Object.assign(new Error("response"), { code: "EVIDENCE_FETCH_FAILED" })); }
      let size = 0; const chunks = []; const timer = setTimeout(() => response.destroy(Object.assign(new Error("body timeout"), { code: "EVIDENCE_FETCH_FAILED" })), 5000);
      response.on("data", (chunk) => { size += chunk.length; if (size > maxBytes) response.destroy(Object.assign(new Error("large"), { code: "EVIDENCE_FETCH_FAILED" })); else chunks.push(chunk); });
      response.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      response.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    requestHandle.on("timeout", () => requestHandle.destroy(Object.assign(new Error("connect timeout"), { code: "EVIDENCE_FETCH_FAILED" })));
    requestHandle.on("error", reject); requestHandle.end(body);
  });
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const event = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value || "");
const VERCEL_GITHUB_APP_ID = "8329";
const VERCEL_GITHUB_CREATOR = { login: "vercel[bot]", type: "Bot", id: 35613825 };
const authCell = { authPreview: ["preview-admin-auth-smoke-metadata", "preview"], authProduction: ["production-admin-auth-smoke-metadata", "production"], authAlias: ["alias-admin-auth-smoke-metadata", "alias"] };
export function verifyRemoteRefs(expectedSha, expectedTree, gitAdapter = git) {
  for (const branch of ["main", "develop", "data"]) if (gitAdapter("rev-parse", `origin/${branch}^{tree}`) !== expectedTree) fail("TARGET_TREE_MISMATCH");
  if (gitAdapter("rev-parse", "origin/main") !== expectedSha) fail("CHECKOUT_IDENTITY_MISMATCH");
}

function validAuth(kind, value, expected) {
  const [id, environment] = authCell[kind] || [];
  if (!exactKeys(value, ["schemaVersion", "id", "status", "execution", "evidence", "artifact", "sha256", "metadata"]) || value.schemaVersion !== 2 || value.id !== id || value.status !== "required" || value.execution !== "standalone-auth" || value.evidence !== "metadata-only" || value.artifact !== "metadata-only" || value.sha256 !== "metadata-only" || !exactKeys(value.metadata, ["receiptVersion", "receiptSha256", "payload"]) || value.metadata.receiptVersion !== 1 || value.metadata.receiptSha256 !== expected.domainReceiptSha256 || !sha(value.metadata.receiptSha256)) return false;
  const { release, cell, deployment, result } = value.metadata.payload || {};
  if (!exactKeys(value.metadata.payload, ["release", "cell", "deployment", "result"]) || !exactKeys(release, ["releaseId", "certificationId", "gitSha", "challenge", "issuedAt", "expiresAt"]) || release.releaseId !== expected.releaseId || release.certificationId !== expected.certificationId || release.gitSha !== expected.mainSha || !/^[A-Za-z0-9_-]{43}$/.test(release.challenge || "") || !Number.isSafeInteger(release.issuedAt) || !Number.isSafeInteger(release.expiresAt) || release.expiresAt - release.issuedAt < 1 || release.expiresAt - release.issuedAt > 900 || release.expiresAt !== expected.expiresAt || expected.now > release.expiresAt) return false;
  if (!exactKeys(cell, ["id", "environment", "route", "origin", "finalUrl"]) || cell.id !== id || cell.environment !== environment || cell.route !== "/admin" || typeof cell.origin !== "string" || typeof cell.finalUrl !== "string") return false;
  let origin; let finalUrl; try { origin = new URL(cell.origin); finalUrl = new URL(cell.finalUrl); } catch { return false; }
  if (origin.toString() !== cell.origin || origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || finalUrl.toString() !== cell.finalUrl || finalUrl.origin !== origin.origin || finalUrl.pathname !== "/admin" || finalUrl.search || finalUrl.hash || origin.origin !== expected.origin) return false;
  if (!exactKeys(deployment, ["receiptSha256", "deploymentId", "environment", "host", "aliasHost", "observedAt"]) || deployment.receiptSha256 !== expected.deploymentReceiptSha256 || deployment.deploymentId !== expected.deploymentId || deployment.environment !== expected.deploymentEnvironment || deployment.host !== expected.host || deployment.aliasHost !== expected.aliasHost || !Number.isSafeInteger(deployment.observedAt) || deployment.observedAt !== expected.observedAt) return false;
  if (!exactKeys(result, ["ok", "reasonCode", "authProofSha256", "revocationOperationId", "revocationBindingSha256", "revocationReceipt", "shellHeight", "shellWidth", "headingCount", "navigationCount", "status", "capturedAt"]) || result.ok !== true || result.reasonCode !== "OK" || !sha(result.authProofSha256) || !uuid(result.revocationOperationId) || !sha(result.revocationBindingSha256) || !sha(result.revocationReceipt) || result.revocationBindingSha256 !== sha256(Buffer.from(`tzudong:release-auth-revocation-binding:v1\n${canonicalJson({ releaseId: release.releaseId, certificationId: release.certificationId, gitSha: release.gitSha, cellId: cell.id, origin: cell.origin, challenge: release.challenge, issuedAt: release.issuedAt, expiresAt: release.expiresAt, deploymentReceiptSha256: deployment.receiptSha256, capturedAt: result.capturedAt, authProofSha256: result.authProofSha256, revocationOperationId: result.revocationOperationId, outcome: "certified" })}`, "utf8")) || !["shellHeight", "shellWidth", "headingCount", "navigationCount", "status", "capturedAt"].every((key) => Number.isSafeInteger(result[key])) || result.shellHeight < 1 || result.shellWidth < 1 || result.headingCount < 1 || result.navigationCount < 1 || result.status < 200 || result.status >= 300 || result.capturedAt < deployment.observedAt || result.capturedAt > release.expiresAt || result.capturedAt > expected.now + 60) return false;
  return sha256(Buffer.from(`tzudong:release-auth-receipt:v1\n${canonicalJson(value.metadata.payload)}`, "utf8")) === value.metadata.receiptSha256;
}

function validBacklog(value, expected) {
  if (!schemaValid(value, scoredBacklogSchema) || !exactKeys(value, ["schemaVersion", "releaseId", "candidate", "configSha256", "dataProfileSha256", "frozenAsOf", "generatedAt", "raw", "releaseBlocked", "ranking", "items"]) || value.schemaVersion !== "performance-backlog-scored.v2" || value.releaseId !== expected.releaseId || !exactKeys(value.candidate, ["sha", "tree"]) || value.candidate.sha !== expected.mainSha || value.candidate.tree !== expected.releaseTree || value.releaseBlocked !== false || !sha(value.configSha256) || !sha(value.dataProfileSha256) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.frozenAsOf || "") || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.generatedAt || "")) return false;
  if (!exactKeys(value.raw, ["path", "sha256"]) || typeof value.raw.path !== "string" || !sha(value.raw.sha256) || !exactKeys(value.ranking, ["eligibleCount", "admittedIds", "deferredIds"]) || !Number.isInteger(value.ranking.eligibleCount) || value.ranking.eligibleCount < 0 || !Array.isArray(value.ranking.admittedIds) || value.ranking.admittedIds.length > 3 || !Array.isArray(value.ranking.deferredIds) || !Array.isArray(value.items) || value.items.length > 100) return false;
  return value.items.every((item) => exactKeys(item, ["id", "key", "surfaceClass", "targetId", "impact", "risk", "effort", "severity", "observed", "baseline", "sampleCount", "affectedCount", "eligibleCount", "evidenceTimestamp", "confidenceMarginBasisPoints", "confidence", "scoreComponents", "score", "status", "decision", "reason", "rank"]) && typeof item.id === "string" && typeof item.key === "string" && typeof item.surfaceClass === "string" && typeof item.targetId === "string" && ["rankable", "not_rankable", "release_blocked"].includes(item.status) && ["admitted", "deferred_rank_cap", "not_eligible", "blocked"].includes(item.decision));
}
function validIssuerBinding(binding, expected) {
  if (!exactKeys(binding, ["schemaVersion", "commitSha", "treeSha", "executableDigests", "manifestSha256"]) || binding.schemaVersion !== 1 || binding.commitSha !== expected.mainSha || binding.treeSha !== expected.releaseTree || !exactKeys(binding.executableDigests, G009_ISSUER_PATHS) || !sha(binding.manifestSha256) || Object.values(binding.executableDigests).some((digest) => !sha(digest))) return false;
  return binding.manifestSha256 === sha256(Buffer.from(canonicalJson({ schemaVersion: binding.schemaVersion, commitSha: binding.commitSha, treeSha: binding.treeSha, executableDigests: binding.executableDigests }), "utf8"));
}
function validVisualReceipt(value, expected) {
  const keys = ["schemaVersion", "kind", "claim", "domainSeparator", "verifierKeyId", "releaseId", "certificationId", "gitSha", "verifiedAt", "expiresAt", "verificationNonce", "channelId", "runNonce", "channelSha256", "issuerBinding", "ledgerSha256", "bundleSha256", "actualArtifactHashes", "authReceiptSha256"];
  if (!exactKeys(value, [...keys, "receiptSha256", "verifierSignature"]) || value.schemaVersion !== 3 || value.kind !== "release-visual-verification-v3" || value.claim !== "G009-release-visual-evidence-v1" || value.domainSeparator !== G009_VERIFICATION_DOMAIN.trim() || value.verifierKeyId !== G009_VERIFIER_KEY_ID || value.releaseId !== expected.releaseId || value.certificationId !== expected.certificationId || value.gitSha !== expected.mainSha || !Number.isSafeInteger(value.verifiedAt) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt - value.verifiedAt !== 300 || value.verifiedAt < expected.observedAt || value.verifiedAt > expected.now + 60 || expected.now > value.expiresAt || !base64url32(value.verificationNonce) || !base64url32(value.runNonce) || value.verificationNonce === value.runNonce || !/^[A-Za-z0-9_-]{16,64}$/.test(value.channelId || "") || !sha(value.channelSha256) || !sha(value.ledgerSha256) || value.bundleSha256 !== expected.visualBundleSha256 || !sha(value.bundleSha256) || value.receiptSha256 !== expected.visualDomainReceiptSha256 || !sha(value.receiptSha256) || typeof value.verifierSignature !== "string" || !/^[A-Za-z0-9_-]{64,256}$/.test(value.verifierSignature) || !validIssuerBinding(value.issuerBinding, expected) || !exactKeys(value.authReceiptSha256, G009_AUTH_CELL_IDS) || !exactKeys(value.actualArtifactHashes, G009_SCREENSHOT_ARTIFACTS) || Object.values(value.authReceiptSha256).some((digest) => !sha(digest)) || Object.values(value.actualArtifactHashes).some((digest) => !sha(digest))) return false;
  if (!Object.entries(expected.authDomainReceiptSha256).every(([id, digest]) => value.authReceiptSha256[id] === digest) || new Set(Object.values(value.authReceiptSha256)).size !== 3 || new Set(Object.values(value.actualArtifactHashes)).size !== 9) return false;
  const body = Object.fromEntries(keys.map((key) => [key, value[key]]));
  const receiptSha256 = sha256(Buffer.from(`${G009_VERIFICATION_DOMAIN}${canonicalJson(body)}`, "utf8"));
  if (receiptSha256 !== value.receiptSha256) return false;
  try {
    return verify(null, Buffer.from(`${G009_VERIFICATION_DOMAIN}${canonicalJson({ ...body, receiptSha256 })}`, "utf8"), expected.visualVerifierPublicKey ?? G009_VERIFIER_PUBLIC_KEY, Buffer.from(value.verifierSignature, "base64url"));
  } catch {
    return false;
  }
}
function checkoutIssuerBinding(binding, expected) {
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return validIssuerBinding(binding, expected) && G009_ISSUER_PATHS.every((name) => { try { return sha256(fs.readFileSync(path.join(project, name))) === binding.executableDigests[name]; } catch { return false; } });
}
function validVisualBundle(bundle, receipt, expected) {
  const keys = ["schemaVersion", "kind", "claim", "releaseId", "certificationId", "gitSha", "channelId", "runNonce", "channelSha256", "issuerBinding", "ledgerSha256", "actualArtifactHashes", "authReceiptSha256"];
  return exactKeys(bundle, keys) && bundle.schemaVersion === 3 && bundle.kind === "release-visual-bundle-v3" && bundle.claim === "G009-release-visual-bundle-v1" && bundle.releaseId === expected.releaseId && ["releaseId", "certificationId", "gitSha", "channelId", "runNonce", "channelSha256", "ledgerSha256"].every((key) => bundle[key] === receipt[key]) && canonicalJson(bundle.issuerBinding) === canonicalJson(receipt.issuerBinding) && canonicalJson(bundle.actualArtifactHashes) === canonicalJson(receipt.actualArtifactHashes) && canonicalJson(bundle.authReceiptSha256) === canonicalJson(receipt.authReceiptSha256);
}
function validVisualLedger(ledger, bundle) {
  const captureIds = G009_CELLS.filter((cell) => cell[2] === "screenshot").map((cell) => cell[0]);
  if (!exactKeys(ledger, ["captureReceipts", "cells", "files", "schemaVersion", "templateSha256"]) || ledger.schemaVersion !== 5 || ledger.templateSha256 !== G009_TEMPLATE_SHA256 || !Array.isArray(ledger.cells) || ledger.cells.length !== 12 || !exactKeys(ledger.files, G009_SCREENSHOT_ARTIFACTS) || !exactKeys(ledger.captureReceipts, captureIds)) return false;
  return ledger.cells.every((cell, index) => { const [id, execution, evidence, artifact] = G009_CELLS[index]; return exactKeys(cell, ["id", "status", "execution", "evidence", "artifact", "sha256", "captureReceiptSha256", "metadata"]) && cell.id === id && cell.status === "required" && cell.execution === execution && cell.evidence === evidence && cell.artifact === artifact && (evidence === "screenshot" ? sha(cell.sha256) && sha(cell.captureReceiptSha256) && ledger.files[artifact] === cell.sha256 && bundle.actualArtifactHashes[artifact] === cell.sha256 && ledger.captureReceipts[id] && typeof ledger.captureReceipts[id] === "object" && !Array.isArray(ledger.captureReceipts[id]) : cell.sha256 === "metadata-only" && cell.captureReceiptSha256 === "metadata-only"); });
}

export function validateComponent(kind, bytes, expected) {
  let value;
  try { value = parseJson(bytes, "COMPONENT_SCHEMA_INVALID", kind === "visualReceipt" || kind === "backlog"); } catch { return false; }
  if (kind === "visualReceipt") return validVisualReceipt(value, expected);
  if (kind in authCell) return validAuth(kind, value, expected);
  if (kind === "backlog") return validBacklog(value, expected);
  return false;
}
export function validateDeploymentReceipt(value, expected) {
  const keys = ["schemaVersion", "releaseId", "certificationId", "project", "projectId", "orgId", "teamSlug", "framework", "environment", "deploymentId", "gitSha", "host", "aliasHost", "observedAt", "expiresAt"];
  const domainDigest = sha256(Buffer.from(`tzudong:deployment-receipt:v2\n${canonicalJson(value)}`, "utf8"));
  return exactKeys(value, keys) && value.schemaVersion === 2 && value.releaseId === expected.releaseId && value.certificationId === expected.certificationId && value.project === "tzudong" && value.projectId === "prj_sau35J5uUtShIQ9OKofRtOVVnTSl" && value.orgId === "team_OUj64KeLxJI3PkEbOaFZnorA" && value.teamSlug === "twoimos-projects" && value.framework === "nextjs" && value.environment === expected.environment && deploymentId(value.deploymentId) && value.deploymentId === expected.deploymentId && value.gitSha === expected.mainSha && value.host === expected.host && value.aliasHost === expected.aliasHost && Number.isSafeInteger(value.observedAt) && Number.isSafeInteger(value.expiresAt) && value.expiresAt - value.observedAt >= 1 && value.expiresAt - value.observedAt <= 900 && domainDigest === expected.domainHash;
}
export function validateFreshness(timestamps, now = Math.floor(Date.now() / 1000), skew = 60) {
  const values = Object.values(timestamps);
  return values.every(Number.isSafeInteger) && timestamps.observedAt - skew <= timestamps.issuedAt && timestamps.issuedAt <= timestamps.capturedAt && timestamps.capturedAt <= timestamps.verifiedAt && timestamps.verifiedAt <= timestamps.expiresAt && now <= timestamps.expiresAt && now + skew >= timestamps.observedAt;
}
export function validateReleaseManifest(manifest, expected) {
  if (
    !exactKeys(manifest, [
      "schemaVersion",
      "releaseId",
      "mainSha",
      "releaseTree",
      "inputs",
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.releaseId !== expected.releaseId ||
    manifest.mainSha !== expected.mainSha ||
    manifest.releaseTree !== expected.releaseTree ||
    !exactKeys(manifest.inputs, manifestInputKeys) ||
    Object.values(manifest.inputs).some((value) => typeof value !== "string")
  ) {
    fail("INPUT_GRAMMAR_INVALID");
  }
  return { ...manifest.inputs };
}

async function strictFinalizerJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new Error("body too large");
    }
    chunks.push(value);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  duplicateFreeJson(text);
  return JSON.parse(text);
}

const finalOutputEnvelope = (e) => {
  const expiresAt = Number(e.EXPIRES_AT);
  const immutableHost = e.IMMUTABLE_HOST || "";
  const finalDeploymentId = e.PRODUCTION_DEPLOYMENT_ID || "";
  const outputsValid = releaseId(e.RELEASE_ID) && gitId(e.DISPATCH_SHA) && gitId(e.RELEASE_TREE) && sha(e.RECEIPT_SHA256) && sha(e.BUNDLE_SHA256) && deploymentId(finalDeploymentId) && /^tzudong-[a-z0-9-]+\.vercel\.app$/.test(immutableHost) && Number.isSafeInteger(expiresAt);
  const terminalAuthenticated = e.VERIFY_JOB_RESULT === "success" && e.UPLOAD_OUTCOME === "success" && e.INITIAL_OUTCOME === "success" && e.INITIAL_REASON === "VERIFIED" && e.TERMINAL_OUTCOME === "success" && e.TERMINAL_REASON === "VERIFIED";
  return { expiresAt, immutableHost, finalDeploymentId, outputsValid, terminalAuthenticated };
};

export async function verifyProtectedFinalHealth({
  env,
  fetch = globalThis.fetch,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const e = { ...env };
  const safeReason = [e.INITIAL_REASON, e.TERMINAL_REASON].find((value) => failureCodes.has(value) && value !== "VERIFIED");
  const { expiresAt, immutableHost, finalDeploymentId, outputsValid, terminalAuthenticated } = finalOutputEnvelope(e);
  if (safeReason) return { passed: false, reason: safeReason };
  if (!terminalAuthenticated || !outputsValid) return { passed: false, reason: "UNKNOWN_VALIDATION_FAILURE" };
  if (now() > expiresAt) return { passed: false, reason: "FRESHNESS_MISMATCH" };
  const protectionBypassSecret = e.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (typeof protectionBypassSecret !== "string" || protectionBypassSecret.length < 16 || protectionBypassSecret.length > 512 || !/^[\x21-\x7e]+$/.test(protectionBypassSecret)) return { passed: false, reason: "HTTPS_HEALTH_MISMATCH" };
  const trustedHosts = [immutableHost, "tzudong.app", "www.tzudong.app"];
  const expectedIdentity = { ok: true, service: "tzudong-web", releaseId: e.RELEASE_ID, gitSha: e.DISPATCH_SHA, deploymentId: finalDeploymentId, projectId: "prj_sau35J5uUtShIQ9OKofRtOVVnTSl" };
  try {
    for (const host of trustedHosts) {
      const response = await fetch(`https://${host}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { accept: "application/json", "x-vercel-protection-bypass": protectionBypassSecret } });
      if (response.status !== 200 || response.headers.get("location") || !String(response.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return { passed: false, reason: "HTTPS_IDENTITY_MISMATCH" };
      const body = await strictFinalizerJson(response);
      if (Object.keys(body).sort().join(",") !== "deploymentId,gitSha,host,ok,projectId,releaseId,service" || !Object.entries(expectedIdentity).every(([key, value]) => body[key] === value) || body.host !== host) return { passed: false, reason: "HTTPS_IDENTITY_MISMATCH" };
    }
  } catch {
    return { passed: false, reason: "HTTPS_IDENTITY_MISMATCH" };
  }
  const finalNow = now();
  return { passed: finalNow <= expiresAt, reason: finalNow <= expiresAt ? "VERIFIED" : "FRESHNESS_MISMATCH" };
}

export async function verifyFinalReceiptCheck({
  env,
  github,
  context,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const e = { ...env };
  const safeReason = [e.INITIAL_REASON, e.TERMINAL_REASON].find((value) => failureCodes.has(value) && value !== "VERIFIED");
  const { expiresAt, outputsValid, terminalAuthenticated } = finalOutputEnvelope(e);
  const protectedLiveReason = failureCodes.has(e.PROTECTED_LIVE_REASON) ? e.PROTECTED_LIVE_REASON : "UNKNOWN_VALIDATION_FAILURE";
  const protectedLiveAuthenticated = e.PROTECTED_LIVE_OUTCOME === "success" && protectedLiveReason === "VERIFIED";
  const identity = `${e.RELEASE_ID || "unverified"}:${e.RECEIPT_SHA256 || "none"}:${e.BUNDLE_SHA256 || "none"}`;
  const check = await github.rest.checks.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    name: "TS7 Release Evidence / Final Receipt",
    head_sha: e.DISPATCH_SHA,
    external_id: identity,
    details_url: e.RUN_URL,
    status: "in_progress",
    output: { title: "Release evidence validation in progress", summary: "RELEASE_EVIDENCE_IN_PROGRESS" },
  });
  let passed = false;
  let reason = "UNKNOWN_VALIDATION_FAILURE";
  try {
    if (safeReason) {
      reason = safeReason;
    } else if (!terminalAuthenticated || !outputsValid) {
      reason = "UNKNOWN_VALIDATION_FAILURE";
    } else if (!protectedLiveAuthenticated) {
      reason = protectedLiveReason;
    } else {
      const readRef = async (branch) => {
        const branchResult = await github.rest.repos.getBranch({ owner: context.repo.owner, repo: context.repo.repo, branch });
        const commit = await github.rest.repos.getCommit({ owner: context.repo.owner, repo: context.repo.repo, ref: branchResult.data.commit.sha });
        return { sha: branchResult.data.commit.sha, tree: commit.data.commit.tree.sha };
      };
      const refsMatch = async () => {
        const refs = await Promise.all(["main", "develop", "data"].map(readRef));
        return refs.every(({ tree }) => tree === e.RELEASE_TREE) && refs[0].sha === e.DISPATCH_SHA;
      };
      const freshAndExact = now() <= expiresAt && await refsMatch() && now() <= expiresAt;
      passed = freshAndExact;
      reason = freshAndExact ? "VERIFIED" : now() > expiresAt ? "FRESHNESS_MISMATCH" : "TARGET_TREE_MISMATCH";
    }
  } catch (error) {
    reason = failureCodes.has(error?.code) ? error.code : "UNKNOWN_VALIDATION_FAILURE";
  }
  await github.rest.checks.update({
    owner: context.repo.owner,
    repo: context.repo.repo,
    check_run_id: check.data.id,
    status: "completed",
    conclusion: passed ? "success" : "action_required",
    output: {
      title: passed ? "Exact-head public release evidence verified" : "Release evidence requires action",
      summary: `RELEASE_EVIDENCE_${reason}\nrelease=${e.RELEASE_ID || "unverified"}\nreceipt=${e.RECEIPT_SHA256 || "none"}\nbundle=${e.BUNDLE_SHA256 || "none"}`,
    },
  });
  return { passed, reason };
}
export async function verifyFinalReleaseEvidence({
  env,
  clock = () => Math.floor(Date.now() / 1000),
  gitAdapter = git,
  fetch = fetchEvidence,
  transitionSecret = env?.TS7_TRANSITION_HMAC,
  transitionJournalRoot = env?.TS7_TRANSITION_JOURNAL_ROOT,
  visualVerifierPublicKey = G009_VERIFIER_PUBLIC_KEY,
  workflowAtHead = (sha) => execFileSync("git", ["show", `${sha}:.github/workflows/ts7-release-evidence.yml`]),
  workflowBytes = () => fs.readFileSync(".github/workflows/ts7-release-evidence.yml"),
  output = (value) => fs.appendFileSync(env.GITHUB_OUTPUT, value),
  writeBundle = (path, bytes) => fs.writeFileSync(path, bytes, { mode: 0o600 }),
} = {}) {
  const e = { ...env };
  if (e.DISPATCH_REF !== "refs/heads/main" || e.WORKFLOW_REF !== `${e.REPOSITORY}/.github/workflows/ts7-release-evidence.yml@refs/heads/main` || !releaseId(e.RELEASE_ID) || !gitId(e.EXPECTED_SHA) || !gitId(e.EXPECTED_TREE) || !sha(e.MANIFEST_SHA256)) fail("DISPATCH_REF_INVALID");
  publicUrl(e.MANIFEST_URL, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, e.MANIFEST_SHA256);
  let manifestBytes; try { manifestBytes = await fetch(e.MANIFEST_URL); } catch { fail("RECEIPT_FETCH_FAILED"); }
  if (sha256(manifestBytes) !== e.MANIFEST_SHA256) fail("RECEIPT_HASH_MISMATCH");
  const manifest = parseJson(manifestBytes, "RECEIPT_JSON_INVALID", true);
  const manifestInputs = validateReleaseManifest(manifest, { releaseId: e.RELEASE_ID, mainSha: e.EXPECTED_SHA, releaseTree: e.EXPECTED_TREE });
  Object.assign(e, manifestInputs);
  const rawHashes = ["RECEIPT_SHA256", "PREVIEW_DEPLOYMENT_RECEIPT_SHA256", "PRODUCTION_DEPLOYMENT_RECEIPT_SHA256", "PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256", "KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256", "VISUAL_VERIFICATION_RECEIPT_SHA256", "STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256", "STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256", "STANDALONE_AUTH_ALIAS_RECEIPT_SHA256", "SCORED_BACKLOG_SHA256", "VISUAL_LEDGER_SHA256", "VISUAL_VERIFICATION_BUNDLE_SHA256"];
  const domainHashes = ["PREVIEW_DEPLOYMENT_DOMAIN_RECEIPT_SHA256", "PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256", "PRODUCTION_ALIAS_DEPLOYMENT_DOMAIN_RECEIPT_SHA256", "KNOWN_GOOD_DEPLOYMENT_DOMAIN_RECEIPT_SHA256", "VISUAL_DOMAIN_RECEIPT_SHA256", "STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256", "STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256", "STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256"];
  if (!deploymentId(e.PREVIEW_DEPLOYMENT_ID) || !deploymentId(e.PRODUCTION_DEPLOYMENT_ID) || !deploymentId(e.KNOWN_GOOD_DEPLOYMENT_ID) || new Set([e.PREVIEW_DEPLOYMENT_ID, e.PRODUCTION_DEPLOYMENT_ID, e.KNOWN_GOOD_DEPLOYMENT_ID]).size !== 3 || !gitId(e.KNOWN_GOOD_GIT_SHA) || e.KNOWN_GOOD_GIT_SHA === e.EXPECTED_SHA || !/^[1-9][0-9]*$/.test(e.GITHUB_DEPLOYMENT_ID || "") || !rawHashes.concat(domainHashes).every((name) => sha(e[name])) || !sha(e.VISUAL_CERTIFICATION_ID) || !event(e.PROMOTION_EVENT_ID) || !["normal", "rolled_back", "reconciled"].includes(e.ROLLBACK_STATE) || (e.ROLLBACK_STATE === "normal" && (e.ROLLBACK_EVENT_ID || e.REPROMOTION_EVENT_ID)) || (e.ROLLBACK_STATE === "rolled_back" && (!event(e.ROLLBACK_EVENT_ID) || e.REPROMOTION_EVENT_ID || e.ROLLBACK_EVENT_ID === e.PROMOTION_EVENT_ID)) || (e.ROLLBACK_STATE === "reconciled" && (!event(e.ROLLBACK_EVENT_ID) || !event(e.REPROMOTION_EVENT_ID) || new Set([e.PROMOTION_EVENT_ID, e.ROLLBACK_EVENT_ID, e.REPROMOTION_EVENT_ID]).size !== 3))) fail("INPUT_GRAMMAR_INVALID");
  if (new Set([e.STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256, e.STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256, e.STANDALONE_AUTH_ALIAS_RECEIPT_SHA256]).size !== 3 || new Set([e.STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256, e.STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256, e.STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256]).size !== 3 || e.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256 !== e.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256 || e.PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256 !== e.PRODUCTION_ALIAS_DEPLOYMENT_DOMAIN_RECEIPT_SHA256 || e.PRODUCTION_DEPLOYMENT_RECEIPT_URL !== e.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_URL) fail("INPUT_GRAMMAR_INVALID");
  const deployment = publicUrl(e.PRODUCTION_DEPLOYMENT_URL, [], false);
  if (deployment.pathname !== "/" || !/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(deployment.hostname) || !/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(e.PREVIEW_HOST || "") || !/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(e.KNOWN_GOOD_HOST || "") || new Set([e.PREVIEW_HOST, e.KNOWN_GOOD_HOST, deployment.hostname]).size !== 3 || ["tzudong.app", "www.tzudong.app"].includes(e.PREVIEW_HOST) || ["tzudong.app", "www.tzudong.app"].includes(e.KNOWN_GOOD_HOST)) fail("INPUT_GRAMMAR_INVALID");
  for (const [url, hash] of [[e.PREVIEW_DEPLOYMENT_RECEIPT_URL, e.PREVIEW_DEPLOYMENT_RECEIPT_SHA256], [e.PRODUCTION_DEPLOYMENT_RECEIPT_URL, e.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256], [e.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_URL, e.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256], [e.KNOWN_GOOD_DEPLOYMENT_RECEIPT_URL, e.KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256]]) publicUrl(url, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, hash);
  publicUrl(e.RECEIPT_URL, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, e.RECEIPT_SHA256);
  if (e.DISPATCH_SHA !== e.EXPECTED_SHA || gitAdapter("rev-parse", "HEAD") !== e.EXPECTED_SHA || gitAdapter("rev-parse", "HEAD^{tree}") !== e.EXPECTED_TREE) fail("CHECKOUT_IDENTITY_MISMATCH");
  gitAdapter("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/develop:refs/remotes/origin/develop", "+refs/heads/data:refs/remotes/origin/data");
  verifyRemoteRefs(e.EXPECTED_SHA, e.EXPECTED_TREE, gitAdapter);
  if (!Buffer.from(workflowAtHead(e.EXPECTED_SHA)).equals(Buffer.from(workflowBytes()))) fail("WORKFLOW_AT_HEAD_MISMATCH");
  let receiptBytes; try { receiptBytes = await fetch(e.RECEIPT_URL); } catch { fail("RECEIPT_FETCH_FAILED"); } if (sha256(receiptBytes) !== e.RECEIPT_SHA256) fail("RECEIPT_HASH_MISMATCH");
  const receipt = parseJson(receiptBytes, "RECEIPT_JSON_INVALID", true);
  const rootKeys = ["releaseId", "mainSha", "releaseTree", "productionDeploymentId", "githubDeploymentId", "productionDeploymentUrl", "knownGoodDeploymentId", "expectedRollbackState", "derivedRollbackState", "transitionJournalRoot", "vercel", "providerDeployments", "events", "previewDeploymentReceiptSha256", "productionDeploymentReceiptSha256", "productionAliasDeploymentReceiptSha256", "knownGoodDeploymentReceiptSha256", "visualVerificationReceiptSha256", "visualVerificationBundleSha256", "visualDomainReceiptSha256", "standaloneAuthPreviewReceiptSha256", "standaloneAuthPreviewDomainReceiptSha256", "standaloneAuthProductionReceiptSha256", "standaloneAuthProductionDomainReceiptSha256", "standaloneAuthAliasReceiptSha256", "standaloneAuthAliasDomainReceiptSha256", "scoredBacklogSha256", "evidence", "visualEvidence", "finalBundle"];
  if (!exactKeys(receipt, rootKeys)) fail("RECEIPT_IDENTITY_MISMATCH");
  if (receipt.releaseId !== e.RELEASE_ID || receipt.mainSha !== e.EXPECTED_SHA || receipt.releaseTree !== e.EXPECTED_TREE || receipt.productionDeploymentId !== e.PRODUCTION_DEPLOYMENT_ID || receipt.githubDeploymentId !== e.GITHUB_DEPLOYMENT_ID || receipt.productionDeploymentUrl !== e.PRODUCTION_DEPLOYMENT_URL || receipt.knownGoodDeploymentId !== e.KNOWN_GOOD_DEPLOYMENT_ID || receipt.expectedRollbackState !== e.ROLLBACK_STATE || receipt.derivedRollbackState !== e.ROLLBACK_STATE || !sha(receipt.transitionJournalRoot) || receipt.transitionJournalRoot !== transitionJournalRoot) fail("RECEIPT_IDENTITY_MISMATCH");
  const receiptSpecs = [
    ["preview", e.PREVIEW_DEPLOYMENT_RECEIPT_URL, e.PREVIEW_DEPLOYMENT_RECEIPT_SHA256, e.PREVIEW_DEPLOYMENT_DOMAIN_RECEIPT_SHA256, { environment: "preview", deploymentId: e.PREVIEW_DEPLOYMENT_ID, host: e.PREVIEW_HOST, aliasHost: e.PREVIEW_HOST }],
    ["production", e.PRODUCTION_DEPLOYMENT_RECEIPT_URL, e.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256, e.PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256, { environment: "production", deploymentId: e.PRODUCTION_DEPLOYMENT_ID, host: deployment.hostname, aliasHost: "tzudong.app" }],
    ["alias", e.PRODUCTION_DEPLOYMENT_RECEIPT_URL, e.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256, e.PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256, { environment: "production", deploymentId: e.PRODUCTION_DEPLOYMENT_ID, host: deployment.hostname, aliasHost: "tzudong.app" }],
    ["knownGood", e.KNOWN_GOOD_DEPLOYMENT_RECEIPT_URL, e.KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256, e.KNOWN_GOOD_DEPLOYMENT_DOMAIN_RECEIPT_SHA256, { environment: "production", deploymentId: e.KNOWN_GOOD_DEPLOYMENT_ID, host: e.KNOWN_GOOD_HOST, aliasHost: e.KNOWN_GOOD_HOST, mainSha: e.KNOWN_GOOD_GIT_SHA }],
  ];
  const deploymentReceipts = {};
  for (const [name, url, rawHash, domainHash, expected] of receiptSpecs) {
    let bytes; try { bytes = await fetch(url); } catch { fail("COMPONENT_FETCH_FAILED"); }
    if (sha256(bytes) !== rawHash) fail("COMPONENT_HASH_MISMATCH");
    const value = parseJson(bytes, "COMPONENT_SCHEMA_INVALID", true);
    deploymentReceipts[name] = value;
    if (!validateDeploymentReceipt(value, { ...expected, releaseId: e.RELEASE_ID, certificationId: e.VISUAL_CERTIFICATION_ID, mainSha: expected.mainSha ?? e.EXPECTED_SHA, domainHash })) fail("TUPLE_MISMATCH");
  }
  const now = clock();
  if (deploymentReceipts.preview.expiresAt !== deploymentReceipts.production.expiresAt || deploymentReceipts.knownGood.expiresAt !== deploymentReceipts.production.expiresAt || deploymentReceipts.production.host !== deploymentReceipts.alias.host || deploymentReceipts.production.deploymentId !== deploymentReceipts.alias.deploymentId || deploymentReceipts.production.aliasHost !== deploymentReceipts.alias.aliasHost || deploymentReceipts.production.observedAt !== deploymentReceipts.alias.observedAt || deploymentReceipts.production.expiresAt !== deploymentReceipts.alias.expiresAt || !Object.values(deploymentReceipts).every((record) => validateFreshness({ issuedAt: record.observedAt, observedAt: record.observedAt, capturedAt: record.observedAt, verifiedAt: record.observedAt, expiresAt: record.expiresAt }, now)) || receipt.previewDeploymentReceiptSha256 !== e.PREVIEW_DEPLOYMENT_RECEIPT_SHA256 || receipt.productionDeploymentReceiptSha256 !== e.PRODUCTION_DEPLOYMENT_RECEIPT_SHA256 || receipt.productionAliasDeploymentReceiptSha256 !== e.PRODUCTION_ALIAS_DEPLOYMENT_RECEIPT_SHA256 || receipt.knownGoodDeploymentReceiptSha256 !== e.KNOWN_GOOD_DEPLOYMENT_RECEIPT_SHA256) fail("FRESHNESS_MISMATCH");
  const tuple = receipt.vercel; if (!exactKeys(tuple, ["project", "projectId", "orgId", "teamSlug", "rootDirectory", "framework", "nodeVersion", "npmVersion", "branch", "environment", "deploymentId", "knownGoodDeploymentId", "gitSha", "url", "immutableHost", "productionAliases", "health", "knownGoodEligible", "observedAt", "expiresAt", "rollbackState", "automaticProductionDomainAssignment"]) || tuple.project !== "tzudong" || tuple.projectId !== "prj_sau35J5uUtShIQ9OKofRtOVVnTSl" || tuple.orgId !== "team_OUj64KeLxJI3PkEbOaFZnorA" || tuple.teamSlug !== "twoimos-projects" || tuple.rootDirectory !== "apps/web" || tuple.framework !== "nextjs" || tuple.nodeVersion !== "24.x" || tuple.npmVersion !== "11.6.2" || tuple.branch !== "main" || tuple.environment !== "production" || tuple.deploymentId !== e.PRODUCTION_DEPLOYMENT_ID || tuple.knownGoodDeploymentId !== e.KNOWN_GOOD_DEPLOYMENT_ID || tuple.gitSha !== e.EXPECTED_SHA || tuple.url !== e.PRODUCTION_DEPLOYMENT_URL || tuple.immutableHost !== deployment.hostname || !Array.isArray(tuple.productionAliases) || tuple.productionAliases.length !== 2 || !["tzudong.app", "www.tzudong.app"].every((host) => tuple.productionAliases.includes(host)) || tuple.health !== "healthy" || tuple.knownGoodEligible !== true || tuple.observedAt !== deploymentReceipts.production.observedAt || tuple.expiresAt !== deploymentReceipts.production.expiresAt || tuple.rollbackState !== e.ROLLBACK_STATE || tuple.automaticProductionDomainAssignment !== "normal") fail("TUPLE_MISMATCH");
  const eventKeys = ["kind", "id", "releaseId", "sequence", "previousDigest", "projectId", "orgId", "fromDeploymentId", "toDeploymentId", "gitSha", "aliases", "observedAt", "signature"];
  const validEventShape = (row, kind, id, fromDeploymentId, toDeploymentId, gitSha) =>
    exactKeys(row, eventKeys) &&
    row.kind === kind &&
    row.id === id &&
    row.releaseId === e.RELEASE_ID &&
    Number.isSafeInteger(row.sequence) && row.sequence > 0 &&
    sha(row.previousDigest) &&
    row.projectId === "prj_sau35J5uUtShIQ9OKofRtOVVnTSl" &&
    row.orgId === "team_OUj64KeLxJI3PkEbOaFZnorA" &&
    row.fromDeploymentId === fromDeploymentId &&
    row.toDeploymentId === toDeploymentId &&
    row.gitSha === gitSha &&
    Array.isArray(row.aliases) &&
    row.aliases.length === 2 &&
    ["tzudong.app", "www.tzudong.app"].every((host) => row.aliases.includes(host)) &&
    Number.isSafeInteger(row.observedAt) &&
    row.observedAt >= deploymentReceipts.production.observedAt &&
    row.observedAt <= deploymentReceipts.production.expiresAt &&
    row.observedAt <= now + 60;
  const validEventSignature = (row) => {
    if (typeof transitionSecret !== "string" || transitionSecret.length < 32 || typeof row?.signature !== "string" || !sha(row.signature)) return false;
    const unsigned = { ...row };
    delete unsigned.signature;
    const expectedSignature = createHmac("sha256", transitionSecret)
      .update("tzudong:release-transition:v2\n", "utf8")
      .update(canonicalJson(unsigned), "utf8")
      .digest("hex");
    return timingSafeEqual(Buffer.from(row.signature, "hex"), Buffer.from(expectedSignature, "hex"));
  };
  const promotionEvents = Array.isArray(receipt.events) ? receipt.events.filter((row) => row.kind === "promotion") : [];
  const rollbackEvent = Array.isArray(receipt.events) ? receipt.events.find((row) => row.kind === "rollback") : null;
  const terminalEvent = e.ROLLBACK_STATE === "reconciled" ? promotionEvents[1] : e.ROLLBACK_STATE === "rolled_back" ? rollbackEvent : promotionEvents[0];
  const expectedEventCount = e.ROLLBACK_STATE === "reconciled" ? 3 : e.ROLLBACK_STATE === "rolled_back" ? 2 : 1;
  if (!Array.isArray(receipt.events) || receipt.events.length !== expectedEventCount || promotionEvents.length !== (e.ROLLBACK_STATE === "reconciled" ? 2 : 1) || !validEventShape(promotionEvents[0], "promotion", e.PROMOTION_EVENT_ID, e.KNOWN_GOOD_DEPLOYMENT_ID, e.PRODUCTION_DEPLOYMENT_ID, e.EXPECTED_SHA) || (e.ROLLBACK_STATE !== "normal" && !validEventShape(rollbackEvent, "rollback", e.ROLLBACK_EVENT_ID, e.PRODUCTION_DEPLOYMENT_ID, e.KNOWN_GOOD_DEPLOYMENT_ID, e.KNOWN_GOOD_GIT_SHA)) || (e.ROLLBACK_STATE === "reconciled" && (!validEventShape(promotionEvents[1], "promotion", e.REPROMOTION_EVENT_ID, e.KNOWN_GOOD_DEPLOYMENT_ID, e.PRODUCTION_DEPLOYMENT_ID, e.EXPECTED_SHA) || !(promotionEvents[0].observedAt < rollbackEvent.observedAt && rollbackEvent.observedAt < promotionEvents[1].observedAt))) || (e.ROLLBACK_STATE === "rolled_back" && !(promotionEvents[0].observedAt < rollbackEvent.observedAt))) fail("ROLLBACK_EVENT_MISMATCH");
  if (!receipt.events.every(validEventSignature) || receipt.events.some((row, index) => row.sequence !== index + 1 || row.previousDigest !== (index ? sha256(Buffer.from(canonicalJson(receipt.events[index - 1]), "utf8")) : sha256(Buffer.from(`tzudong:release-transition:genesis:v1\n${e.RELEASE_ID}`, "utf8")))) || receipt.transitionJournalRoot !== sha256(Buffer.from(`tzudong:release-transition-journal:v1\n${canonicalJson(receipt.events)}`, "utf8"))) fail("TRANSITION_JOURNAL_MISMATCH");
  const authDomainReceiptSha256 = { "preview-admin-auth-smoke-metadata": e.STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256, "production-admin-auth-smoke-metadata": e.STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256, "alias-admin-auth-smoke-metadata": e.STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256 };
  const common = { releaseId: e.RELEASE_ID, mainSha: e.EXPECTED_SHA, releaseTree: e.EXPECTED_TREE, productionDeploymentId: e.PRODUCTION_DEPLOYMENT_ID, certificationId: e.VISUAL_CERTIFICATION_ID, now, visualVerifierPublicKey };
  const authExpected = (name, domainReceiptSha256) => { const record = deploymentReceipts[name === "alias" ? "production" : name]; return { ...common, domainReceiptSha256, deploymentReceiptSha256: name === "preview" ? e.PREVIEW_DEPLOYMENT_DOMAIN_RECEIPT_SHA256 : e.PRODUCTION_DEPLOYMENT_DOMAIN_RECEIPT_SHA256, deploymentId: record.deploymentId, deploymentEnvironment: record.environment, host: record.host, aliasHost: name === "alias" ? "tzudong.app" : record.aliasHost, observedAt: record.observedAt, origin: `https://${name === "alias" ? "tzudong.app" : record.host}`, expiresAt: record.expiresAt }; };
  const components = [{ kind: "visualReceipt", url: e.VISUAL_VERIFICATION_RECEIPT_URL, hash: e.VISUAL_VERIFICATION_RECEIPT_SHA256, expected: { ...common, observedAt: deploymentReceipts.production.observedAt, expiresAt: deploymentReceipts.production.expiresAt, visualBundleSha256: e.VISUAL_VERIFICATION_BUNDLE_SHA256, visualDomainReceiptSha256: e.VISUAL_DOMAIN_RECEIPT_SHA256, authDomainReceiptSha256 } }, { kind: "authPreview", url: e.STANDALONE_AUTH_PREVIEW_RECEIPT_URL, hash: e.STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256, expected: authExpected("preview", e.STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256) }, { kind: "authProduction", url: e.STANDALONE_AUTH_PRODUCTION_RECEIPT_URL, hash: e.STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256, expected: authExpected("production", e.STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256) }, { kind: "authAlias", url: e.STANDALONE_AUTH_ALIAS_RECEIPT_URL, hash: e.STANDALONE_AUTH_ALIAS_RECEIPT_SHA256, expected: authExpected("alias", e.STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256) }, { kind: "backlog", url: e.SCORED_BACKLOG_URL, hash: e.SCORED_BACKLOG_SHA256, expected: common }];
  const authChallenges = new Set();
  const componentValues = {};
  for (const component of components) {
    if (!sha(component.hash)) fail("INPUT_GRAMMAR_INVALID");
    publicUrl(component.url, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, component.hash);
    let bytes;
    try { bytes = await fetch(component.url); } catch { fail("COMPONENT_FETCH_FAILED"); }
    if (sha256(bytes) !== component.hash) fail("COMPONENT_HASH_MISMATCH");
    if (!validateComponent(component.kind, bytes, component.expected)) fail("COMPONENT_SCHEMA_INVALID");
    componentValues[component.kind] = parseJson(bytes, "COMPONENT_SCHEMA_INVALID", component.kind === "visualReceipt" || component.kind === "backlog");
    if (component.kind in authCell) {
      const challenge = componentValues[component.kind].metadata.payload.release.challenge;
      if (authChallenges.has(challenge)) fail("COMPONENT_SCHEMA_INVALID");
      authChallenges.add(challenge);
    }
  }
  const revocationEndpoint = e.SUPABASE_REVOCATION_RPC_URL;
  const revocationCapability = e.SUPABASE_REVOCATION_READ_CAPABILITY;
  const revocationGatewayKey = e.SUPABASE_REVOCATION_PUBLISHABLE_GATEWAY_KEY;
  if (revocationEndpoint !== "https://aqlcofblfxdrjhhdmarw.supabase.co/rest/v1/rpc/read_release_auth_revocation_by_operation" || typeof revocationCapability !== "string" || revocationCapability.length < 32 || !/^[A-Za-z0-9._~-]+$/.test(revocationCapability) || !publishableGatewayKey(revocationGatewayKey, revocationCapability)) fail("AUTH_REVOCATION_MISMATCH");
  const authReleases = ["authPreview", "authProduction", "authAlias"].map((kind) => componentValues[kind].metadata.payload.release);
  const authCapturedAt = ["authPreview", "authProduction", "authAlias"].map((kind) => componentValues[kind].metadata.payload.result.capturedAt);
  const authResults = ["authPreview", "authProduction", "authAlias"].map((kind) => componentValues[kind].metadata.payload.result);
  if (new Set(authResults.map((result) => result.revocationOperationId)).size !== 3 || new Set(authResults.map((result) => result.authProofSha256)).size !== 3 || new Set(authResults.map((result) => result.revocationBindingSha256)).size !== 3 || authReleases.some((release) => release.issuedAt !== authReleases[0].issuedAt || release.expiresAt !== authReleases[0].expiresAt) || !authReleases.every((release, index) => deploymentReceipts[["preview", "production", "production"][index]].observedAt - 60 <= release.issuedAt && release.issuedAt <= authCapturedAt[index])) fail("AUTH_REVOCATION_MISMATCH");
  for (const kind of ["authPreview", "authProduction", "authAlias"]) {
    const auth = componentValues[kind], result = auth.metadata.payload.result;
    const body = Buffer.from(canonicalJson({ p_operation_id: result.revocationOperationId }), "utf8");
    let bytes;
    try { bytes = await fetch(revocationEndpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", apikey: revocationGatewayKey, authorization: `Bearer ${revocationCapability}`, "content-length": String(body.length) }, body, maxBytes: 16384 }); } catch { fail("AUTH_REVOCATION_MISMATCH"); }
    const readback = parseJson(bytes, "AUTH_REVOCATION_MISMATCH");
    const revokedAt = Date.parse(readback.revokedAt);
    if (!exactKeys(readback, ["schemaVersion", "operationId", "bindingSha256", "status", "refreshTokensDeleted", "sessionsDeleted", "sessionAbsent", "refreshTokensAbsent", "revokedAt"]) || readback.schemaVersion !== 1 || readback.operationId !== result.revocationOperationId || readback.bindingSha256 !== result.revocationBindingSha256 || readback.status !== "revoked_verified" || !Number.isSafeInteger(readback.refreshTokensDeleted) || readback.refreshTokensDeleted < 0 || readback.sessionsDeleted !== 1 || readback.sessionAbsent !== true || readback.refreshTokensAbsent !== true || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(readback.revokedAt || "") || !Number.isSafeInteger(revokedAt) || new Date(readback.revokedAt).toISOString() !== readback.revokedAt || result.capturedAt * 1000 > revokedAt || revokedAt > auth.metadata.payload.release.expiresAt * 1000 || revokedAt > (now + 60) * 1000 || result.revocationReceipt !== sha256(Buffer.from(`tzudong:release-auth-revocation:v1\n${canonicalJson(readback)}`, "utf8"))) fail("AUTH_REVOCATION_MISMATCH");
  }
  const candidateEvidenceEvent = promotionEvents[0];
  const candidateEvidenceFresh = authCapturedAt.every((capturedAt) => capturedAt >= candidateEvidenceEvent.observedAt) && componentValues.visualReceipt.verifiedAt >= candidateEvidenceEvent.observedAt;
  const stateEvidenceFresh = e.ROLLBACK_STATE === "rolled_back"
    ? authCapturedAt.every((capturedAt) => capturedAt <= terminalEvent.observedAt) && componentValues.visualReceipt.verifiedAt <= terminalEvent.observedAt
    : authCapturedAt.every((capturedAt) => capturedAt >= terminalEvent.observedAt) && componentValues.visualReceipt.verifiedAt >= terminalEvent.observedAt;
  if (componentValues.visualReceipt.verifiedAt < Math.max(...authCapturedAt) || componentValues.visualReceipt.verifiedAt > authReleases[0].expiresAt || now > authReleases[0].expiresAt || !candidateEvidenceFresh || !stateEvidenceFresh) fail("FRESHNESS_MISMATCH");
  const terminalEvidenceExpiresAt = Math.min(
    ...Object.values(deploymentReceipts).map((record) => record.expiresAt),
    ...authReleases.map((release) => release.expiresAt),
    componentValues.visualReceipt.expiresAt,
  );
  if (!Number.isSafeInteger(terminalEvidenceExpiresAt) || now > terminalEvidenceExpiresAt) fail("FRESHNESS_MISMATCH");
  const detached = { visualVerificationReceiptSha256: e.VISUAL_VERIFICATION_RECEIPT_SHA256, visualVerificationBundleSha256: e.VISUAL_VERIFICATION_BUNDLE_SHA256, visualDomainReceiptSha256: e.VISUAL_DOMAIN_RECEIPT_SHA256, standaloneAuthPreviewReceiptSha256: e.STANDALONE_AUTH_PREVIEW_RECEIPT_SHA256, standaloneAuthPreviewDomainReceiptSha256: e.STANDALONE_AUTH_PREVIEW_DOMAIN_RECEIPT_SHA256, standaloneAuthProductionReceiptSha256: e.STANDALONE_AUTH_PRODUCTION_RECEIPT_SHA256, standaloneAuthProductionDomainReceiptSha256: e.STANDALONE_AUTH_PRODUCTION_DOMAIN_RECEIPT_SHA256, standaloneAuthAliasReceiptSha256: e.STANDALONE_AUTH_ALIAS_RECEIPT_SHA256, standaloneAuthAliasDomainReceiptSha256: e.STANDALONE_AUTH_ALIAS_DOMAIN_RECEIPT_SHA256, scoredBacklogSha256: e.SCORED_BACKLOG_SHA256 };
  if (!Object.entries(detached).every(([key, value]) => receipt[key] === value)) fail("COMPONENT_SCHEMA_INVALID");
  const visualEvidence = receipt.visualEvidence;
  if (!exactKeys(visualEvidence, ["ledger", "bundle"]) || !["ledger", "bundle"].every((kind) => exactKeys(visualEvidence[kind], ["url", "sha256"]) && sha(visualEvidence[kind].sha256)) || visualEvidence.ledger.url !== e.VISUAL_LEDGER_URL || visualEvidence.bundle.url !== e.VISUAL_VERIFICATION_BUNDLE_URL || visualEvidence.ledger.sha256 !== e.VISUAL_LEDGER_SHA256 || visualEvidence.bundle.sha256 !== e.VISUAL_VERIFICATION_BUNDLE_SHA256) fail("VISUAL_LEDGER_MISMATCH");
  publicUrl(visualEvidence.ledger.url, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, visualEvidence.ledger.sha256);
  publicUrl(visualEvidence.bundle.url, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, visualEvidence.bundle.sha256);
  let visualLedgerBytes;
  let visualBundleBytes;
  try {
    [visualLedgerBytes, visualBundleBytes] = await Promise.all([
      fetch(visualEvidence.ledger.url),
      fetch(visualEvidence.bundle.url),
    ]);
  } catch {
    fail("VISUAL_LEDGER_MISMATCH");
  }
  if (sha256(visualLedgerBytes) !== visualEvidence.ledger.sha256 || sha256(visualBundleBytes) !== visualEvidence.bundle.sha256) fail("VISUAL_LEDGER_MISMATCH");
  const visualLedger = parseJson(visualLedgerBytes, "VISUAL_LEDGER_MISMATCH", true);
  const visualBundle = parseJson(visualBundleBytes, "VISUAL_LEDGER_MISMATCH", true);
  const visualReceipt = componentValues.visualReceipt;
  if (!checkoutIssuerBinding(visualReceipt.issuerBinding, common) || visualReceipt.ledgerSha256 !== e.VISUAL_LEDGER_SHA256 || visualReceipt.bundleSha256 !== e.VISUAL_VERIFICATION_BUNDLE_SHA256 || !validVisualBundle(visualBundle, visualReceipt, common) || !validVisualLedger(visualLedger, visualBundle)) fail("VISUAL_LEDGER_MISMATCH");
  const provider = receipt.providerDeployments;
  const providerKeys = ["preview", "production", "knownGood"];
  if (!exactKeys(provider, providerKeys) || providerKeys.some((name) => !exactKeys(provider[name], ["githubDeploymentId", "statusId", "vercelDeploymentId"]) || !/^[1-9][0-9]*$/.test(String(provider[name].githubDeploymentId)) || !/^[1-9][0-9]*$/.test(String(provider[name].statusId)) || !deploymentId(provider[name].vercelDeploymentId)) || provider.production.githubDeploymentId !== e.GITHUB_DEPLOYMENT_ID || provider.preview.vercelDeploymentId !== e.PREVIEW_DEPLOYMENT_ID || provider.production.vercelDeploymentId !== e.PRODUCTION_DEPLOYMENT_ID || provider.knownGood.vercelDeploymentId !== e.KNOWN_GOOD_DEPLOYMENT_ID || new Set(providerKeys.map((name) => String(provider[name].githubDeploymentId))).size !== 3 || new Set(providerKeys.map((name) => String(provider[name].statusId))).size !== 3) fail("RECEIPT_IDENTITY_MISMATCH");
  const providerExpected = {
    preview: { gitSha: e.EXPECTED_SHA, environment: "Preview", url: `https://${e.PREVIEW_HOST}` },
    production: { gitSha: e.EXPECTED_SHA, environment: "Production", url: e.PRODUCTION_DEPLOYMENT_URL },
    knownGood: { gitSha: e.KNOWN_GOOD_GIT_SHA, environment: "Production", url: `https://${e.KNOWN_GOOD_HOST}` },
  };
  const liveProviderName = e.ROLLBACK_STATE === "rolled_back" ? "knownGood" : "production";
  const liveProvider = providerExpected[liveProviderName];
  const expectedHealthHosts = [liveProvider.url.slice(8), "tzudong.app", "www.tzudong.app"];
  const vercelTeamId = "team_OUj64KeLxJI3PkEbOaFZnorA";
  const vercelProjectId = "prj_sau35J5uUtShIQ9OKofRtOVVnTSl";
  const productionAliases = ["tzudong.app", "www.tzudong.app"];
  const expectedUrls = {
    vercel_project: `https://api.vercel.com/v9/projects/${vercelProjectId}?teamId=${vercelTeamId}`,
    ...Object.fromEntries(productionAliases.map((host) => [`vercel_alias:${host}`, `https://api.vercel.com/v4/aliases/${host}?teamId=${vercelTeamId}`])),
    ...Object.fromEntries(providerKeys.flatMap((name) => [[`github_deployment:${name}`, `https://api.github.com/repos/twoimo/tzudong/deployments/${provider[name].githubDeploymentId}`], [`github_deployment_status:${name}`, `https://api.github.com/repos/twoimo/tzudong/deployments/${provider[name].githubDeploymentId}/statuses`], [`vercel_deployment:${name}`, `https://api.vercel.com/v13/deployments/${provider[name].vercelDeploymentId}?teamId=${vercelTeamId}`]])),
    ...Object.fromEntries(expectedHealthHosts.flatMap((host) => [[`health:${host}`, `https://${host}/api/health`], [`identity:${host}`, `https://${host}/api/health`]])),
  };
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length !== Object.keys(expectedUrls).length) fail("EVIDENCE_EMPTY");
  const evidenceRows = new Map();
  for (const row of receipt.evidence) {
    if (!exactKeys(row, ["kind", "url", "sha256"]) || !Object.hasOwn(expectedUrls, row.kind) || evidenceRows.has(row.kind) || row.url !== expectedUrls[row.kind] || !sha(row.sha256)) fail("EVIDENCE_SCHEMA_INVALID");
    evidenceRows.set(row.kind, row);
  }
  if (evidenceRows.size !== Object.keys(expectedUrls).length) fail("EVIDENCE_EMPTY");
  const readEvidenceRow = async (kind, options, fetchCode) => {
    const row = evidenceRows.get(kind);
    let bytes;
    try { bytes = await fetch(row.url, options); } catch { fail(fetchCode); }
    if (sha256(bytes) !== row.sha256) fail("EVIDENCE_HASH_MISMATCH");
    try { return parseJson(bytes, "EVIDENCE_SCHEMA_INVALID"); } catch { fail("EVIDENCE_SCHEMA_INVALID"); }
  };
  const trustedCreator = (value) => value && value.login === VERCEL_GITHUB_CREATOR.login && value.type === VERCEL_GITHUB_CREATOR.type && value.id === VERCEL_GITHUB_CREATOR.id;
  const trustedApp = (value) => value && typeof value === "object" && String(value.id) === VERCEL_GITHUB_APP_ID && typeof value.slug === "string" && value.slug.length > 0;
  const trustedGitHubProvenance = (creator, githubApp) => trustedCreator(creator) && (githubApp === null || trustedApp(githubApp));
  const vercelHeaders = { headers: { authorization: `Bearer ${e.VERCEL_API_TOKEN || ""}` } };
  const project = await readEvidenceRow("vercel_project", vercelHeaders, "EVIDENCE_FETCH_FAILED");
  if (project?.id !== vercelProjectId || project?.accountId !== vercelTeamId || project?.rootDirectory !== "apps/web" || project?.framework !== "nextjs" || project?.nodeVersion !== "24.x" || project?.installCommand !== "npm ci") fail("VERCEL_DEPLOYMENT_MISMATCH");
  const vercelDeployments = {};
  for (const name of providerKeys) {
    const expected = providerExpected[name];
    const body = await readEvidenceRow(`vercel_deployment:${name}`, vercelHeaders, "EVIDENCE_FETCH_FAILED");
    const meta = body?.meta;
    if (!expected || body?.id !== provider[name].vercelDeploymentId || body?.projectId !== vercelProjectId || body?.ownerId !== vercelTeamId || body?.url !== expected.url.slice(8) || body?.target !== (name === "preview" ? null : "production") || body?.readyState !== "READY" || meta?.githubCommitSha !== expected.gitSha || meta?.githubCommitRef !== "main") fail("VERCEL_DEPLOYMENT_MISMATCH");
    vercelDeployments[name] = body;
  }
  for (const host of productionAliases) {
    const alias = await readEvidenceRow(`vercel_alias:${host}`, vercelHeaders, "EVIDENCE_FETCH_FAILED");
    if (alias?.alias !== host || alias?.deploymentId !== provider[liveProviderName].vercelDeploymentId || alias?.projectId !== vercelProjectId) fail("VERCEL_DEPLOYMENT_MISMATCH");
  }
  const trustedHealthHosts = new Set(expectedHealthHosts);
  if (trustedHealthHosts.size !== 3 || expectedHealthHosts[0] !== vercelDeployments[liveProviderName].url || productionAliases.some((host) => !trustedHealthHosts.has(host))) fail("VERCEL_DEPLOYMENT_MISMATCH");
  for (const name of providerKeys) {
    const expected = providerExpected[name];
    const deployment = await readEvidenceRow(`github_deployment:${name}`, undefined, "EVIDENCE_FETCH_FAILED");
    if (!deployment || String(deployment.id) !== String(provider[name].githubDeploymentId) || deployment.sha !== expected.gitSha || deployment.environment !== expected.environment || deployment.task !== "deploy" || !trustedGitHubProvenance(deployment.creator, deployment.performed_via_github_app)) fail("GITHUB_DEPLOYMENT_MISMATCH");
    const statuses = await readEvidenceRow(`github_deployment_status:${name}`, undefined, "EVIDENCE_FETCH_FAILED");
    if (!Array.isArray(statuses) || statuses.length < 1 || statuses.length > 100) fail("GITHUB_STATUS_MISMATCH");
    const status = statuses[0];
    const selected = statuses.find((item) => String(item?.id) === String(provider[name].statusId));
    if (!selected || selected !== status || status.state !== "success" || status.environment !== expected.environment || status.environment_url !== expected.url || status.deployment_url !== expectedUrls[`github_deployment:${name}`] || !trustedGitHubProvenance(status.creator, status.performed_via_github_app) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(status.updated_at || "") || Date.parse(status.updated_at) < 0 || Math.floor(Date.parse(status.updated_at) / 1000) > now + 60 || Math.floor(Date.parse(status.updated_at) / 1000) < deploymentReceipts[name === "knownGood" ? "knownGood" : name].observedAt - 60) fail("GITHUB_STATUS_MISMATCH");
    if (statuses.slice(1).some((item) => !item || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(item.updated_at || "") || Date.parse(item.updated_at) > Date.parse(status.updated_at))) fail("GITHUB_STATUS_MISMATCH");
  }
  const protectionBypassSecret = e.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (typeof protectionBypassSecret !== "string" || protectionBypassSecret.length < 16 || protectionBypassSecret.length > 512 || !/^[\x21-\x7e]+$/.test(protectionBypassSecret)) fail("HTTPS_HEALTH_MISMATCH");
  for (const host of expectedHealthHosts) {
    if (!trustedHealthHosts.has(host)) fail("VERCEL_DEPLOYMENT_MISMATCH");
    const expectedIdentity = { gitSha: liveProvider.gitSha, deploymentId: provider[liveProviderName].vercelDeploymentId };
    for (const kind of [`health:${host}`, `identity:${host}`]) {
      const body = await readEvidenceRow(kind, { headers: { "x-vercel-protection-bypass": protectionBypassSecret } }, "EVIDENCE_FETCH_FAILED");
      if (!exactKeys(body, ["ok", "service", "releaseId", "gitSha", "deploymentId", "projectId", "host"]) || body.ok !== true || body.service !== "tzudong-web" || body.releaseId !== e.RELEASE_ID || body.gitSha !== expectedIdentity.gitSha || body.deploymentId !== expectedIdentity.deploymentId || body.projectId !== "prj_sau35J5uUtShIQ9OKofRtOVVnTSl" || body.host !== host) fail(kind.startsWith("health:") ? "HTTPS_HEALTH_MISMATCH" : "HTTPS_IDENTITY_MISMATCH");
    }
  }
  const bundle = receipt.finalBundle; if (!exactKeys(bundle, ["url", "sha256"]) || !sha(bundle.sha256)) fail("FINAL_BUNDLE_MISMATCH"); publicUrl(bundle.url, ["release-evidence.tzudong.app"], true, e.EXPECTED_SHA, bundle.sha256); let bundleBytes; try { bundleBytes = await fetch(bundle.url); } catch { fail("FINAL_BUNDLE_MISMATCH"); } if (sha256(bundleBytes) !== bundle.sha256) fail("FINAL_BUNDLE_MISMATCH"); const finalBundle = parseJson(bundleBytes, "FINAL_BUNDLE_MISMATCH", true);
  const finalKeys = ["kind", "releaseId", "mainSha", "releaseTree", "productionDeploymentId", "knownGoodDeploymentId", "githubDeploymentId", ...Object.keys(detached)];
  if (!exactKeys(finalBundle, finalKeys) || finalBundle.kind !== "ts7-release-evidence-v1" || !releaseId(finalBundle.releaseId) || !gitId(finalBundle.mainSha) || !gitId(finalBundle.releaseTree) || !deploymentId(finalBundle.productionDeploymentId) || !deploymentId(finalBundle.knownGoodDeploymentId) || !/^[1-9][0-9]*$/.test(finalBundle.githubDeploymentId || "") || Object.keys(detached).map((key) => finalBundle[key]).some((value) => !sha(value)) || !Object.entries({ releaseId: e.RELEASE_ID, mainSha: e.EXPECTED_SHA, releaseTree: e.EXPECTED_TREE, productionDeploymentId: e.PRODUCTION_DEPLOYMENT_ID, knownGoodDeploymentId: e.KNOWN_GOOD_DEPLOYMENT_ID, githubDeploymentId: e.GITHUB_DEPLOYMENT_ID, ...detached }).every(([key, value]) => finalBundle[key] === value)) fail("FINAL_BUNDLE_MISMATCH");
  gitAdapter("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", "+refs/heads/develop:refs/remotes/origin/develop", "+refs/heads/data:refs/remotes/origin/data");
  verifyRemoteRefs(e.EXPECTED_SHA, e.EXPECTED_TREE, gitAdapter);
  if (clock() > terminalEvidenceExpiresAt) fail("FRESHNESS_MISMATCH");
  if (e.ROLLBACK_STATE === "rolled_back") fail("ROLLED_BACK");
  if (e.FINAL_BUNDLE_PATH) writeBundle(e.FINAL_BUNDLE_PATH, bundleBytes);
  output(`reason=VERIFIED\nrelease_id=${e.RELEASE_ID}\nrelease_tree=${e.EXPECTED_TREE}\nreceipt_sha256=${e.RECEIPT_SHA256}\nbundle_sha256=${bundle.sha256}\nexpires_at=${terminalEvidenceExpiresAt}\nproduction_deployment_id=${e.PRODUCTION_DEPLOYMENT_ID}\nimmutable_host=${deployment.hostname}\n`);
}

async function main() {
  await verifyFinalReleaseEvidence({ env: process.env });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { const code = failureCodes.has(error.code) ? error.code : "UNKNOWN_VALIDATION_FAILURE"; fs.appendFileSync(process.env.GITHUB_OUTPUT, `reason=${code}\n`); process.exitCode = 1; });
