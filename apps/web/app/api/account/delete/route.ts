import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

// Supabase Admin 클라이언트 (서비스 역할 키 사용)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // 환경 변수에 서비스 역할 키 필요
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const requestedUserId = typeof body?.userId === 'string' ? body.userId : null;
        const targetUserId = (requestedUserId || user.id).trim();

        if (!targetUserId) {
            return NextResponse.json({ error: '사용자 ID가 필요합니다' }, { status: 400 });
        }

        // Only allow deleting a different user if the requester is admin.
        if (targetUserId !== user.id) {
            const auth = await requireAdmin();
            if (!auth.ok) return auth.response;
        }

        // 1. 프로필 익명화
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({ nickname: '탈퇴한 사용자' })
            .eq('user_id', targetUserId);

        if (profileError) {
            console.warn('프로필 익명화 실패:', profileError);
        }

        // 2. user_stats 삭제
        const { error: statsError } = await supabaseAdmin
            .from('user_stats')
            .delete()
            .eq('user_id', targetUserId);

        if (statsError) {
            console.warn('통계 정보 삭제 실패:', statsError);
        }

        // 3. user_roles 삭제
        const { error: rolesError } = await supabaseAdmin
            .from('user_roles')
            .delete()
            .eq('user_id', targetUserId);

        if (rolesError) {
            console.warn('역할 정보 삭제 실패:', rolesError);
        }

        // 4. 북마크 삭제
        const { error: bookmarksError } = await supabaseAdmin
            .from('restaurant_bookmarks')
            .delete()
            .eq('user_id', targetUserId);

        if (bookmarksError) {
            console.warn('북마크 삭제 실패:', bookmarksError);
        }

        // 5. 알림 삭제
        const { error: notificationsError } = await supabaseAdmin
            .from('notifications')
            .delete()
            .eq('user_id', targetUserId);

        if (notificationsError) {
            console.warn('알림 삭제 실패:', notificationsError);
        }

        // 6. Supabase Auth에서 완전 삭제
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

        if (deleteError) {
            console.error('사용자 삭제 실패:', deleteError);
            return NextResponse.json(
                { error: '사용자 계정 삭제에 실패했습니다' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('계정 삭제 중 오류:', error);
        return NextResponse.json(
            { error: '서버 오류가 발생했습니다' },
            { status: 500 }
        );
    }
}
