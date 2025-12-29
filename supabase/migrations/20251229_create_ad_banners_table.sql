-- 광고 배너 테이블 생성
-- 사이드바 및 모바일/태블릿 팝업에서 표시되는 광고 배너를 관리합니다.

CREATE TABLE IF NOT EXISTS ad_banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,
    display_target TEXT[] NOT NULL DEFAULT ARRAY['sidebar', 'mobile_popup'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_ad_banners_is_active ON ad_banners(is_active);
CREATE INDEX IF NOT EXISTS idx_ad_banners_priority ON ad_banners(priority DESC);
CREATE INDEX IF NOT EXISTS idx_ad_banners_display_target ON ad_banners USING GIN(display_target);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_ad_banners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ad_banners_updated_at ON ad_banners;
CREATE TRIGGER trigger_ad_banners_updated_at
    BEFORE UPDATE ON ad_banners
    FOR EACH ROW
    EXECUTE FUNCTION update_ad_banners_updated_at();

-- RLS 활성화
ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 모든 사용자가 활성화된 배너 조회 가능
CREATE POLICY "ad_banners_select_active" ON ad_banners
    FOR SELECT
    USING (is_active = true);

-- RLS 정책: 관리자만 모든 배너 조회 가능
CREATE POLICY "ad_banners_select_admin" ON ad_banners
    FOR SELECT
    USING (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 생성 가능
CREATE POLICY "ad_banners_insert_admin" ON ad_banners
    FOR INSERT
    WITH CHECK (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 수정 가능
CREATE POLICY "ad_banners_update_admin" ON ad_banners
    FOR UPDATE
    USING (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 삭제 가능
CREATE POLICY "ad_banners_delete_admin" ON ad_banners
    FOR DELETE
    USING (public.is_user_admin(auth.uid()));

-- 초기 더미 데이터 (선택적)
INSERT INTO ad_banners (title, description, display_target, priority, is_active)
VALUES 
    ('광고주 모집', '귀하의 맛집을\n천하에 널리 알리옵소서', ARRAY['sidebar', 'mobile_popup'], 100, true),
    ('명당 자리', '수많은 미식가들이\n오가는 길목이옵니다', ARRAY['sidebar', 'mobile_popup'], 90, true),
    ('동반 성장', '쯔동여지도와 더불어\n큰 뜻을 펼치시옵소서', ARRAY['sidebar', 'mobile_popup'], 80, true);

-- 코멘트 추가
COMMENT ON TABLE ad_banners IS '광고 배너 테이블 - 사이드바 및 모바일/태블릿 팝업에서 표시';
COMMENT ON COLUMN ad_banners.display_target IS '표시 위치: sidebar, mobile_popup';
COMMENT ON COLUMN ad_banners.priority IS '우선순위 (높을수록 먼저 표시)';
