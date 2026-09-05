import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Requirement 9.7 / design C5 "접근 진입점": Local_Database access uses the same
// three Supabase entrypoints as Hosted_Database, and no fourth entrypoint or direct
// connection path is added. This source-contract test freezes the exact set of files
// that are permitted to construct a Supabase client from the SDK packages, so that any
// newly added construction site (a "fourth entrypoint") or any raw Postgres connection
// fails the suite and forces a review against Requirement 9.7.
//
// The backend worker postgres DSN path (backend/pipeline_control/pool.py, pg_store.py)
// is a separate, pre-existing contract guarded by backend/pipeline_control/dsn_guard.py
// and is intentionally out of scope for this web-side contract.

const appRoot = join(import.meta.dir, '..');

// The three canonical Local_Database entrypoints named in Requirement 9.7 / design C5.
const CANONICAL_ENTRYPOINTS = {
  browser: {
    path: 'integrations/supabase/client.ts',
    constructor: 'createBrowserClient',
    package: '@supabase/ssr',
  },
  sessionAwareServer: {
    path: 'lib/supabase/server.ts',
    constructor: 'createServerClient',
    package: '@supabase/ssr',
  },
  privilegedServer: {
    path: 'lib/supabase/service-role.ts',
    constructor: 'createClient',
    package: '@supabase/supabase-js',
  },
} as const;

// Pre-existing additional client-construction sites in the current tree. Each is a
// purpose-built client under its own already-tested contract, not a general-purpose
// Local_Database access entrypoint. This list is frozen: adding a new construction
// site anywhere else is a Requirement 9.7 "fourth entrypoint" and must fail the test
// until it is reviewed and (if intended) added here explicitly.
const PREEXISTING_ADDITIONAL_CLIENT_SITES = [
  'lib/supabase/middleware.ts', // Next.js middleware session-refresh variant of the session-aware server boundary
  'lib/supabase/storage-server.ts', // privileged Storage-only client; keeps only .storage and discards the data client
  'lib/dashboard/supabase.ts', // server-side dashboard read client (see admin dashboard contracts)
  'lib/public-insights/treemap.ts', // server-side public insights read client
  'app/api/account/delete/route.ts', // self account deletion service-role path (account-deletion contracts)
  'app/api/privacy/onboarding/route.ts', // challenge-bound onboarding client (privacy-onboarding contract)
  'app/api/shorten/route.ts', // public + service-role clients (api-security-source contract)
  'app/s/[code]/page.tsx', // public short-url redirect anon read client
  'scripts/capture-youtube-kpi-snapshot.mjs', // KPI snapshot CLI (server-side tooling)
  'scripts/admin-evaluations-smoke.mjs', // admin evaluation smoke CLI (server-side tooling)
  'scripts/restaurant-refresh-cron.mjs', // restaurant refresh cron CLI (server-side tooling)
] as const;

const ALLOWED_CONSTRUCTION_SITES = [
  ...Object.values(CANONICAL_ENTRYPOINTS).map((entry) => entry.path),
  ...PREEXISTING_ADDITIONAL_CLIENT_SITES,
].sort();

// First-party shipped source roots. Excludes build output (.next*), node_modules,
// .vercel, test trees, and generated artifacts by only descending into these roots
// and skipping dotted / node_modules directories.
const SOURCE_ROOTS = [
  'app',
  'components',
  'config',
  'constants',
  'contexts',
  'design',
  'hooks',
  'integrations',
  'lib',
  'pages',
  'scripts',
  'types',
] as const;
const STANDALONE_SOURCE_FILES = ['proxy.ts'] as const;

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE = /\.d\.ts$/;

const SDK_PACKAGES = new Set(['@supabase/ssr', '@supabase/supabase-js']);
const CLIENT_CONSTRUCTORS = new Set(['createBrowserClient', 'createServerClient', 'createClient']);

// Raw Postgres driver imports are the unambiguous signal of a direct connection path
// that bypasses the Supabase entrypoints. A DSN string alone (e.g. the Supabase CLI
// type-generation helper) is not an in-process connection and is not matched here.
const DIRECT_CONNECTION_DRIVER_IMPORT =
  /(?:from\s*['"](?:pg|pg-pool|postgres)['"])|(?:require\(\s*['"](?:pg|pg-pool|postgres)['"]\s*\))/;

function toRelative(absolutePath: string): string {
  return relative(appRoot, absolutePath).replace(/\\/g, '/');
}

function listSourceFiles(): string[] {
  const files: string[] = [];

  const walk = (absoluteDir: string) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolutePath = join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name) && !DECLARATION_FILE.test(entry.name)) {
        files.push(toRelative(absolutePath));
      }
    }
  };

  for (const root of SOURCE_ROOTS) {
    walk(join(appRoot, root));
  }
  for (const file of STANDALONE_SOURCE_FILES) {
    files.push(file);
  }

  return files.sort();
}

function readSource(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

// Returns the SDK client constructors imported *as values* (type-only imports and
// SupabaseClient type imports are ignored) from the Supabase SDK packages.
function sdkClientConstructorsImportedBy(content: string): Set<string> {
  const found = new Set<string>();
  const importStatement = /import\s+([^;]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importStatement.exec(content)) !== null) {
    const clause = match[1];
    const packageName = match[2];
    if (!SDK_PACKAGES.has(packageName)) continue;
    if (/^type\b/.test(clause.trim())) continue; // whole-import type-only: `import type { ... }`

    const namedBindings = clause.match(/\{([^}]*)\}/);
    if (!namedBindings) continue;

    for (const rawBinding of namedBindings[1].split(',')) {
      const binding = rawBinding.trim();
      if (!binding || /^type\b/.test(binding)) continue; // inline `type Name`
      const importedName = binding.split(/\s+as\s+/)[0].trim(); // handle `createClient as alias`
      if (CLIENT_CONSTRUCTORS.has(importedName)) found.add(importedName);
    }
  }

  return found;
}

describe('Supabase Local_Database access entrypoint source contract (Requirement 9.7)', () => {
  const allFiles = listSourceFiles();
  const constructionSites = allFiles.filter((file) => sdkClientConstructorsImportedBy(readSource(file)).size > 0);

  test('only the frozen allowlist of files constructs a Supabase client', () => {
    // The scan must actually find work to do, otherwise the contract is a tautology.
    expect(allFiles.length).toBeGreaterThan(200);

    const unexpected = constructionSites.filter((file) => !ALLOWED_CONSTRUCTION_SITES.includes(file));
    const missing = ALLOWED_CONSTRUCTION_SITES.filter((file) => !constructionSites.includes(file));

    // A non-empty `unexpected` means a fourth entrypoint / direct client construction was
    // added outside the reviewed set (Requirement 9.7 violation). A non-empty `missing`
    // means the allowlist drifted from reality and must be re-reviewed.
    expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] });
    expect([...constructionSites].sort()).toEqual(ALLOWED_CONSTRUCTION_SITES);
  });

  test('each canonical entrypoint constructs exactly its expected primitive from the expected SDK package', () => {
    for (const entry of Object.values(CANONICAL_ENTRYPOINTS)) {
      const source = readSource(entry.path);
      const constructors = sdkClientConstructorsImportedBy(source);

      expect(constructors.has(entry.constructor)).toBe(true);
      expect(source).toContain(`from '${entry.package}'`);
      // The primitive is actually invoked (not merely imported), typed to Database.
      expect(source).toContain(`${entry.constructor}<Database>(`);
    }
  });

  test('canonical entrypoints share one Supabase URL config so Local and Hosted use the same entrypoints', () => {
    const browser = readSource(CANONICAL_ENTRYPOINTS.browser.path);
    const server = readSource(CANONICAL_ENTRYPOINTS.sessionAwareServer.path);
    const serviceRole = readSource(CANONICAL_ENTRYPOINTS.privilegedServer.path);

    // No Local-only vs Hosted-only branch that constructs a separate client: all three
    // read the same NEXT_PUBLIC_SUPABASE_URL, which can point to the local mirror or hosted.
    expect(browser).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(browser).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(browser).toContain('getSupabaseBrowserClient');

    expect(server).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(server).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(server).toContain('export async function createClient()');

    // Privileged server-only client is guarded from the browser and uses the service-role key.
    expect(serviceRole).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(serviceRole).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(serviceRole).toContain("typeof window !== 'undefined'");
    expect(serviceRole).toContain('createSupabaseServiceRoleClient');
  });

  test('the privileged Storage client keeps only .storage and stays server-only', () => {
    const storageServer = readSource('lib/supabase/storage-server.ts');
    // storage-server.ts constructs a client purely to expose its Storage surface; it is not
    // a Local_Database data entrypoint (it never exposes .from()).
    expect(storageServer).toContain('server-only');
    expect(storageServer).toContain("typeof window !== 'undefined'");
    expect(storageServer).toContain(').storage;');
    expect(storageServer).toContain("type StorageClient = SupabaseClient<Database>['storage']");
  });

  test('general server code routes Local_Database access through an entrypoint, not the SDK', () => {
    // A representative consumer imports the session-aware entrypoint rather than constructing
    // its own client, locking the routing direction that Requirement 9.7 depends on.
    const requireAdmin = readSource('lib/auth/require-admin.ts');
    expect(requireAdmin).toContain("from '@/lib/supabase/server'");
    expect(sdkClientConstructorsImportedBy(requireAdmin).size).toBe(0);
  });

  test('no first-party source opens a direct Postgres connection that bypasses Supabase', () => {
    const directConnections = allFiles.filter((file) => DIRECT_CONNECTION_DRIVER_IMPORT.test(readSource(file)));
    expect(directConnections).toEqual([]);
  });
});
