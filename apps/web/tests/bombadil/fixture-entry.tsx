import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeviceLocationDisclosure } from '@/components/home/DeviceLocationDisclosure';
import { HomeMapThemeFilters } from '@/components/home/HomeMapThemeFilters';
import { HomeMapRegionFilter } from '@/components/home/HomeMapRegionFilter';
import { MapThemeNotice } from '@/components/map/MapThemeNotice';
import { AdminPerformanceAudit, AdminPerformanceAuditSkeleton } from '@/components/admin/performance/AdminPerformanceAudit';
import { ThumbnailBriefEditor } from '@/components/admin/thumbnail-generator/ThumbnailBriefEditor';
import { StoryboardComicBoard } from '@/components/admin/storyboard/StoryboardComicBoard';
import { StoryboardConversation } from '@/components/admin/storyboard/StoryboardConversation';
import { StoryboardWorkspaceSkeleton } from '@/components/admin/storyboard/StoryboardWorkspaceSkeleton';
import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import type { HomeMapResultSummary } from '@/lib/home-map-result-summary';
import type { ThumbnailReferenceRole } from '@/lib/admin/youtube-thumbnail-generator/reference-selection';

// These are real imported UI components, isolated from application auth, DB,
// providers and production routing. Callbacks only change fixture memory.
const views = ['home', 'performance', 'thumbnail', 'storyboard', 'skeleton'] as const;
type View = typeof views[number];
const titles: Record<View, string> = {
  home: '홈 지도 컨트롤', performance: '웹 성능 감사',
  thumbnail: '썸네일 구성', storyboard: '스토리보드', skeleton: '불러오기 상태',
};
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO1sAAAAASUVORK5CYII=';
const summary: HomeMapResultSummary = {
  active: false, status: 'ready', restaurants: [], count: 3,
  regionCounts: {}, countryCounts: {}, categoryCounts: {},
};

function HomeControls() {
  const [theme, setTheme] = useState<HomeMapThemeFilterId | null>(null);
  const [mode, setMode] = useState<'domestic' | 'overseas'>('domestic');
  const [region, setRegion] = useState('all');
  const [confirmations, setConfirmations] = useState(0);
  const options = mode === 'domestic'
    ? [{ value: 'all', label: '전체 지역', count: 3 }, { value: 'seoul', label: '서울', count: 2 }, { value: 'busan', label: '부산', count: 1 }]
    : [{ value: 'all', label: '전체 국가', count: 3 }, { value: 'japan', label: '일본', count: 2 }, { value: 'usa', label: '미국', count: 1 }];
  return <section className="mx-auto grid w-full max-w-3xl gap-6 p-4" data-home-fixture
    data-active-theme={theme ?? ''} data-mode={mode} data-region={region}
    data-location-confirmations={confirmations}>
    <h2 className="text-xl font-semibold">홈 지도 컨트롤</h2>
    <p>지역·건수는 합성 데이터입니다. 지도 제공자, 위치 API와 데이터베이스를 호출하지 않습니다.</p>
    <HomeMapThemeFilters activeThemeId={theme} onThemeChange={setTheme} layout="reel" />
    {theme && <MapThemeNotice themeId={theme} />}
    <div className="flex gap-2" role="group" aria-label="지도 범위">
      {(['domestic', 'overseas'] as const).map(value => <button key={value} type="button"
        className="min-h-11 rounded border px-4" aria-pressed={mode === value}
        onClick={() => { setMode(value); setRegion('all'); }}>
        {value === 'domestic' ? '국내' : '해외'}
      </button>)}
    </div>
    <HomeMapRegionFilter mapMode={mode} value={region} options={options}
      resultSummary={summary} onValueChange={setRegion} />
    <DeviceLocationDisclosure id="fixture-location-disclosure" onConfirm={() => setConfirmations(value => value + 1)}>
      <button type="button" className="min-h-11 rounded border px-4">현재 위치 안내 열기</button>
    </DeviceLocationDisclosure>
    <output aria-label="위치 확인 콜백 횟수">확인 콜백 {confirmations}회 · 실제 위치 요청 0회</output>
  </section>;
}

function ThumbnailControls() {
  const [topic, setTopic] = useState('동네 시장의 한 상');
  const [headline, setHeadline] = useState('시장에서 한 끼');
  const [subHeadline, setSubHeadline] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [roles, setRoles] = useState<ThumbnailReferenceRole[]>([]);
  const [previews, setPreviews] = useState(0);
  return <section className="mx-auto grid w-full max-w-4xl gap-4 p-4" data-thumbnail-fixture
    data-reference-count={files.length} data-role-count={roles.length} data-preview-count={previews}>
    <h2 className="text-xl font-semibold">썸네일 구성</h2>
    <p>참고이미지는 합성 PNG만 사용합니다. 미리보기는 콜백 횟수만 기록하고 이미지를 생성하지 않습니다.</p>
    <ThumbnailBriefEditor topic={topic} headline={headline} subHeadline={subHeadline}
      files={files} roles={roles} disabled={false} error={null}
      onTopicChange={setTopic} onHeadlineChange={setHeadline} onSubHeadlineChange={setSubHeadline}
      onAddReferences={() => {
        if (files.length >= 3) return;
        const bytes = Uint8Array.from(atob(pixel), value => value.charCodeAt(0));
        setFiles(previous => [...previous, new File([bytes], `synthetic-${previous.length + 1}.png`, { type: 'image/png' })]);
        setRoles(previous => [...previous, 'food']);
      }}
      onRemoveReference={index => {
        setFiles(previous => previous.filter((_, current) => current !== index));
        setRoles(previous => previous.filter((_, current) => current !== index));
      }}
      onReferenceRoleChange={(index, role) => setRoles(previous => previous.map((value, current) => current === index ? role : value))}
      onPreview={() => setPreviews(value => value + 1)} />
    <output aria-label="미리보기 콜백 횟수">미리보기 콜백 {previews}회 · 생성 요청 0회</output>
  </section>;
}

function StoryboardControls() {
  const [selected, setSelected] = useState(1);
  const scenes = Array.from({ length: 6 }, (_, index) => ({
    sceneNo: index + 1, title: `시장 이야기 ${index + 1}`,
    description: '합성 장면: 시장 골목에서 음식을 소개합니다.',
    caption: '합성 장면입니다. 생성 요청은 실행하지 않습니다.', durationSec: 5,
  }));
  return <section className="mx-auto grid w-full max-w-6xl gap-4 p-4" data-storyboard-fixture data-selected-scene={selected}>
    <h2 className="text-xl font-semibold">스토리보드</h2>
    <p>장면은 합성 데이터입니다. 대화 연결은 로컬 mock의 구성 미완료 상태이며, 메시지·제작 요청을 보내지 않습니다.</p>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <StoryboardComicBoard scenes={scenes} selectedScene={selected} onSelect={setSelected} />
      <StoryboardConversation context={{ prompt: '시장을 소개하는 합성 이야기', scene: null }}
        sceneCount={6} onUsePrompt={() => {}} />
    </div>
  </section>;
}

function Fixture() {
  const readView = (): View => {
    const hash = window.location.hash.slice(1);
    return views.includes(hash as View) ? hash as View : 'home';
  };
  const [view, setView] = useState<View>(readView);
  useEffect(() => {
    const change = () => setView(readView());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground" data-bombadil-fixture="ready" data-view={view}>
    <header className="shrink-0 border-b p-3">
      <h1 className="text-base font-semibold">쯔동 UI 컴포넌트 QA</h1>
      <p className="mt-1 text-xs text-muted-foreground">로컬 독립 fixture · 실제 컴포넌트 · 운영 인증/DB/생성 검증 아님</p>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label="QA 화면">
        {views.map(value => <a key={value} className="inline-flex min-h-10 items-center rounded border px-3 text-sm"
          href={`#${value}`} aria-current={view === value ? 'page' : undefined}>{titles[value]}</a>)}
      </nav>
    </header>
    <main className="min-h-0 min-w-0 flex-1 overflow-auto">
      {view === 'home' && <HomeControls />}
      {view === 'performance' && <AdminPerformanceAudit />}
      {view === 'thumbnail' && <ThumbnailControls />}
      {view === 'storyboard' && <StoryboardControls />}
      {view === 'skeleton' && <div className="grid gap-4 p-4 lg:grid-cols-2"><AdminPerformanceAuditSkeleton /><StoryboardWorkspaceSkeleton /></div>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
