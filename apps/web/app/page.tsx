// [SSR] 서버 컴포넌트 - SEO 메타데이터와 홈 앱 런타임
import type { Metadata } from 'next';
import { HomeInitialShell } from './home-initial-shell';

// [SSR] 메타데이터 생성 - 검색 엔진 최적화
export const metadata: Metadata = {
    title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
    description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요. 지역별, 카테고리별로 맛집을 검색하고 리뷰를 확인할 수 있습니다.',
    keywords: ['쯔양', '맛집', '맛집지도', '음식', '레스토랑', '쯔양맛집'],
    openGraph: {
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-20260213.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        images: ['/og-image-20260213.png'],
    },
};

function HomeDeepLinkPreview() {
    return (
        <aside
            id="home-deep-link-preview"
            hidden
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] min-[1024px]:left-auto min-[1024px]:right-0 min-[1024px]:top-[var(--app-header-height,56px)] min-[1024px]:h-[calc(100vh-var(--app-header-height,56px))] min-[1024px]:w-[400px]"
        >
            <div className="h-[50vh] rounded-t-2xl border border-border bg-background px-4 py-5 shadow-xl min-[1024px]:h-full min-[1024px]:rounded-none min-[1024px]:border-l">
                <div className="mx-auto mb-3 h-1 w-8 rounded-full bg-muted-foreground/40 min-[1024px]:hidden" />
                <p className="text-xs font-medium text-muted-foreground">맛집 상세</p>
                <h2 className="mt-2 truncate text-xl font-bold">맛집 정보를 준비 중입니다</h2>
                <p className="mt-2 text-sm text-muted-foreground">잠시 후 상세 정보와 지도가 표시됩니다</p>
                <div className="mt-5 space-y-2">
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
            </div>
        </aside>
    );
}

const homeDeepLinkPreviewBootstrap = `
try {
  var params = new URLSearchParams(window.location.search);
  if (params.get('r') || params.get('restaurant')) {
    var preview = document.getElementById('home-deep-link-preview');
    if (preview) preview.hidden = false;
  }
} catch (_) {}
`;

const homeFrameBootstrap = `
try {
  var activated = false;
  var events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  var activate = function () {
    if (activated) return;
    activated = true;
    var shell = document.getElementById('home-initial-shell');
    var preview = document.getElementById('home-deep-link-preview');
    var frame = document.createElement('iframe');
    frame.id = 'home-runtime-frame';
    frame.title = '쯔동여지도 홈';
    frame.src = '/home-frame' + window.location.search + window.location.hash;
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:80;background:white;visibility:hidden';
    frame.addEventListener('load', function () {
      if (shell) shell.hidden = true;
      if (preview) preview.hidden = true;
      frame.style.visibility = 'visible';
    }, { once: true });
    document.body.appendChild(frame);
    events.forEach(function (eventName) { window.removeEventListener(eventName, activate); });
  };
  window.setTimeout(activate, 8000);
  events.forEach(function (eventName) {
    window.addEventListener(eventName, activate, { once: true, passive: true });
  });
} catch (_) {}
`;

// [SSR] 서버 컴포넌트 홈 페이지 - 별도 랜딩 게이트 없이 실제 지도 홈 UI를 바로 렌더합니다.
export default function HomePage() {
    return (
        <>
            <HomeInitialShell />
            <HomeDeepLinkPreview />
            <script dangerouslySetInnerHTML={{ __html: homeDeepLinkPreviewBootstrap }} />
            <script dangerouslySetInnerHTML={{ __html: homeFrameBootstrap }} />
        </>
    );
}
