import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin restaurant modal presentation source contract', () => {
  test('detail gear edit uses mobile bottom sheet and desktop draggable map panel', () => {
    const adminModalSource = source('components/admin/AdminRestaurantModal.tsx');
    const sidePanelsSource = source('app/home-client-sidepanels.tsx');

    expect(adminModalSource).toContain("presentation?: 'auto' | 'map-panel'");
    expect(adminModalSource).toContain('useImmediateMobileOrTablet');
    expect(adminModalSource).toContain('<BottomSheet');
    expect(adminModalSource).toContain('layoutSource="admin-restaurant-modal"');
    expect(adminModalSource).toContain('aria-label="맛집 수정 상태 요약"');
    expect(adminModalSource).toContain('aria-label="맛집 수정 단계 진행률"');
    expect(adminModalSource).toContain('renderAdminRestaurantSection');
    expect(adminModalSource).toContain('지도에 바로 반영되는 관리자 편집 화면입니다.');
    expect(adminModalSource).toContain('1. 기본 정보');
    expect(adminModalSource).toContain('2. 주소와 좌표');
    expect(adminModalSource).toContain('3. 유튜브 링크 & 쯔양 리뷰');
    expect(adminModalSource).toContain('네이버 주소 검색');
    expect(adminModalSource).toContain('지도에서는 즉시 숨겨지며');
    expect(adminModalSource).toContain('w-[min(420px,calc(100vw-2rem))]');
    expect(adminModalSource).not.toContain('w-[min(460px,calc(100vw-2rem))]');
    expect(adminModalSource).toContain('data-desktop-map-admin-restaurant-panel="true"');
    expect(adminModalSource).toContain('aria-modal="true"');
    expect(adminModalSource).toContain('handleDesktopAdminRestaurantDialogKeyDown');
    expect(adminModalSource).toContain('data-desktop-map-admin-restaurant-drag-handle');
    expect(adminModalSource).toContain('tabIndex={shouldRenderMapPanel ? 0 : undefined}');
    expect(adminModalSource).toContain('aria-label={shouldRenderMapPanel ? "맛집 수정 창 이동 핸들" : undefined}');
    expect(adminModalSource).toContain('handleDesktopAdminRestaurantPanelPointerDown');
    expect(adminModalSource).not.toContain('onKeyDown={handleDesktopAdminRestaurantPanelKeyDown}\\n                >');
    expect(adminModalSource).toContain('setPointerCapture');
    expect(adminModalSource).toContain(
      'translate3d(${desktopAdminRestaurantPanelPosition.x}px, ${desktopAdminRestaurantPanelPosition.y}px, 0)',
    );
    expect(sidePanelsSource).toContain(
      "presentation={isMobileOrTablet ? 'auto' : 'map-panel'}",
    );
  });
});
