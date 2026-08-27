export const LOCAL_WORKSPACE_BANNER_HEIGHT_CSS = '1.75rem';

export function LocalWorkspaceBanner() {
  if (process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME !== '1') return null;

  return (
    <p
      className="shrink-0 border-b border-amber-300 bg-amber-200 px-3 py-1 text-center text-[12px] font-medium leading-5 text-amber-950"
      data-local-workspace-banner="true"
      role="status"
    >
      로컬 작업장입니다. 이 DB는 nightly 픽스처 2곳과 로컬 pending만 있습니다. backend/data/recovery 에는 크롤 재조정 매니페스트만 있고 프로덕션 restaurants 덤프는 없습니다. 공개 지도는 approved만, 프로덕션 추가는 Preview→Confirm→Apply입니다.
    </p>
  );
}
