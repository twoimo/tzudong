"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  Shield,
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

export default function ProfilePage() {
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

  const displayName = profile?.nickname || user.user_metadata?.full_name || user.email?.split("@")[0] || "사용자";
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url;
  const isAdmin = user.user_metadata?.is_admin === true;
  const createdAt = user.created_at ? new Date(user.created_at) : new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">프로필</h1>
      </div>

      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
          <CardDescription>계정 정보를 확인하고 수정할 수 있습니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 프로필 사진 및 이름 */}
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-2xl">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-semibold">{displayName}</h2>
              {isAdmin && (
                <Badge className="mt-1 gap-1" variant="secondary">
                  <Shield className="h-3 w-3" />
                  관리자
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* 이메일 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              이메일
            </Label>
            <Input value={user.email || ""} disabled className="bg-muted" />
          </div>

          {/* 닉네임 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4" />
              닉네임
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                placeholder="닉네임을 입력하세요"
              />
              <Button
                onClick={handleNicknameChange}
                disabled={loading || !newNickname.trim() || newNickname === profile?.nickname}
                size="sm"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "변경"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              닉네임은 2-20자 사이로 입력해주세요
            </p>
          </div>

          {/* 가입일 */}
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">가입일</p>
              <p className="font-medium">
                {format(createdAt, "yyyy년 M월 d일", { locale: ko })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 비밀번호 변경 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            비밀번호 변경
          </CardTitle>
          <CardDescription>
            계정 보안을 위해 정기적으로 비밀번호를 변경해주세요
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
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <Button
            onClick={handlePasswordChange}
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                변경 중...
              </>
            ) : (
              "비밀번호 변경"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 로그아웃 */}
      <Card>
        <CardContent className="pt-6">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </Button>
        </CardContent>
      </Card>

      {/* 계정 삭제 */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
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
                <AlertDialogDescription className="space-y-2">
                  <span className="block">계정을 탈퇴하면:</span>
                  <span className="block">• 작성한 리뷰는 '탈퇴한 사용자'로 유지됩니다</span>
                  <span className="block">• 프로필이 익명화됩니다</span>
                  <span className="block">• 랭킹에서 제외됩니다</span>
                  <span className="block">• 자동으로 로그아웃됩니다</span>
                  <span className="block mt-4">계속하시려면 아래에 계정 이메일을 입력해주세요.</span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-4">
                <Input
                  value={deleteConfirmationEmail}
                  onChange={(e) => setDeleteConfirmationEmail(e.target.value)}
                  placeholder={user.email || ""}
                  className="text-center"
                />
                {deleteConfirmationEmail && deleteConfirmationEmail !== user.email && (
                  <p className="text-sm text-destructive mt-2 text-center">
                    이메일이 일치하지 않습니다
                  </p>
                )}
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
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      삭제 중...
                    </>
                  ) : (
                    "영구 삭제"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
