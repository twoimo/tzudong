"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/lib/no-toast";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  LogOut,
  User,
  Lock,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Bookmark,
  ChevronRight,
  MessageSquare,
  MapPin,
  Edit,
  Youtube,
  Camera,
  X,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useBookmarks } from "@/hooks/use-bookmarks";

interface Profile {
  nickname: string;
  avatar_url?: string;
}

const PROFILE_SELECT = 'nickname, avatar_url';
const PRIMARY_QUICK_ACTION_HREFS = new Set([
  "/mypage/bookmarks",
  "/mypage/reviews",
  "/mypage/submissions/new",
]);

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { data: bookmarks = [] } = useBookmarks();
  const queryClient = useQueryClient();
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

  // 계정 비활성화 (익명화)
  const [deactivateConfirmationEmail, setDeactivateConfirmationEmail] = useState("");

  // 계정 완전 삭제
  const [deleteConfirmationEmail, setDeleteConfirmationEmail] = useState("");

  // 아바타 업로드
  const [avatarUploading, setAvatarUploading] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_SELECT)
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
  }, [user]);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user, loadProfile]);

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

      setProfile({ ...profile, nickname: newNickname.trim() } as Profile);
      toast.success('닉네임이 성공적으로 변경되었습니다');
    } catch (error) {
      const err = error as { message?: string };
      toast.error(err.message || '닉네임 변경에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 이미지 압축 함수 (200x200 최대, JPEG 80% 품질)
  const compressImage = useCallback(async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        const MAX_SIZE = 200;
        let { width, height } = img;

        // 비율 유지하며 최대 크기 제한
        if (width > height) {
          if (width > MAX_SIZE) {
            height = (height * MAX_SIZE) / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = (width * MAX_SIZE) / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('이미지 압축 실패'));
          },
          'image/jpeg',
          0.8
        );
      };

      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = URL.createObjectURL(file);
    });
  }, []);

  // 아바타 업로드 핸들러
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // 파일 크기 체크 (2MB 제한)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('이미지 크기는 2MB 이하여야 합니다');
      return;
    }

    // 이미지 타입 체크
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드 가능합니다');
      return;
    }

    setAvatarUploading(true);
    try {
      // 이미지 압축 (200x200, JPEG 80%)
      const compressedBlob = await compressImage(file);
      const filePath = `${user.id}/avatar.jpg`;

      // 기존 아바타 삭제 (있다면 - 스토리지에 업로드된 경우만)
      const oldAvatarUrl = profile?.avatar_url;
      if (oldAvatarUrl?.includes('profile-avatars')) {
        const oldPath = oldAvatarUrl.split('profile-avatars/').pop();
        if (oldPath) {
          await supabase.storage.from('profile-avatars').remove([oldPath]);
        }
      }

      // 압축된 아바타 업로드
      const { error: uploadError } = await supabase.storage
        .from('profile-avatars')
        .upload(filePath, compressedBlob, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // 공개 URL 생성 (캐시 버스팅을 위한 타임스탬프 추가)
      const baseUrl = supabase.storage.from('profile-avatars').getPublicUrl(filePath).data.publicUrl;
      const publicUrl = `${baseUrl}?t=${Date.now()}`;

      // 프로필 업데이트 (avatar_url 컬럼 사용)
      const { error: updateError } = await supabase
        .from('profiles' as never)
        .update({ avatar_url: publicUrl } as never)
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      // 로컬 상태 업데이트
      setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : null);

      // 모든 관련 쿼리 무효화 (즉각 반영)
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      queryClient.invalidateQueries({ queryKey: ['review-feed'] });
      queryClient.invalidateQueries({ queryKey: ['review-feed-panel'] });
      queryClient.invalidateQueries({ queryKey: ['restaurant-reviews'] });
      router.refresh();

      toast.success('프로필 사진이 변경되었습니다');
    } catch (error) {
      console.error('아바타 업로드 오류:', error);
      toast.error('프로필 사진 업로드에 실패했습니다');
    } finally {
      setAvatarUploading(false);
      // 같은 파일 재선택 가능하도록 초기화
      e.target.value = '';
    }
  };

  // 아바타 삭제 핸들러
  const handleAvatarDelete = async () => {
    if (!user || !profile?.avatar_url) return;

    setAvatarUploading(true);
    try {
      // 스토리지에 업로드된 이미지면 스토리지에서도 삭제
      if (profile.avatar_url.includes('profile-avatars')) {
        // URL에서 타임스탬프 쿼리 파라미터 제거
        const urlWithoutQuery = profile.avatar_url.split('?')[0];
        const filePath = urlWithoutQuery.split('profile-avatars/').pop();
        if (filePath) {
          await supabase.storage.from('profile-avatars').remove([filePath]);
        }
      }

      // 프로필 업데이트 (avatar_url 널로)
      const { error: updateError } = await supabase
        .from('profiles' as never)
        .update({ avatar_url: null } as never)
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      // 로컬 상태 업데이트
      setProfile(prev => prev ? { ...prev, avatar_url: undefined } : null);

      // 모든 관련 쿼리 무효화 (즉각 반영)
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      queryClient.invalidateQueries({ queryKey: ['review-feed'] });
      queryClient.invalidateQueries({ queryKey: ['review-feed-panel'] });
      queryClient.invalidateQueries({ queryKey: ['restaurant-reviews'] });
      router.refresh();

      toast.success('프로필 사진이 삭제되었습니다');
    } catch (error) {
      console.error('아바타 삭제 오류:', error);
      toast.error('프로필 사진 삭제에 실패했습니다');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!user?.email) {
      toast.error('사용자 정보를 찾을 수 없습니다');
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('모든 비밀번호 필드를 입력해주세요');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다');
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 12) {
      toast.error('비밀번호는 8자 이상 12자 이하여야 합니다');
      return;
    }

    setLoading(true);
    try {
      // 현재 비밀번호 검증 (재인증)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        toast.error('현재 비밀번호가 올바르지 않습니다');
        return;
      }

      // 비밀번호 변경
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

  // 계정 비활성화 (익명화 후 로그아웃)
  const handleAccountDeactivate = async () => {
    if (!user) return;

    if (deactivateConfirmationEmail !== user.email) {
      toast.error('이메일이 일치하지 않습니다');
      return;
    }

    setLoading(true);
    try {
      // 프로필 익명화
      const { error: profileError } = await supabase
        .from('profiles' as never)
        .update({ nickname: '탈퇴한 사용자' } as never)
        .eq('user_id', user.id);

      if (profileError) {
        console.warn('프로필 익명화 실패:', profileError);
      }

      toast.success('계정이 비활성화되었습니다. 잠시 후 로그아웃됩니다.');

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
      const errorMessage = error instanceof Error ? error.message : '계정 비활성화 중 오류가 발생했습니다';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 계정 완전 삭제 (Supabase Auth에서 삭제)
  const handleAccountPermanentDelete = async () => {
    if (!user) return;

    if (deleteConfirmationEmail !== user.email) {
      toast.error('이메일이 일치하지 않습니다');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '계정 삭제에 실패했습니다');
      }

      toast.success('계정이 영구적으로 삭제되었습니다. 잠시 후 홈으로 이동합니다.');

      // 세션 정리
      await supabase.auth.signOut();

      // localStorage에서 Supabase 관련 항목 정리
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('sb-') || key.startsWith('supabase')) {
          localStorage.removeItem(key);
        }
      });

      setTimeout(() => {
        window.location.href = '/';
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
  // 프로필 사진 URL (avatar_url 컬럼만 사용 - 삭제 시 완전히 제거됨)
  const avatarUrl = profile?.avatar_url;
  const createdAt = user.created_at ? new Date(user.created_at) : new Date();
  const joinedDateLabel = format(createdAt, "yyyy년 M월 d일", { locale: ko });
  const hasCustomNickname = Boolean(profile?.nickname?.trim());
  const profileCompletionItems = [
    { label: "닉네임", complete: hasCustomNickname },
    { label: "프로필 사진", complete: Boolean(avatarUrl) },
    { label: "첫 북마크", complete: bookmarks.length > 0 },
  ];
  const completedProfileItems = profileCompletionItems.filter((item) => item.complete).length;
  const profileCompletionPercent = Math.round((completedProfileItems / profileCompletionItems.length) * 100);
  const profileQuickActions = [
    {
      href: "/mypage/bookmarks",
      icon: Bookmark,
      title: "저장한 맛집",
      description: `${bookmarks.length}개 북마크 확인`,
      accent: "bg-primary/10 text-primary",
      desktopAccent: "md:bg-primary/10 md:text-primary",
    },
    {
      href: "/mypage/reviews",
      icon: MessageSquare,
      title: "내 리뷰",
      description: "작성·수정 내역 관리",
      accent: "bg-sky-500/10 text-sky-600",
      desktopAccent: "md:bg-sky-500/10 md:text-sky-600",
    },
    {
      href: "/mypage/submissions/new",
      icon: MapPin,
      title: "맛집 제보",
      description: "새로운 맛집 알려주기",
      accent: "bg-emerald-500/10 text-emerald-600",
      desktopAccent: "md:bg-emerald-500/10 md:text-emerald-600",
    },
    {
      href: "/mypage/submissions/edit",
      icon: Edit,
      title: "수정 요청",
      description: "주소·정보 바로잡기",
      accent: "bg-amber-500/10 text-amber-600",
      desktopAccent: "md:bg-amber-500/10 md:text-amber-600",
    },
    {
      href: "/mypage/submissions/recommend",
      icon: Youtube,
      title: "쯔양 제보",
      description: "영상 속 맛집 알려주기",
      accent: "bg-red-500/10 text-red-600",
      desktopAccent: "md:bg-red-500/10 md:text-red-600",
    },
    {
      href: "/?panel=settings",
      icon: Settings2,
      title: "지도 환경설정",
      description: "좌측 패널·지도 위치 조정",
      accent: "bg-violet-500/10 text-violet-600",
      desktopAccent: "md:bg-violet-500/10 md:text-violet-600",
    },
  ];
  const nextProfileStep = profileCompletionItems.find((item) => !item.complete)?.label ?? "맛집 활동";

  return (
    <div className="space-y-3 sm:space-y-5" data-mypage-profile-page="true">
      <section
        className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-background to-secondary/30 shadow-sm"
        data-mypage-profile-hero="true"
      >
        <div className="grid gap-3 p-3 sm:gap-5 sm:p-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)] lg:p-6">
          <div className="flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-primary/15 bg-background shadow-sm">
              {avatarUrl ? (
                <NextImage
                  src={avatarUrl}
                  alt={displayName}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary/10">
                  <User className="h-8 w-8 text-primary" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="min-w-0">
                <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary sm:justify-start">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="md:hidden">내 활동 모아보기</span>
                  <span className="hidden md:inline">마이페이지 허브</span>
                </p>
                <h1 className="mt-1 text-balance text-xl font-bold tracking-tight sm:text-3xl">
                  <span className="md:hidden">{displayName}님, 맛집 기록을 간편하게 관리해요</span>
                  <span className="hidden md:inline">{displayName}님, 오늘도 맛집 기록을 이어가요</span>
                </h1>
                <p className="mt-1 break-words text-xs leading-5 text-muted-foreground sm:text-sm">
                  <span className="md:hidden">가입일 {joinedDateLabel}</span>
                  <span className="hidden md:inline">{user.email} · 가입일 {joinedDateLabel}</span>
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2" data-mypage-profile-summary="true">
                <div className="rounded-2xl border border-border/70 bg-background/80 p-2.5 sm:p-3">
                  <p className="text-xs text-muted-foreground">북마크</p>
                  <p className="mt-1 text-lg font-bold sm:text-xl">{bookmarks.length}개</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-2.5 sm:p-3">
                  <p className="text-xs text-muted-foreground">프로필 완성도</p>
                  <p className="mt-1 text-lg font-bold sm:text-xl">{profileCompletionPercent}%</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-2.5 sm:p-3">
                  <p className="text-xs text-muted-foreground">다음 추천</p>
                  <p className="mt-1 truncate text-xs font-semibold sm:text-sm">{nextProfileStep}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-background/85 p-3 shadow-sm backdrop-blur-sm" data-mypage-next-actions="true">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div>
                <p className="text-sm font-semibold">
                  <span className="md:hidden">자주 쓰는 메뉴</span>
                  <span className="hidden md:inline">바로 할 수 있는 일</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="md:hidden">필요한 작업만 한곳에 모았습니다</span>
                  <span className="hidden md:inline">마이페이지에서 자주 찾는 기능을 모았습니다</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">
              {profileQuickActions.map((action) => {
                const Icon = action.icon;
                const isPrimaryAction = PRIMARY_QUICK_ACTION_HREFS.has(action.href);
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={`group flex min-w-0 items-center gap-2 rounded-2xl border px-2.5 py-3 transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-3 sm:px-3 md:border-border/70 md:bg-card ${isPrimaryAction ? "border-border/70 bg-card shadow-sm" : "border-border/50 bg-background/70"}`}
                    data-mypage-primary-action={isPrimaryAction ? "true" : "false"}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 ${isPrimaryAction ? action.accent : "bg-muted text-muted-foreground"} ${action.desktopAccent}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{action.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{action.description}</span>
                    </span>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      {/* 기본 정보 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>계정 정보</CardTitle>
          <CardDescription>프로필에서 중복되는 정보는 줄이고 꼭 필요한 항목만 관리합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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
                placeholder="닉네임을 입력하세요…"
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

          <Separator />

          <div className="space-y-3" data-mypage-profile-photo-controls="true">
            <Label className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              프로필 사진
            </Label>
            <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
              <label
                htmlFor="profile-avatar-upload"
                aria-label="프로필 사진 변경"
                className="group relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border bg-background transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-primary"
                style={{ aspectRatio: '1 / 1', borderRadius: '9999px', overflow: 'hidden' }}
              >
                {avatarUrl ? (
                  <NextImage
                    src={avatarUrl}
                    alt={displayName}
                    fill
                    sizes="56px"
                    className="rounded-full object-cover"
                    style={{ borderRadius: '9999px' }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                )}
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 active:opacity-100">
                  {avatarUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </span>
                <input
                  id="profile-avatar-upload"
                  name="profile-avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="sr-only"
                  disabled={avatarUploading}
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">이미지를 눌러 변경</p>
                <p className="text-xs text-muted-foreground">최대 2MB, JPG/PNG 권장</p>
              </div>
              {profile?.avatar_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAvatarDelete}
                  disabled={avatarUploading}
                  aria-label="프로필 사진 삭제"
                  className="h-11 w-11 shrink-0 touch-manipulation text-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3" data-mypage-session-card="true">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">접속 관리</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 touch-manipulation gap-2 rounded-2xl"
                onClick={() => signOut()}
              >
                <LogOut className="h-4 w-4" />
                로그아웃
              </Button>
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
                placeholder="현재 비밀번호를 입력하세요…"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                aria-label={showCurrentPassword ? "현재 비밀번호 숨기기" : "현재 비밀번호 보기"}
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
                placeholder="새 비밀번호를 입력하세요…"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowNewPassword(!showNewPassword)}
                aria-label={showNewPassword ? "새 비밀번호 숨기기" : "새 비밀번호 보기"}
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
                placeholder="새 비밀번호를 다시 입력하세요…"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? "새 비밀번호 확인 숨기기" : "새 비밀번호 확인 보기"}
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
                변경 중…
              </>
            ) : (
              "비밀번호 변경"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 계정 비활성화 */}
      <Card className="border-yellow-500/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-600">
            <EyeOff className="h-5 w-5" />
            계정 비활성화
          </CardTitle>
          <CardDescription>
            계정을 비활성화하면 닉네임이 익명화되고 로그아웃됩니다. 나중에 다시 로그인할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="w-full border-yellow-500 text-yellow-600 hover:bg-yellow-50">
                계정 비활성화
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>계정을 비활성화하시겠습니까?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">계정을 비활성화하면:</span>
                  <span className="block">• 닉네임이 &apos;탈퇴한 사용자&apos;로 변경됩니다</span>
                  <span className="block">• 작성한 리뷰는 유지됩니다</span>
                  <span className="block">• 랭킹에서 제외됩니다</span>
                  <span className="block">• 나중에 다시 로그인하면 복구할 수 있습니다</span>
                  <span className="block mt-4">계속하시려면 아래에 계정 이메일을 입력해주세요.</span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-4">
                <Input
                  value={deactivateConfirmationEmail}
                  onChange={(e) => setDeactivateConfirmationEmail(e.target.value)}
                  placeholder={user.email || ""}
                  className="text-center"
                />
                {deactivateConfirmationEmail && deactivateConfirmationEmail !== user.email && (
                  <p className="text-sm text-destructive mt-2 text-center">
                    이메일이 일치하지 않습니다
                  </p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeactivateConfirmationEmail("")}>
                  취소
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleAccountDeactivate}
                  className="bg-yellow-600 text-white hover:bg-yellow-700"
                  disabled={loading || deactivateConfirmationEmail !== user.email}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      처리 중…
                    </>
                  ) : (
                    "비활성화"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* 계정 완전 삭제 */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            계정 완전 삭제
          </CardTitle>
          <CardDescription>
            계정을 완전히 삭제하면 모든 데이터가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full">
                계정 완전 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>정말로 계정을 완전히 삭제하시겠습니까?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block font-semibold text-destructive">⚠️ 이 작업은 되돌릴 수 없습니다!</span>
                  <span className="block">계정을 완전히 삭제하면:</span>
                  <span className="block">• 모든 개인 정보가 삭제됩니다</span>
                  <span className="block">• 작성한 리뷰는 &apos;탈퇴한 사용자&apos;로 유지됩니다</span>
                  <span className="block">• 다시는 이 계정으로 로그인할 수 없습니다</span>
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
                  onClick={handleAccountPermanentDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={loading || deleteConfirmationEmail !== user.email}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      삭제 중…
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
