INSERT INTO public.announcements (
    id,
    title,
    content,
    is_active,
    show_on_banner,
    priority,
    created_at,
    updated_at
) VALUES
(
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Tzudong Map v1.1.1 Release Notes',
    $a1$Hello from Tzudong Map.

Version v1.1.1 focuses on making the public restaurant map, the admin moderation console, and the storyboard generation workspace easier to verify and operate.

The public map keeps the map-first browsing flow with clustered restaurant markers, category filters, region filters, mobile controls, and restaurant detail entry points.

The admin workspace includes guarded review and readback flows, and the storyboard module now surfaces starter examples, generated storyboard images, cut-level metadata, local bridge state, and setup traces more clearly.

AI and RAG-related claims are scoped to verified evidence: deterministic fixtures, explicit local/provider smoke runs, and fail-closed worker readiness checks are tracked separately from experimental RAGAS or LangSmith notes.

Thank you for using Tzudong Map.$a1$,
    true,
    true,
    100,
    '2025-12-01T09:00:00.000Z'::timestamptz,
    '2025-12-01T09:00:00.000Z'::timestamptz
),
(
    'b2c3d4e5-f6a7-8901-bcde-f23456789012',
    '서버 점검 안내 (12/10 02:00~06:00)',
    $a2$서비스 안정화를 위한 정기 서버 점검이 예정되어 있습니다.

점검 일시: 2025년 12월 10일 (화) 02:00 ~ 06:00 (4시간)

점검 내용으로는 데이터베이스 최적화 작업, 보안 업데이트, 서버 인프라 업그레이드가 진행됩니다.

점검 시간 동안 모든 서비스 이용이 불가하며, 로그인, 지도 조회, 리뷰 작성 등 전체 기능이 중단됩니다.

점검 완료 후 모든 사용자에게 특별 뱃지를 지급해 드립니다.

이용에 불편을 드려 죄송하며, 더 나은 서비스로 보답하겠습니다.$a2$,
    true,
    true,
    90,
    '2025-12-03T14:30:00.000Z'::timestamptz,
    '2025-12-03T14:30:00.000Z'::timestamptz
),
(
    'c3d4e5f6-a7b8-9012-cdef-345678901234',
    '12월 맛집 도장깨기 이벤트',
    $a3$12월 한 달간 맛집 도장깨기 이벤트를 진행합니다!

이벤트 기간: 2025년 12월 1일 ~ 31일

참여 방법은 간단합니다. 쯔동여지도에서 맛집을 방문하고, 인증샷과 함께 리뷰를 작성하면 도장이 자동 적립됩니다.

도장 5개 달성 시 브론즈 뱃지와 100포인트, 10개 달성 시 실버 뱃지와 300포인트, 20개 달성 시 골드 뱃지와 500포인트, 30개 달성 시 다이아 뱃지와 1000포인트가 지급됩니다.

많은 참여 부탁드립니다!$a3$,
    true,
    true,
    85,
    '2025-11-28T10:00:00.000Z'::timestamptz,
    '2025-12-01T08:00:00.000Z'::timestamptz
),
(
    'd4e5f6a7-b8c9-0123-def0-456789012345',
    '신규 맛집 50곳 추가 안내',
    $a4$쯔양이 최근 방문한 맛집 50곳이 새롭게 추가되었습니다!

서울 15곳, 경기 12곳, 부산 8곳, 대구 5곳, 기타 지역 10곳이 추가되었습니다.

주요 추가 맛집으로는 강남 횟집(신선한 회와 매운탕), 홍대 떡볶이(로제 떡볶이 맛집), 해운대 밀면(부산 전통 밀면) 등이 있습니다.

지도에서 새로운 맛집들을 확인해보세요!$a4$,
    true,
    false,
    80,
    '2025-12-02T11:00:00.000Z'::timestamptz,
    '2025-12-02T11:00:00.000Z'::timestamptz
),
(
    'e5f6a7b8-c9d0-1234-ef01-567890123456',
    '모바일 앱 출시 예정 안내',
    $a5$쯔동여지도 모바일 앱이 곧 출시됩니다!

출시 예정일: 2025년 1월 중순 (iOS/Android 동시 출시)

사전 등록 시 프리미엄 뱃지 지급, 500 포인트 적립, 앱 전용 이벤트 참여 자격이 주어집니다.

사전 등록은 12월 15일부터 시작됩니다. 많은 관심 부탁드립니다!$a5$,
    true,
    false,
    75,
    '2025-11-30T09:00:00.000Z'::timestamptz,
    '2025-11-30T09:00:00.000Z'::timestamptz
),
(
    'f6a7b8c9-d0e1-2345-f012-678901234567',
    '잘못된 맛집 정보 신고 기능 안내',
    $a6$맛집 정보가 잘못되었거나 폐업한 경우 신고해주세요!

해당 맛집 상세 페이지에서 우측 상단 신고 버튼을 클릭하고, 신고 사유를 선택한 뒤 상세 내용을 작성해주시면 됩니다.

신고 접수 후 24시간 내 확인하며, 확인 완료 시 정보 수정 또는 삭제 후 신고자에게 처리 결과를 알려드립니다.

정확한 정보 유지를 위해 협조 부탁드립니다.$a6$,
    true,
    false,
    70,
    '2025-11-25T14:00:00.000Z'::timestamptz,
    '2025-11-25T14:00:00.000Z'::timestamptz
),
(
    'a7b8c9d0-e1f2-3456-0123-789012345678',
    '크리스마스 특별 이벤트',
    $a7$크리스마스를 맞아 특별 이벤트를 진행합니다!

12월 24일~25일 맛집 방문 인증 시 크리스마스 한정 뱃지가 지급되고, 리뷰 작성 시 포인트가 2배로 적립됩니다. 추첨을 통해 10명에게 기프티콘도 증정합니다.

맛집 방문 후 인증샷과 함께 리뷰를 작성해주세요!$a7$,
    true,
    false,
    65,
    '2025-11-20T10:00:00.000Z'::timestamptz,
    '2025-11-20T10:00:00.000Z'::timestamptz
),
(
    'b8c9d0e1-f2a3-4567-1234-890123456789',
    '포인트 사용처 확대 안내',
    $a8$적립한 포인트를 더 다양하게 사용할 수 있게 되었습니다!

기존 뱃지 교환 외에도 기프티콘 교환, 제휴 맛집 할인 쿠폰 교환이 가능해졌습니다. 마이페이지의 포인트샵에서 확인해보세요.

12월 한정으로 포인트 사용 시 10% 추가 할인도 진행 중입니다!$a8$,
    true,
    false,
    60,
    '2025-11-18T16:00:00.000Z'::timestamptz,
    '2025-11-18T16:00:00.000Z'::timestamptz
),
(
    'c9d0e1f2-a3b4-5678-2345-901234567890',
    '리뷰 작성 기능 개선 안내',
    $a9$리뷰 작성 기능이 더욱 편리해졌습니다!

사진 첨부 시 자동 압축 기능이 추가되어 대용량 사진도 빠르게 업로드할 수 있습니다. 임시저장 기능도 추가되어 작성 중인 리뷰가 사라지지 않습니다.

더 나은 리뷰 작성 경험을 제공하기 위해 계속 노력하겠습니다.$a9$,
    false,
    false,
    55,
    '2025-11-15T11:00:00.000Z'::timestamptz,
    '2025-11-15T11:00:00.000Z'::timestamptz
),
(
    'd0e1f2a3-b4c5-6789-3456-012345678901',
    '위치 기반 맛집 추천 기능 추가',
    $a10$현재 위치를 기반으로 주변 맛집을 추천해드립니다!

위치 권한을 허용하면 현재 위치에서 가까운 쯔양 추천 맛집을 거리순으로 확인할 수 있습니다. 카테고리별 필터링도 가능합니다.

지도 화면 우측 하단의 내 위치 버튼을 눌러보세요!$a10$,
    false,
    false,
    50,
    '2025-11-10T09:00:00.000Z'::timestamptz,
    '2025-11-10T09:00:00.000Z'::timestamptz
)
ON CONFLICT (id) DO UPDATE
SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    is_active = EXCLUDED.is_active,
    show_on_banner = EXCLUDED.show_on_banner,
    priority = EXCLUDED.priority,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;
