export const LOCAL_WORKSPACE_BANNER_HEIGHT_CSS = '1.75rem';

export function LocalWorkspaceBanner() {
  if (process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME !== '1') return null;
  const offlineMap = process.env.NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL === '/__local/naver-maps.js';

  return (
    <p
      className="shrink-0 border-b border-amber-300 bg-amber-200 px-3 py-1 text-center text-[12px] font-medium leading-5 text-amber-950"
      data-local-workspace-banner="true"
      role="status"
    >
      로컬 작업장 · 지도에는 승인된 맛집이 표시됩니다. 로컬 변경은 검토 후 운영에 반영합니다.
      {offlineMap ? ' 테스트 지도 사용 중 · 실제 도로와 지명은 표시되지 않습니다.' : null}
    </p>
  );
}
