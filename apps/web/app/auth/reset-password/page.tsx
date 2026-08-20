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
import { Button } from '@/components/ui/button';
import { ResetPasswordProgressiveSkeleton } from '@/components/auth/ResetPasswordProgressiveSkeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/no-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DEBUG_LOG_EVENT, DEBUG_LOG_REASON_CODE, debugLog } from '@/lib/debug-log';
import { consumePasswordRecoveryProof } from '@/lib/auth/password-recovery-proof';

function hasValidRecoveryQuery(searchParams: URLSearchParams) {
    const keys = [...searchParams.keys()];
    if (new Set(keys).size !== keys.length) return false;
    if (keys.some((key) => !['code', 'token', 'token_hash', 'type'].includes(key))) return false;

    const code = searchParams.get('code');
    const token = searchParams.get('token');
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');
    if ((code ? 1 : 0) + (token ? 1 : 0) + (tokenHash ? 1 : 0) > 1) return false;
    if (code || token) return (code ?? token)!.length <= 2048 && (type === null || type === 'recovery');
    if (tokenHash) return tokenHash.length <= 2048 && type === 'recovery';
    return keys.length === 0;
}

function hasValidRecoveryFragment(hashParams: URLSearchParams) {
    const keys = [...hashParams.keys()];
    const accessToken = hashParams.get('access_token');
    return keys.length > 0
        && keys.every((key) => (
            key === 'access_token'
            || key === 'refresh_token'
            || key === 'expires_in'
            || key === 'token_type'
            || key === 'type'
        ))
        && hashParams.getAll('access_token').length === 1
        && hashParams.getAll('type').length === 1
        && hashParams.get('type') === 'recovery'
        && typeof accessToken === 'string'
        && accessToken.length > 0
        && accessToken.length <= 4096;
}

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
            if (!hasValidRecoveryQuery(queryParams) || !hasValidRecoveryFragment(hashParams) && hashParams.size > 0) {
                setIsCheckingSession(false);
                return;
            }

            const type = hashParams.get('type') || queryParams.get('type');
            const accessToken = hasValidRecoveryFragment(hashParams)
                ? hashParams.get('access_token')
                : null;
            const code = queryParams.get('code');
            const token = queryParams.get('token');
            const tokenHash = queryParams.get('token_hash');

            // 2. 이벤트 리스너 설정 (PKCE Flow 등에서 발생)
            const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
                if (event === 'PASSWORD_RECOVERY') {
                    setIsValidSession(true);
                    setIsCheckingSession(false);
                }
            });

            // A successful exchange alone is not recovery authority. Only the
            // provider PASSWORD_RECOVERY event above enables password updates.
            if (code && (type === 'recovery' || type === null)) {
                try {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                } catch {
                    debugLog(DEBUG_LOG_EVENT.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED, {
                        reason: DEBUG_LOG_REASON_CODE.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED,
                    });
                }
            } else if (token && (type === 'recovery' || type === null)) {
                try {
                    const { error } = await supabase.auth.exchangeCodeForSession(token);
                    if (error) throw error;
                } catch {
                    debugLog(DEBUG_LOG_EVENT.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED, {
                        reason: DEBUG_LOG_REASON_CODE.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED,
                    });
                }
            } else if (tokenHash && type === 'recovery') {
                try {
                    const { error } = await supabase.auth.verifyOtp({
                        type: 'recovery',
                        token_hash: tokenHash,
                    });
                    if (error) throw error;
                } catch {
                    debugLog(DEBUG_LOG_EVENT.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED, {
                        reason: DEBUG_LOG_REASON_CODE.PASSWORD_RECOVERY_CODE_EXCHANGE_FAILED,
                    });
                }
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id && consumePasswordRecoveryProof(session.user.id)) {
                setIsValidSession(true);
                setIsCheckingSession(false);
            }

            if (accessToken || code || token || tokenHash) {
                setTimeout(() => {
                    setIsCheckingSession(false);
                }, 3000);
            } else {
                setIsCheckingSession(false);
            }

            return () => {
                subscription.unsubscribe();
            };
        };

        void handleRecoverySession().catch(() => {
            debugLog(DEBUG_LOG_EVENT.PASSWORD_RECOVERY_SESSION_CHECK_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.PASSWORD_RECOVERY_SESSION_CHECK_FAILED,
            });
            setIsValidSession(false);
            setIsCheckingSession(false);
        });
    }, [router, isValidSession]);

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
        } catch {
            debugLog(DEBUG_LOG_EVENT.PASSWORD_UPDATE_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.PASSWORD_UPDATE_FAILED,
            });
            toast.error('비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        router.push('/');
    };

    if (isCheckingSession) {
        return <ResetPasswordProgressiveSkeleton />;
    }

    if (!isValidSession) {
        return (
            <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10">
                <div className="w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-foreground">비밀번호 재설정 링크를 확인해주세요</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        이 페이지는 이메일로 받은 비밀번호 재설정 링크를 통해 접속해야 사용할 수 있습니다. 링크가 만료되었거나 잘못 열렸다면 로그인 창에서 비밀번호 재설정을 다시 요청해주세요.
                    </p>
                    <Button className="mt-6 w-full" onClick={() => router.push('/')}>
                        홈으로 돌아가기
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl">
                <DialogHeader className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:h-10 sm:w-10" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2 15 8l6 .5-4.5 4 1.5 6L12 16l-6 2.5 1.5-6L3 8.5 9 8z" />
                            </svg>
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

