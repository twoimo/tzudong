import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { compileResponsiveCss } from './responsive-css';

const appRoot = join(import.meta.dir, '../..');

// Render production modules and MainLayoutContent. Only the surrounding admin
// menu/sidebar and its fixed viewport boundary are synthetic: no admin session,
// provider data, mutations, or full-console background jobs enter this fixture.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MainLayoutContent} from './components/layout/MainLayout';
import PrivacyIncidentsPage from './app/admin/privacy-incidents/page';
import {AdminPipelineDashboard} from './components/admin/pipeline/AdminPipelineDashboard';
import {AdminKnowledgeGraphPanel} from './components/admin/AdminKnowledgeGraphPanel';
import {AdminEvaluationLoadingTable} from './components/admin/AdminEvaluationLoadingTable';
import {AdminPageHeader} from './components/admin/AdminPageHeader';
import {LoadingProvider} from './components/ui/loading-surface';
const mode=new URLSearchParams(location.search).get('fixture') || 'privacy';
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
function ConsoleBoundary({children}) {
  const graph=mode==='knowledge';
  return <div data-admin-console-shell="true" data-design-surface="admin" className="h-[var(--full-height,100vh)] min-h-0 min-w-0 w-full overflow-hidden bg-background font-sans text-foreground tracking-normal">
    <div data-admin-console-layout="sidebar-content" data-admin-console-mobile-header-visible="true" className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-1">
      <div data-admin-console-mobile-header="true" className="flex h-14 shrink-0 items-center overflow-hidden bg-card px-3 py-2 md:hidden">합성 관리자 메뉴</div>
      <aside data-admin-left-panel-expanded="true" className="hidden h-full shrink-0 md:block">합성 메뉴</aside>
      <section id="admin-console-canvas" data-admin-console-content="true" data-scroll-owner="admin-canvas" className="admin-surface h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-background p-2 md:p-4" style={{paddingBottom:innerWidth<768?'calc(env(safe-area-inset-bottom) + 0.75rem)':'1rem'}}>
        <div className="h-full min-h-0">
          <section data-admin-console-inline-module-frame="true" className={'admin-surface flex min-h-full min-w-0 flex-col md:h-full md:min-h-0'+(graph?' !h-full !min-h-0':'')}>
            <div data-admin-console-inline-module-panel="true" className={'admin-surface min-h-[360px] flex-1 bg-background shadow-none md:min-h-0 overflow-visible md:overflow-hidden'+(graph?' flex min-h-0 flex-col !overflow-hidden':'')}>
              {children}
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>;
}
const module=mode==='pipeline'?<AdminPipelineDashboard/>:mode==='knowledge'?<AdminKnowledgeGraphPanel/>:
  <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <AdminPageHeader title="관리자 데이터 검수"/>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2"><AdminEvaluationLoadingTable rowCount={16}/></div>
  </div>;
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={client}><LoadingProvider><MainLayoutContent>
    {mode==='privacy'?<PrivacyIncidentsPage/>:<ConsoleBoundary>{module}</ConsoleBoundary>}
  </MainLayoutContent></LoadingProvider></QueryClientProvider>
);
`;

export async function buildAdminResponsiveFixture() {
  const mocks: Record<string, string> = {
    'next/navigation': 'export const usePathname=()=>location.pathname;',
    'next/dynamic': `import React from 'react';export default function dynamic(loader){const Component=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}`,
    'next/link': "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}",
    '@/contexts/AuthContext': 'const auth={user:null,needsNicknameSetup:false,completeNicknameSetup(){}};export const useAuth=()=>auth;',
    '@/components/layout/NavigationPrefetcher': 'export default function Prefetcher(){return null;}',
    '@/components/layout/UserDataPrefetcher': 'export default function Prefetcher(){return null;}',
    '@/components/layout/CombinedPopup': 'export default function Popup(){return null;}',
    '@/components/layout/MobileBottomNav': 'export default function Navigation(){return null;}',
    '@/components/layout/OverlayLayout': 'export default function Overlay({children}){return children;}',
    '@/components/auth/AuthModal': 'export default function AuthModal(){return null;}',
    '@/components/profile/ProfileModal': 'export function ProfileModal(){return null;}',
    '@/components/profile/NicknameSetupModal': 'export function NicknameSetupModal(){return null;}',
    '@/components/admin/AdminRestaurantModal': 'export function AdminRestaurantModal(){return null;}',
  };
  const result = await Bun.build({
    entrypoints: ['admin-responsive-entry'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'admin-responsive', setup(builder) {
      builder.onResolve({ filter: /^admin-responsive-entry$/ }, () => ({ path: 'entry', namespace: 'admin-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'admin-fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'admin-mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), appRoot) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'admin-mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  const script = result.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('ADMIN_RESPONSIVE_FIXTURE_BUNDLE_MISSING');
  // Tailwind owners are compiled separately. Bun emits the actual CSS Modules
  // with the same scoped class names used by the bundled components.
  const css = await Promise.all([
    compileResponsiveCss(['globals.css', 'app-globals.css']),
    readFile(join(appRoot, 'styles/product-ui.css'), 'utf8'),
    readFile(join(appRoot, 'styles/admin-ui.css'), 'utf8'),
    ...result.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()),
  ]);
  return { script: await script.text(), css: css.join('\n') };
}

const incidentId = '00000000-0000-4000-8000-000000000001';
export const finalIncidentAuditId = '00000000-0000-4000-8000-000000000112';
export const privacyResponsivePayload = {
  ok: true,
  serverNow: '2026-11-14T12:00:00.000Z',
  incidents: [{
    id: incidentId, status: 'detected', severity: 'medium',
    detectedAt: '2026-11-14T12:00:00.000Z', updatedAt: '2026-11-14T12:00:00.000Z',
    awarenessAt: null, deadlineAt: null, deadlineStatus: 'not_started', deadlineRemainingMinutes: null,
    affectedCountEstimate: null, dataCategories: [], sensitiveOrUniqueId: null,
    externalIntrusion: null, decisionCode: null, assessmentReadbackAt: null,
  }],
  notices: [],
  actions: Array.from({ length: 12 }, (_, index) => ({
    id: '00000000-0000-4000-8000-' + String(index + 20).padStart(12, '0'),
    incidentId, fromStatus: 'detected', toStatus: 'triaged',
    actorUserId: '00000000-0000-4000-8000-000000000002',
    reasonCode: 'awareness_confirmed', resultStatus: 'applied', readbackStatus: 'passed',
    auditId: '00000000-0000-4000-8000-' + String(index + 101).padStart(12, '0'),
    createdAt: '2026-11-14T12:00:00.000Z',
  })),
};

export function knowledgeResponsivePayload(secondPage: boolean) {
  const page = secondPage ? 2 : 1;
  return {
    revision: 'a'.repeat(64), generatedAt: '2026-11-14T12:00:00Z',
    coverage: { inventoryCount: null, eligibleCount: null, analyzedCount: 2, pendingCount: null, failedCount: 0, excludedShortsCount: null, asOf: null },
    nodes: [{ id: `node-${page}`, label: `합성 지식 ${page}`, kind: 'hub', summary: '', evidence: [] }],
    edges: [{ id: `edge-${page}`, source: `node-${page}`, target: `node-${page}`, relation: 'references' }],
    selected: null, totalNodes: 2, totalEdges: 2, filteredTotal: 2, omittedEdges: 1, edgePageTotal: 2,
    nextCursor: secondPage ? null : 'cursor-2', nextEdgeCursor: 'edge-2',
  };
}
