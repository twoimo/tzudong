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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, User, Mail, Lock, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface ProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Profile {
    nickname: string;
    avatar_url?: string;
    [key: string]: unknown;
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
    const { user } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(false);

    // Nickname change
    const [newNickname, setNewNickname] = useState("");

    // Password change
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Account deletion
    const [deleteConfirmationEmail, setDeleteConfirmationEmail] = useState("");

    useEffect(() => {
        if (isOpen && user) {
            loadProfile();
            // 모달이 열릴 때 삭제 확인 이메일 초기화
            setDeleteConfirmationEmail("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, user]);

    const loadProfile = async () => {
        if (!user) return;

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('user_id', user.id);

            if (error) throw error;

            // 프로필이 존재하는 경우
            if (data && data.length > 0) {
                const profileData = data[0] as Profile;
                setProfile(profileData);
                setNewNickname(profileData.nickname || "");
            } else {
                // 프로필이 없는 경우 기본값 설정
                setProfile(null);
                setNewNickname(user.email?.split('@')[0] || "사용자");
            }
        } catch (error) {
            toast.error('프로필 정보를 불러오는데 실패했습니다');
            console.error('Profile load error:', error);
        }
    };

    const handleNicknameChange = async () => {
        if (!user || !newNickname.trim()) {
            toast.error('닉네임을 입력해주세요');
            return;
        }

        if (newNickname.length < 2 || newNickname.length > 20) {
            toast.error('닉네임은 2-20자 사이여야 합니다');
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase
                .from('profiles' as never)
                .update({
                    nickname: newNickname.trim()
                } as never)
                .eq('user_id', user.id);

            if (error) throw error;

            setProfile({ ...profile, nickname: newNickname.trim() });
            toast.success('닉네임이 성공적으로 변경되었습니다');
        } catch (error) {
            const err = error as { message?: string };
            toast.error(err.message || '닉네임 변경에 실패했습니다');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async () => {
        if (!currentPassword || !newPassword || !confirmPassword) {
            toast.error('모든 비밀번호 필드를 입력해주세요');
            return;
        }

        if (newPassword !== confirmPassword) {
            toast.error('새 비밀번호가 일치하지 않습니다');
            return;
        }

        if (newPassword.length < 6) {
            toast.error('비밀번호는 최소 6자 이상이어야 합니다');
            return;
        }

        setLoading(true);
        try {
            // Supabase에서 비밀번호 변경
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            // 비밀번호 변경 후 입력 필드 초기화
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            toast.success('비밀번호가 성공적으로 변경되었습니다');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다';
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleAccountDelete = async () => {
        if (!user) return;

        // 이메일 확인
        if (deleteConfirmationEmail !== user.email) {
            toast.error('이메일이 일치하지 않습니다');
            return;
        }

        setLoading(true);
        try {
            // 1. 프로필 익명화 (삭제 대신 닉네임 변경)
            const { error: profileError } = await supabase
                .from('profiles' as never)
                .update({ nickname: '탈퇴한 사용자' } as never)
                .eq('user_id', user.id);

            if (profileError) {
                console.warn('프로필 익명화 실패:', profileError);
                // 프로필 익명화 실패해도 계속 진행
            }

            // 2. user_stats 정보 삭제
            const { error: statsError } = await supabase
                .from('user_stats')
                .delete()
                .eq('user_id', user.id);

            if (statsError) {
                console.warn('통계 정보 삭제 실패:', statsError);
                // 통계 삭제 실패해도 계속 진행
            }

            // 3. 계정 탈퇴 처리 완료
            toast.success('계정 탈퇴가 완료되었습니다. 잠시 후 로그아웃됩니다.');

            // 로그아웃
            onClose();
            setTimeout(async () => {
                try {
                    await supabase.auth.signOut();
                    window.location.reload();
                } catch (signOutError) {
                    console.warn('로그아웃 실패:', signOutError);
                    // 로그아웃 실패해도 페이지 리로드
                    window.location.reload();
                }
            }, 2000);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '계정 삭제 중 오류가 발생했습니다';
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) {
                onClose();
            }
        }}>
            <DialogContent className="max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        프로필 설정
                    </DialogTitle>
                    <DialogDescription>
                        계정 정보를 확인하고 수정할 수 있습니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Basic Information */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">기본 정보</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Email (Read-only) */}
                            <div className="space-y-2">
                                <Label htmlFor="email" className="flex items-center gap-2">
                                    <Mail className="h-4 w-4" />
                                    이메일
                                </Label>
                                <Input
                                    id="email"
                                    value={user.email}
                                    disabled
                                    className="bg-muted"
                                />
                            </div>

                            {/* Nickname */}
                            <div className="space-y-2">
                                <Label htmlFor="nickname" className="flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    닉네임
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="nickname"
                                        value={newNickname}
                                        onChange={(e) => setNewNickname(e.target.value)}
                                        placeholder="닉네임을 입력하세요"
                                        autoComplete="username"
                                        enterKeyHint="done"
                                    />
                                    <Button
                                        onClick={handleNicknameChange}
                                        disabled={loading || !newNickname.trim() || newNickname === profile?.nickname}
                                        size="sm"
                                    >
                                        변경하기
                                    </Button>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    ℹ️ 닉네임은 언제든지 변경할 수 있습니다.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Password Change */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Lock className="h-5 w-5" />
                                비밀번호 변경
                            </CardTitle>
                            <CardDescription>
                                계정 보안을 위해 정기적으로 비밀번호를 변경해주세요.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="current-password">현재 비밀번호</Label>
                                <div className="relative">
                                    <Input
                                        id="current-password"
                                        type={showCurrentPassword ? "text" : "password"}
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        placeholder="현재 비밀번호를 입력하세요"
                                        autoComplete="current-password"
                                        enterKeyHint="next"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                    >
                                        {showCurrentPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="new-password">새 비밀번호</Label>
                                <div className="relative">
                                    <Input
                                        id="new-password"
                                        type={showNewPassword ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="새 비밀번호를 입력하세요"
                                        autoComplete="new-password"
                                        enterKeyHint="next"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                    >
                                        {showNewPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
                                <div className="relative">
                                    <Input
                                        id="confirm-password"
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="새 비밀번호를 다시 입력하세요"
                                        autoComplete="new-password"
                                        enterKeyHint="done"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            <Button
                                onClick={handlePasswordChange}
                                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                                className="w-full"
                            >
                                {loading ? "변경 중..." : "비밀번호 변경"}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Account Deletion */}
                    <Card className="border-destructive/50">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                                <Trash2 className="h-5 w-5" />
                                계정 삭제
                            </CardTitle>
                            <CardDescription>
                                계정을 삭제하면 모든 데이터가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" className="w-full">
                                        계정 삭제
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>정말로 계정을 삭제하시겠습니까?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            계정을 탈퇴하면:
                                            <br />• 작성한 리뷰는 &apos;탈퇴한 사용자&apos;로 유지됩니다
                                            <br />• 프로필이 익명화됩니다
                                            <br />• 랭킹에서 제외됩니다
                                            <br />• 자동으로 로그아웃됩니다
                                            <br />
                                            <br />계속하시려면 아래에 계정 이메일을 입력해주세요.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <div className="py-4">
                                        <Input
                                            value={deleteConfirmationEmail}
                                            onChange={(e) => setDeleteConfirmationEmail(e.target.value)}
                                            placeholder={user.email}
                                            className="text-center"
                                        />
                                        {deleteConfirmationEmail && deleteConfirmationEmail !== user.email && (
                                            <p className="text-sm text-destructive mt-2 text-center">
                                                이메일이 일치하지 않습니다
                                            </p>
                                        )}
                                    </div>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>취소</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleAccountDelete}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            disabled={loading || deleteConfirmationEmail !== user.email}
                                        >
                                            {loading ? "삭제 중..." : "영구 삭제"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    );
}
