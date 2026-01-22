'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export default function ResetPasswordPage() {
    const router = useRouter();
    const { updatePassword } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isValidSession, setIsValidSession] = useState(false);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        const handleRecoverySession = async () => {
            // 1. URL 파라미터 확인 (Hash 및 Query 모두 확인)
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const queryParams = new URLSearchParams(window.location.search);

            const type = hashParams.get('type') || queryParams.get('type');
            const accessToken = hashParams.get('access_token');
            const code = queryParams.get('code');

            // 2. 이벤트 리스너 설정 (PKCE Flow 등에서 발생)
            const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
                if (event === 'PASSWORD_RECOVERY' || (session && type === 'recovery')) {
                    setIsValidSession(true);
                    setIsCheckingSession(false);
                }
            });

            // 3. 현재 세션 상태 확인
            const { data: { session } } = await supabase.auth.getSession();

            if (session && type === 'recovery') {
                setIsValidSession(true);
                setIsCheckingSession(false);
            } else if (accessToken || code) {
                // 토큰/코드가 있지만 세션이 아직 없는 경우 (처리 중)
                // onAuthStateChange에서 처리되기를 기다림
                // 3초 후에도 세션이 없으면 에러 처리
                setTimeout(async () => {
                    const { data: { session: retrySession } } = await supabase.auth.getSession();
                    if (retrySession) {
                        setIsValidSession(true);
                    } else if (!isValidSession) { // 이미 유효해졌으면 무시
                        // PKCE의 경우 코드가 교환되면 세션이 생김.
                        // 하지만 sometimes code exchange fails or happens on main layout.
                        // 여기서는 UI를 보여주되, updatePassword 호출 시 에러가 나면 처리.
                        if (code) {
                            // 코드가 있으면 조금 더 기다려볼 수도 있지만,
                            // 일단 UI를 보여주는 게 나을 수 있음 (세션이 곧 생길 것이라 가정)
                            // 하지만 안전하게 로그인 페이지로 보내는 게 나을 수도.
                            // 여기서는 세션 확인 실패로 간주.
                            // toast.error('세션 연결 시간이 초과되었습니다.');
                        }
                    }
                    setIsCheckingSession(false);
                }, 3000);
            } else {
                // 아무 토큰도 없는 경우
                setIsCheckingSession(false);
            }

            return () => {
                subscription.unsubscribe();
            };
        };

        handleRecoverySession();
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!newPassword || !confirmPassword) {
            toast.error('모든 필드를 입력해주세요');
            return;
        }

        if (newPassword.length < 8 || newPassword.length > 12) {
            toast.error('비밀번호는 8자 이상 12자 이하여야 합니다');
            return;
        }

        if (newPassword !== confirmPassword) {
            toast.error('비밀번호가 일치하지 않습니다');
            return;
        }

        setIsLoading(true);
        try {
            await updatePassword(newPassword);
            toast.success('비밀번호가 성공적으로 변경되었습니다');
            setIsOpen(false);
            router.push('/');
        } catch (error) {
            console.error('Password update error:', error);
            const errorMessage = error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다';
            toast.error(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        router.push('/');
    };

    if (isCheckingSession) {
        return (
            <Dialog open={true}>
                <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl">
                    <VisuallyHidden>
                        <DialogTitle>세션 확인 중</DialogTitle>
                    </VisuallyHidden>
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                        <p className="text-muted-foreground text-sm sm:text-base">세션 확인 중...</p>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    if (!isValidSession) {
        return null;
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl">
                <DialogHeader className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-primary rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-xl sm:text-2xl">🔥</span>
                        </div>
                        <DialogTitle className="text-xl sm:text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            쯔동여지도
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-sm">
                        새로운 비밀번호를 입력해주세요
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                    <div className="space-y-2">
                        <Label htmlFor="new-password" className="text-sm">새 비밀번호</Label>
                        <Input
                            id="new-password"
                            type="password"
                            placeholder="••••••••"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                            enterKeyHint="next"
                            className="h-10 sm:h-11"
                        />
                        <p className="text-xs text-muted-foreground">
                            8자 이상 12자 이하로 입력해주세요
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirm-new-password" className="text-sm">새 비밀번호 확인</Label>
                        <Input
                            id="confirm-new-password"
                            type="password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            enterKeyHint="done"
                            className="h-10 sm:h-11"
                        />
                    </div>
                    <Button
                        type="submit"
                        className="w-full h-10 sm:h-11 bg-gradient-primary hover:opacity-90 text-sm sm:text-base"
                        disabled={isLoading}
                    >
                        {isLoading ? '변경 중...' : '비밀번호 변경'}
                    </Button>
                </form>

                <p className="text-xs text-center text-muted-foreground pt-2">
                    비밀번호 변경 후 자동으로 메인 페이지로 이동합니다
                </p>
            </DialogContent>
        </Dialog>
    );
}

