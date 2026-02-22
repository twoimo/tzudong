-- 공지사항 테이블 생성 및 초기 데이터 이관
-- - 신규 테이블 생성
-- - 기존 announcements 테이블(legacy 컬럼) 호환 보정
-- - RLS 정책/인덱스 설정
-- - 프론트 목업 데이터 10건 시드

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    show_on_banner boolean NOT NULL DEFAULT false,
    priority integer NOT NULL DEFAULT 0,
    created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- legacy: message -> content
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'message'
    ) THEN
        EXECUTE 'ALTER TABLE public.announcements RENAME COLUMN message TO content';
    END IF;
END $$;

-- legacy: admin_id -> created_by (created_by가 없는 경우에만 rename)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'admin_id'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'created_by'
    ) THEN
        EXECUTE 'ALTER TABLE public.announcements RENAME COLUMN admin_id TO created_by';
    END IF;
END $$;

ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS content text,
    ADD COLUMN IF NOT EXISTS show_on_banner boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by uuid,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- legacy: message 컬럼이 content와 함께 남아있을 때 데이터 병합 후 제거
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'message'
    ) THEN
        EXECUTE '
            UPDATE public.announcements
            SET content = COALESCE(NULLIF(content, ''''), message, ''[공지 내용 없음]'')
        ';
        EXECUTE 'ALTER TABLE public.announcements DROP COLUMN message';
    END IF;
END $$;

-- legacy: admin_id 컬럼이 created_by와 함께 남아있을 때 데이터 병합 후 제거
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'admin_id'
    ) THEN
        EXECUTE '
            UPDATE public.announcements
            SET created_by = COALESCE(created_by, admin_id)
            WHERE admin_id IS NOT NULL
        ';
        EXECUTE 'ALTER TABLE public.announcements DROP COLUMN admin_id';
    END IF;
END $$;

-- legacy data(JSONB) -> 신규 컬럼 보정
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'announcements'
          AND column_name = 'data'
    ) THEN
        EXECUTE '
            UPDATE public.announcements
            SET show_on_banner = COALESCE((data->>''showOnBanner'')::boolean, show_on_banner, false),
                priority = COALESCE((data->>''priority'')::integer, priority, 0)
            WHERE data IS NOT NULL
        ';
    END IF;
END $$;

UPDATE public.announcements
SET
    content = COALESCE(NULLIF(content, ''), '[공지 내용 없음]'),
    show_on_banner = COALESCE(show_on_banner, false),
    priority = COALESCE(priority, 0),
    created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

ALTER TABLE public.announcements
    ALTER COLUMN title SET NOT NULL,
    ALTER COLUMN content SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL,
    ALTER COLUMN show_on_banner SET NOT NULL,
    ALTER COLUMN priority SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.announcements
    ALTER COLUMN show_on_banner SET DEFAULT false,
    ALTER COLUMN priority SET DEFAULT 0,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();

-- legacy json 컬럼 제거
ALTER TABLE public.announcements
    DROP COLUMN IF EXISTS data;

-- FK 보정
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'announcements_created_by_fkey'
    ) THEN
        ALTER TABLE public.announcements
            ADD CONSTRAINT announcements_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 체크 제약 보정
ALTER TABLE public.announcements
    DROP CONSTRAINT IF EXISTS announcements_title_check,
    DROP CONSTRAINT IF EXISTS announcements_message_check,
    DROP CONSTRAINT IF EXISTS announcements_title_length_check,
    DROP CONSTRAINT IF EXISTS announcements_content_length_check,
    DROP CONSTRAINT IF EXISTS announcements_priority_range_check;

ALTER TABLE public.announcements
    ADD CONSTRAINT announcements_title_length_check
        CHECK (char_length(title) BETWEEN 1 AND 100),
    ADD CONSTRAINT announcements_content_length_check
        CHECK (char_length(content) >= 1),
    ADD CONSTRAINT announcements_priority_range_check
        CHECK (priority BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION public.update_announcements_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_announcements_updated_at ON public.announcements;
DROP TRIGGER IF EXISTS update_announcements_updated_at ON public.announcements;

CREATE TRIGGER trigger_announcements_updated_at
    BEFORE UPDATE ON public.announcements
    FOR EACH ROW
    EXECUTE FUNCTION public.update_announcements_updated_at();

CREATE INDEX IF NOT EXISTS idx_announcements_active_priority
    ON public.announcements (priority DESC, created_at DESC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_announcements_banner_priority
    ON public.announcements (priority DESC, created_at DESC)
    WHERE is_active = true AND show_on_banner = true;

CREATE INDEX IF NOT EXISTS idx_announcements_created_by
    ON public.announcements (created_by)
    WHERE created_by IS NOT NULL;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Announcements select policy" ON public.announcements;
DROP POLICY IF EXISTS "Admins can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
DROP POLICY IF EXISTS announcements_select_policy ON public.announcements;
DROP POLICY IF EXISTS announcements_insert_admin ON public.announcements;
DROP POLICY IF EXISTS announcements_update_admin ON public.announcements;
DROP POLICY IF EXISTS announcements_delete_admin ON public.announcements;

CREATE POLICY announcements_select_policy
    ON public.announcements
    FOR SELECT
    USING (is_active = true OR public.is_user_admin((SELECT auth.uid())));

CREATE POLICY announcements_insert_admin
    ON public.announcements
    FOR INSERT
    WITH CHECK (public.is_user_admin((SELECT auth.uid())));

CREATE POLICY announcements_update_admin
    ON public.announcements
    FOR UPDATE
    USING (public.is_user_admin((SELECT auth.uid())))
    WITH CHECK (public.is_user_admin((SELECT auth.uid())));

CREATE POLICY announcements_delete_admin
    ON public.announcements
    FOR DELETE
    USING (public.is_user_admin((SELECT auth.uid())));

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
    '쯔동여지도 v2.0 업데이트 안내',
    $a1$안녕하세요, 쯔동여지도입니다!

오랫동안 준비해온 대규모 업데이트를 드디어 공개합니다. 이번 업데이트에서는 사용자분들의 피드백을 적극 반영하여 더욱 편리하고 다양한 기능을 제공합니다.

해외 맛집 지도 기능이 추가되어 쯔양이 방문한 해외 맛집들도 이제 지도에서 확인할 수 있습니다. 일본, 태국, 베트남 등 다양한 국가의 맛집 정보를 제공하며, 구글 지도 기반으로 정확한 위치를 안내합니다.

리뷰 인증샷 업로드 기능도 추가되었습니다. 맛집 방문 후 인증샷을 업로드하면 특별한 뱃지를 획득할 수 있습니다.

맛집 도장깨기 시스템으로 전국의 쯔양 맛집을 도장깨기 형식으로 방문해보세요. 지역별, 카테고리별 도장을 모두 모으면 특별한 칭호가 부여됩니다.

앞으로도 더 나은 서비스를 위해 노력하겠습니다. 많은 이용 부탁드립니다!$a1$,
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

COMMIT;
