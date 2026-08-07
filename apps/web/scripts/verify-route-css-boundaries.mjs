import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { relative, resolve, sep } from "node:path";
import postcss from "postcss";
import { gzipSync } from "node:zlib";

export const ADMIN_SIDEBAR_MARKER = "--admin-sidebar-expanded-max-width";
export const HOME_REQUIRED_UTILITY = ".bg-background";
export const HOME_ROUTE_CSS_MAX_BYTES = 220 * 1024;
export const MOBILE_SCROLLBAR_SELECTOR = ":where(.scrollbar-hide-mobile,[data-mobile-scrollbarless=true],[class*=overflow-y-auto],[class*=overflow-x-auto],[class*=overflow-auto])";
export const GENERAL_APP_ROUTE_CSS_MAX_BYTES = 512 * 1024;
export const ADMIN_ROUTE_CSS_MAX_BYTES = 512 * 1024;
export const DEFERRED_ROUTE_CSS_MAX_BYTES = 280 * 1024;
export const HOME_ROUTE_CSS_MAX_TRANSFER_BYTES = 48 * 1024;
export const GENERAL_APP_ROUTE_CSS_MAX_TRANSFER_BYTES = 110 * 1024;
export const ADMIN_ROUTE_CSS_MAX_TRANSFER_BYTES = 110 * 1024;
export const DEFERRED_ROUTE_CSS_MAX_TRANSFER_BYTES = 64 * 1024;
export const HOME_ROUTE_KEY = "/page";
export const GENERAL_APP_ROUTE_KEY = "/feed/page";
export const ADMIN_ROUTE_KEY = "/admin/page";
export const DEFERRED_ROUTE_KEY = "/home-frame/page";

function fail(message) { throw new Error(`Route CSS boundary verification failed: ${message}`); }
function parseCss(css) {
  if (typeof css !== "string") return null;
  try { return postcss.parse(css); } catch { return null; }
}
function normalizeExactSelector(value) {
  return value.trim().replace(
    /\[([A-Za-z_][A-Za-z0-9_-]*)=["']([A-Za-z0-9_-]+)["']\]/g,
    "[$1=$2]",
  );
}
function exactSelector(rule, selector) {
  const expected = normalizeExactSelector(selector);
  return rule.type === "rule" && rule.selectors?.some((candidate) => normalizeExactSelector(candidate) === expected);
}
function exactDeclaration(rule, declaration) {
  const [property, ...valueParts] = declaration.split(":");
  const value = valueParts.join(":").trim();
  return rule.nodes?.some((node) => node.type === "decl" && node.prop === property.trim() && (!value || node.value.replace(/\s+/g, "") === value.replace(/\s+/g, "")));
}
function isEffectiveMedia(query) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  return normalized !== "" && !normalized.startsWith("not") && !normalized.startsWith("only") && !normalized.includes("notall") && !normalized.includes(",");
}
function matchesSupportedMedia(query, supported) {
  const normalized = query.replace(/\s+/g, "").toLowerCase();
  return supported.some((candidate) => normalized === `(${candidate.replace(/\s+/g, "").toLowerCase()})`);
}
function hasExactRuleContext(rule, supportedMedia = null) {
  const media = [];
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule") continue;
    const name = parent.name.toLowerCase();
    if (name === "layer") continue;
    if (name === "media") {
      media.push(parent.params);
      continue;
    }
    return false;
  }
  if (!supportedMedia) return media.length === 0;
  return media.length === 1 && isEffectiveMedia(media[0]) && matchesSupportedMedia(media[0], supportedMedia);
}
function walkRules(css, visitor) { const root = parseCss(css); if (!root) return false; let matched = false; root.walkRules((rule) => { if (visitor(rule)) matched = true; }); return matched; }

export function hasExactCssClassSelector(css, classSelector = HOME_REQUIRED_UTILITY) {
  return /^\.[A-Za-z0-9_-]+$/.test(classSelector) && walkRules(css, (rule) => exactSelector(rule, classSelector) && hasExactRuleContext(rule));
}
export function hasCssDeclaration(css, selector, declaration) {
  return walkRules(css, (rule) => exactSelector(rule, selector) && exactDeclaration(rule, declaration) && hasExactRuleContext(rule));
}
export function hasCssDeclarationInMedia(css, mediaQueries, selector, declaration) {
  return walkRules(css, (rule) => exactSelector(rule, selector) && exactDeclaration(rule, declaration) && hasExactRuleContext(rule, mediaQueries));
}
function assertDuplicateFreeJson(text) {
  let index = 0;
  const whitespace = () => { while (/[ \t]/.test(text[index])) index += 1; };
  const string = () => {
    const start = index++;
    let escaped = false;
    while (index < text.length) {
      const character = text[index++];
      if (!escaped && character === '"') return JSON.parse(text.slice(start, index));
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    throw new Error("unterminated string");
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      const keys = new Set();
      whitespace();
      if (text[index] === "}") { index += 1; return; }
      for (;;) {
        whitespace();
        if (text[index] !== '"') throw new Error("invalid object");
        const key = string();
        if (keys.has(key)) throw new Error("duplicate key");
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new Error("invalid object");
        value();
        whitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index++] !== ",") throw new Error("invalid object");
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      for (;;) {
        value();
        whitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index++] !== ",") throw new Error("invalid array");
      }
    }
    if (text[index] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!token) throw new Error("invalid value");
    index += token[0].length;
  };
  value();
  whitespace();
  if (index !== text.length) throw new Error("trailing data");
}

export function parseClientReferenceManifest(source, routeKey) {
  if (typeof source !== "string" || source.length === 0) fail(`manifest for ${routeKey} is empty or unreadable`);
  const initializer = "globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});";
  const assignment = `${initializer}globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}]=`;
  if (!source.startsWith(assignment) || !source.endsWith(";")) fail(`manifest for ${routeKey} has an unexpected assignment`);
  const serialized = source.slice(assignment.length, -1);
  if (serialized.includes("\n") || serialized.includes("globalThis.__RSC_MANIFEST")) fail(`manifest for ${routeKey} has an unexpected assignment`);
  try { assertDuplicateFreeJson(serialized); } catch (error) { fail(`manifest for ${routeKey} is malformed: ${error.message}`); }
  try {
    const manifest = JSON.parse(serialized);
    const expectedKeys = ["clientModules", "edgeRscModuleMapping", "edgeSSRModuleMapping", "entryCSSFiles", "moduleLoading", "rscModuleMapping", "ssrModuleMapping"];
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedKeys)
    ) fail(`manifest for ${routeKey} has an unexpected schema`);
    return manifest;
  } catch (error) { fail(`manifest for ${routeKey} is malformed: ${error.message}`); }
}
export function collectRouteCssAssetPaths(manifest, routeKey) {
  const entries = manifest?.entryCSSFiles;
  if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length === 0) fail(`manifest for ${routeKey} has no entryCSSFiles object`);
  const normalizedEntries = Object.entries(entries).map(([owner, assets]) => {
    if (!owner || !Array.isArray(assets)) fail(`manifest for ${routeKey} has a malformed entryCSSFiles entry`);
    for (const asset of assets) {
      if (!asset || typeof asset !== "object" || Object.keys(asset).length !== 2 || asset.inlined !== false || typeof asset.path !== "string" || !/^static\/css\/[^/]+\.css$/.test(asset.path)) fail(`manifest for ${routeKey} has an invalid CSS asset entry`);
    }
    return [owner.replaceAll("\\", "/"), assets];
  });
  const rootLayoutSuffix = "/app/layout";
  const rootOwners = normalizedEntries.filter(([owner]) => owner.endsWith(rootLayoutSuffix));
  if (rootOwners.length !== 1) fail(`manifest for ${routeKey} does not have one canonical root layout owner`);
  const appRoot = rootOwners[0][0].slice(0, -rootLayoutSuffix.length);
  const routeSegment = routeKey === "/page" ? "" : routeKey.slice(0, -"/page".length);
  const selectedOwners = new Set([
    `${appRoot}/app/layout`,
    routeKey === "/page" ? `${appRoot}/app/page` : `${appRoot}/app${routeSegment}/layout`,
    ...(routeKey === "/page" ? [] : [`${appRoot}/app${routeSegment}/page`]),
  ]);
  const paths = [];
  for (const [owner, assets] of normalizedEntries) {
    if (!selectedOwners.has(owner)) continue;
    for (const asset of assets) {
      if (paths.includes(asset.path)) fail(`manifest for ${routeKey} references CSS asset more than once: ${asset.path}`);
      paths.push(asset.path);
    }
  }
  if (paths.length === 0) fail(`manifest for ${routeKey} has no CSS assets`);
  return paths.sort();
}
function inside(root, candidate) { const rel = relative(root, candidate); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.includes(sep); }
export function resolveCssAssetPath(nextDirectory, assetPath) {
  const canonicalNextDirectory = realpathSync(resolve(nextDirectory));
  const cssDirectory = realpathSync(resolve(canonicalNextDirectory, "static", "css"));
  const candidate = resolve(canonicalNextDirectory, ...assetPath.split("/"));
  if (!inside(cssDirectory, candidate)) fail(`CSS asset path escapes .next/static/css: ${assetPath}`);
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) fail(`CSS asset path is a symlink: ${assetPath}`);
  const asset = realpathSync(candidate);
  if (!inside(cssDirectory, asset)) fail(`CSS asset path escapes .next/static/css: ${assetPath}`);
  return asset;
}
export function readRouteCss(nextDirectory, manifestSource, routeKey, readFile = readFileSync) {
  const assetPaths = collectRouteCssAssetPaths(parseClientReferenceManifest(manifestSource, routeKey), routeKey);
  const assets = assetPaths.map((assetPath) => {
    let css;
    try { css = readFile(resolveCssAssetPath(nextDirectory, assetPath), "utf8"); } catch (error) { fail(`cannot read CSS asset for ${routeKey}: ${assetPath} (${error.message})`); }
    if (typeof css !== "string" || css.length === 0 || !parseCss(css)) fail(`CSS asset for ${routeKey} is empty, unreadable, or malformed: ${assetPath}`);
    return { assetPath, css, bytes: Buffer.byteLength(css), transferBytes: gzipSync(css).byteLength, digest: createHash("sha256").update(css).digest("hex") };
  });
  return { assetPaths, assets, css: assets.map(({ css }) => css).join("\n"), bytes: assets.reduce((total, asset) => total + asset.bytes, 0), transferBytes: assets.reduce((total, asset) => total + asset.transferBytes, 0) };
}
function requireRouteSemantics(routeName, routeCss, requirements) {
  for (const { selector, declaration, mediaQueries } of requirements) if (!(mediaQueries ? hasCssDeclarationInMedia(routeCss.css, mediaQueries, selector, declaration) : hasCssDeclaration(routeCss.css, selector, declaration))) fail(`${routeName} route CSS is missing ${mediaQueries ? "media-scoped " : ""}selector ${selector} with exact declaration ${declaration}`);
}
function requireBudget(routeName, routeCss, maxBytes, maxTransferBytes) {
  if (routeCss.bytes > maxBytes) fail(`${routeName} route CSS (${routeCss.bytes} bytes) exceeds ${maxBytes}-byte raw ceiling`);
  if (routeCss.transferBytes > maxTransferBytes) fail(`${routeName} route CSS (${routeCss.transferBytes} transfer bytes) exceeds ${maxTransferBytes}-byte transfer ceiling`);
}
function inventoryAssets(routes) {
  const owners = new Map(), digests = new Map();
  for (const [route, routeCss] of Object.entries(routes)) for (const asset of routeCss.assets) {
    owners.set(asset.assetPath, [...(owners.get(asset.assetPath) ?? []), route]);
    if (digests.has(asset.digest) && digests.get(asset.digest) !== asset.assetPath) fail(`duplicate CSS payloads use different names: ${digests.get(asset.digest)} and ${asset.assetPath}`);
    digests.set(asset.digest, asset.assetPath);
  }
  const routeNames = Object.keys(routes);
  const rootSharedAssetPaths = [...owners]
    .filter(([, assetOwners]) => routeNames.every((route) => assetOwners.includes(route)))
    .map(([path]) => path)
    .sort();
  if (rootSharedAssetPaths.length === 0) fail("route CSS topology has no all-route shared asset");
  for (const route of routeNames) {
    if (!routes[route].assetPaths.some((path) => !rootSharedAssetPaths.includes(path))) {
      fail(`route CSS topology has no surface-owned asset for ${route}`);
    }
  }
  const homeRoutes = new Set(["home", "deferred"]);
  const appRoutes = new Set(["generalApp", "admin"]);
  for (const [path, assetOwners] of owners) {
    const crossesHomeAndApp =
      assetOwners.some((route) => homeRoutes.has(route)) &&
      assetOwners.some((route) => appRoutes.has(route));
    if (crossesHomeAndApp && !rootSharedAssetPaths.includes(path)) {
      fail(`route CSS surface asset crosses the home/app boundary: ${path}`);
    }
  }
  const sharedAssetPaths = [...owners].filter(([, assetOwners]) => assetOwners.length > 1).map(([path]) => path).sort();
  const exclusiveAssetPaths = Object.fromEntries(routeNames.map((route) => [route, routes[route].assetPaths.filter((path) => owners.get(path).length === 1)]));
  return { sharedAssetPaths, exclusiveAssetPaths };
}
export function verifyRouteCssBoundaries(homeRouteCss, generalAppRouteCss, adminRouteCss, deferredRouteCss) {
  if (!homeRouteCss || !generalAppRouteCss || !adminRouteCss || !deferredRouteCss) fail("all four route CSS inventories are required");
  requireBudget("home", homeRouteCss, HOME_ROUTE_CSS_MAX_BYTES, HOME_ROUTE_CSS_MAX_TRANSFER_BYTES);
  requireBudget("general-app", generalAppRouteCss, GENERAL_APP_ROUTE_CSS_MAX_BYTES, GENERAL_APP_ROUTE_CSS_MAX_TRANSFER_BYTES);
  requireBudget("admin", adminRouteCss, ADMIN_ROUTE_CSS_MAX_BYTES, ADMIN_ROUTE_CSS_MAX_TRANSFER_BYTES);
  requireBudget("deferred", deferredRouteCss, DEFERRED_ROUTE_CSS_MAX_BYTES, DEFERRED_ROUTE_CSS_MAX_TRANSFER_BYTES);
  requireRouteSemantics("home", homeRouteCss, [{ selector: HOME_REQUIRED_UTILITY, declaration: "background-color" }, { selector: ".scrollbar-hide", declaration: "scrollbar-width" }]);
  const adminRequirements = [{ selector: '[data-admin-console-layout="sidebar-content"]', declaration: "grid-template-columns", mediaQueries: ["min-width:768px", "width>=48rem"] }];
  requireRouteSemantics("general-app", generalAppRouteCss, adminRequirements);
  requireRouteSemantics("admin", adminRouteCss, adminRequirements);
  requireRouteSemantics("deferred", deferredRouteCss, [{ selector: ".scrollbar-hide", declaration: "scrollbar-width" }, { selector: MOBILE_SCROLLBAR_SELECTOR, declaration: "scrollbar-width", mediaQueries: ["max-width:767px", "width<48rem"] }]);
  if (hasCssDeclaration(homeRouteCss.css, ":root", ADMIN_SIDEBAR_MARKER) || !hasCssDeclaration(generalAppRouteCss.css, ":root", ADMIN_SIDEBAR_MARKER) || !hasCssDeclaration(adminRouteCss.css, ":root", ADMIN_SIDEBAR_MARKER)) fail(`route CSS marker ownership is invalid: ${ADMIN_SIDEBAR_MARKER}`);
  const inventory = inventoryAssets({ home: homeRouteCss, generalApp: generalAppRouteCss, admin: adminRouteCss, deferred: deferredRouteCss });
  return { homeBytes: homeRouteCss.bytes, generalAppBytes: generalAppRouteCss.bytes, adminBytes: adminRouteCss.bytes, deferredBytes: deferredRouteCss.bytes, homeTransferBytes: homeRouteCss.transferBytes, generalAppTransferBytes: generalAppRouteCss.transferBytes, adminTransferBytes: adminRouteCss.transferBytes, deferredTransferBytes: deferredRouteCss.transferBytes, ...inventory };
}
function readManifest(nextDirectory, relativePath, routeName, readFile) { try { return readFile(resolve(nextDirectory, ...relativePath), "utf8"); } catch (error) { fail(`cannot read ${routeName} manifest: ${error.message}`); } }
export function verifyBuildRouteCssBoundaries({ nextDirectory = resolve(".next"), readFile = readFileSync } = {}) {
  return verifyRouteCssBoundaries(
    readRouteCss(nextDirectory, readManifest(nextDirectory, ["server", "app", "page_client-reference-manifest.js"], "home", readFile), HOME_ROUTE_KEY, readFile),
    readRouteCss(nextDirectory, readManifest(nextDirectory, ["server", "app", "feed", "page_client-reference-manifest.js"], "general-app", readFile), GENERAL_APP_ROUTE_KEY, readFile),
    readRouteCss(nextDirectory, readManifest(nextDirectory, ["server", "app", "admin", "page_client-reference-manifest.js"], "admin", readFile), ADMIN_ROUTE_KEY, readFile),
    readRouteCss(nextDirectory, readManifest(nextDirectory, ["server", "app", "home-frame", "page_client-reference-manifest.js"], "deferred", readFile), DEFERRED_ROUTE_KEY, readFile),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const result = verifyBuildRouteCssBoundaries(); console.log(`Verified route CSS boundaries: home ${result.homeBytes} bytes; general app ${result.generalAppBytes} bytes; admin ${result.adminBytes} bytes; deferred ${result.deferredBytes} bytes.`); }
