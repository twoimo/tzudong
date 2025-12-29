"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
    Mail,
    Calendar,
    LogOut,
    User,
    Lock,
    Trash2,
    Eye,
    EyeOff,
    Loader2,
} from "lucide-react";

interface Profile {
    nickname: string;
    avatar_url?: string;
}

export default function ProfileTab() {
    const { user, signOut } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(false);

    // 닉네임 변경
    const [newNickname, setNewNickname] = useState("");

    // 비밀번호 변경
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // 계정 삭제
    const [deleteConfirmationEmail, setDeleteConfirmationEmail] = useState("");

    useEffect(() => {
        if (user) {
            loadProfile();
        }
    }, [user]);

    const loadProfile = async () => {
        if (!user) return;

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('user_id', user.id);

            if (error) throw error;

            if (data && data.length > 0) {
                const profileData = data[0] as Profile;
                setProfile(profileData);
                setNewNickname(profileData.nickname || "");
            } else {
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
            const { error } = await (supabase
                .from('profiles') as any)
                .update({
                    nickname: newNickname.trim()
                })
                .eq('user_id', user.id);

            if (error) throw error;

            setProfile({ ...profile, nickname: newNickname.trim() } as Profile);
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
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

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

        if (deleteConfirmationEmail !== user.email) {
            toast.error('이메일이 일치하지 않습니다');
            return;
        }

        setLoading(true);
        try {
            // 1. 프로필 익명화
            const { error: profileError } = await (supabase
                .from('profiles') as any)
                .update({ nickname: '탈퇴한 사용자' })
                .eq('user_id', user.id);

            if (profileError) {
                console.warn('프로필 익명화 실패:', profileError);
            }

            // 2. user_stats 정보 삭제
            const { error: statsError } = await supabase
                .from('user_stats')
                .delete()
                .eq('user_id', user.id);

            if (statsError) {
                console.warn('통계 정보 삭제 실패:', statsError);
            }

            toast.success('계정 탈퇴가 완료되었습니다. 잠시 후 로그아웃됩니다.');

            setTimeout(async () => {
                try {
                    await supabase.auth.signOut();
                    window.location.href = '/';
                } catch (signOutError) {
                    console.warn('로그아웃 실패:', signOutError);
                    window.location.href = '/';
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

    const createdAt = user.created_at ? new Date(user.created_at) : new Date();

    return (
        <div className="space-y-6 p-4">
            {/* 기본 정보 */}
            <Card>
                <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">기본 정보</CardTitle>
                    <CardDescription className="text-xs">계정 정보를 확인하고 수정할 수 있습니다</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-2">

                    {/* 이메일 */}
                    <div className="space-y-1">
                        <Label className="flex items-center gap-2 text-xs">
                            <Mail className="h-3 w-3" />
                            이메일
                        </Label>
                        <Input value={user.email || ""} disabled className="bg-muted h-8 text-sm" />
                    </div>

                    {/* 닉네임 */}
                    <div className="space-y-1">
                        <Label className="flex items-center gap-2 text-xs">
                            <User className="h-3 w-3" />
                            닉네임
                        </Label>
                        <div className="flex items-center gap-2">
                            <Input
                                value={newNickname}
                                onChange={(e) => setNewNickname(e.target.value)}
                                placeholder="닉네임 입력"
                                className="h-8 text-sm"
                            />
                            <Button
                                onClick={handleNicknameChange}
                                disabled={loading || !newNickname.trim() || newNickname === profile?.nickname}
                                size="sm"
                                className="h-8"
                            >
                                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "변경"}
                            </Button>
                        </div>
                    </div>

                    {/* 가입일 */}
                    <div className="flex items-center gap-2 pt-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">가입일</p>
                            <p className="text-xs font-medium">
                                {format(createdAt, "yyyy년 M월 d일", { locale: ko })}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 비밀번호 변경 */}
            <Card>
                <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Lock className="h-4 w-4" />
                        비밀번호 변경
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-2">
                    <div className="space-y-1">
                        <Label htmlFor="current-password text-xs">현재 비밀번호</Label>
                        <div className="relative">
                            <Input
                                id="current-password"
                                type={showCurrentPassword ? "text" : "password"}
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                placeholder="현재 비밀번호"
                                className="h-8 text-sm pr-8"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-2 py-1 hover:bg-transparent"
                                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                            >
                                {showCurrentPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="new-password text-xs">새 비밀번호</Label>
                        <div className="relative">
                            <Input
                                id="new-password"
                                type={showNewPassword ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="새 비밀번호"
                                className="h-8 text-sm pr-8"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-2 py-1 hover:bg-transparent"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                            >
                                {showNewPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="confirm-password text-xs">새 비밀번호 확인</Label>
                        <div className="relative">
                            <Input
                                id="confirm-password"
                                type={showConfirmPassword ? "text" : "password"}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="새 비밀번호 확인"
                                className="h-8 text-sm pr-8"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-2 py-1 hover:bg-transparent"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            >
                                {showConfirmPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                        </div>
                    </div>

                    <Button
                        onClick={handlePasswordChange}
                        disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                        className="w-full h-8 text-xs mt-2"
                    >
                        {loading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            "비밀번호 변경"
                        )}
                    </Button>
                </CardContent>
            </Card>

            {/* 로그아웃 및 탈퇴 */}
            <div className="flex flex-col gap-2">
                <Button
                    variant="outline"
                    className="w-full gap-2 h-9"
                    onClick={() => signOut()}
                >
                    <LogOut className="h-4 w-4" />
                    로그아웃
                </Button>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" className="w-full h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3 w-3 mr-1" />
                            계정 삭제
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>정말로 계정을 삭제하시겠습니까?</AlertDialogTitle>
                            <AlertDialogDescription className="space-y-2 text-sm">
                                <span className="block">계정을 탈퇴하면 모든 데이터가 영구적으로 삭제됩니다.</span>
                                <span className="block mt-2">계속하시려면 이메일을 입력해주세요.</span>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="py-2">
                            <Input
                                value={deleteConfirmationEmail}
                                onChange={(e) => setDeleteConfirmationEmail(e.target.value)}
                                placeholder={user.email || ""}
                                className="text-center"
                            />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setDeleteConfirmationEmail("")}>
                                취소
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleAccountDelete}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={loading || deleteConfirmationEmail !== user.email}
                            >
                                영구 삭제
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
}
