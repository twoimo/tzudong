import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User } from "lucide-react";

interface NicknameSetupModalProps {
    isOpen: boolean;
    onComplete: () => void;
}

export function NicknameSetupModal({ isOpen, onComplete }: NicknameSetupModalProps) {
    const { user } = useAuth();
    const [nickname, setNickname] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && user) {
            // 기본값으로 이메일 앞부분 사용
            setNickname(user.email?.split('@')[0] || "");
        }
    }, [isOpen, user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!user || !nickname.trim()) {
            toast.error('닉네임을 입력해주세요');
            return;
        }

        if (nickname.length < 2 || nickname.length > 20) {
            toast.error('닉네임은 2-20자 사이여야 합니다');
            return;
        }

        setLoading(true);
        try {
            // 닉네임 중복 확인
            const { data: existingProfile, error: checkError } = await supabase
                .from('profiles')
                .select('nickname')
                .eq('nickname', nickname.trim())
                .maybeSingle();

            if (existingProfile && !checkError) {
                toast.error('이미 사용 중인 닉네임입니다');
                setLoading(false);
                return;
            }

            // 프로필 업데이트 (닉네임만)
            const { error } = await supabase
                .from('profiles')
                .update({
                    nickname: nickname.trim()
                })
                .eq('user_id', user.id);

            if (error) throw error;

            toast.success('닉네임이 설정되었습니다! 다시 오신 것을 환영합니다 🎉');

            // 약간의 지연 후 모달 닫기 (DB 업데이트 완료 대기)
            setTimeout(() => {
                onComplete();
            }, 500);
        } catch (error) {
            const err = error as { code?: string; message?: string };
            if (err.code === '23505') {
                // UNIQUE constraint violation
                toast.error('이미 사용 중인 닉네임입니다');
            } else {
                toast.error(err.message || '닉네임 설정에 실패했습니다');
            }
            console.error('Nickname setup error:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null;

    return (
        <Dialog open={isOpen} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-md [&>button]:hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        다시 오신 것을 환영합니다!
                    </DialogTitle>
                    <DialogDescription>
                        계정이 복구되었습니다. 새로운 닉네임을 설정해주세요.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="nickname">닉네임</Label>
                        <Input
                            id="nickname"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="2-20자 사이로 입력하세요"
                            autoFocus
                            maxLength={20}
                        />
                        <p className="text-sm text-muted-foreground">
                            프로필 설정에서 닉네임을 변경할 수 있습니다.
                        </p>
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={loading || !nickname.trim() || nickname.length < 2}
                    >
                        {loading ? "설정 중..." : "닉네임 설정하기"}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
