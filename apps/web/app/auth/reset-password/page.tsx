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
        const handleRecoveryToken = async () => {
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const accessToken = hashParams.get('access_token');
            const type = hashParams.get('type');

            if (accessToken && type === 'recovery') {
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Session error:', error);
                    toast.error('세션 오류가 발생했습니다. 다시 시도해주세요.');
                    router.push('/');
                    return;
                }

                if (session) {
                    setIsValidSession(true);
                    window.history.replaceState(null, '', window.location.pathname);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const { data: { session: retrySession } } = await supabase.auth.getSession();
                    if (retrySession) {
                        setIsValidSession(true);
                        window.history.replaceState(null, '', window.location.pathname);
                    } else {
                        toast.error('유효하지 않거나 만료된 링크입니다');
                        router.push('/');
                    }
                }
            } else {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    setIsValidSession(true);
                } else {
                    toast.error('유효하지 않거나 만료된 링크입니다');
                    router.push('/');
                }
            }
            setIsCheckingSession(false);
        };

        handleRecoveryToken();
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

