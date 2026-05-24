"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "@/lib/no-toast";
import {
  User,
  Lock,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Bookmark,
  Camera,
  ChevronRight,
  Heart,
  MessageSquare,
  MapPin,
  Edit,
  X,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { useBookmarks } from "@/hooks/use-bookmarks";
import {
  getNextUserTierProgress,
  useUserProfile,
} from "@/hooks/useUserProfile";
import { cn } from "@/lib/utils";

interface Profile {
  nickname: string;
  avatar_url?: string;
}

const PROFILE_SELECT = "nickname, avatar_url";

export default function ProfilePage() {
  const { user, profileNickname } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: bookmarks = [] } = useBookmarks();
  const { data: userProfile } = useUserProfile(user?.id ?? "");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMobileNicknameEditing, setIsMobileNicknameEditing] = useState(false);
  const [mobileNicknameInput, setMobileNicknameInput] = useState("");
  const [mobileNicknameSaving, setMobileNicknameSaving] = useState(false);
  const [mobileAvatarUploading, setMobileAvatarUploading] = useState(false);

  // 비밀번호 변경
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 계정 비활성화 (익명화)
  const [deactivateConfirmationEmail, setDeactivateConfirmationEmail] =
    useState("");

  // 계정 완전 삭제
  const [deleteConfirmationEmail, setDeleteConfirmationEmail] = useState("");

  const loadProfile = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", user.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const profileData = data[0] as Profile;
        setProfile(profileData);
      } else {
        setProfile(null);
      }
    } catch (error) {
      toast.error("프로필 정보를 불러오는데 실패했습니다");
      console.error("Profile load error:", error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user, loadProfile]);

  const displayName =
    profile?.nickname || userProfile?.nickname || profileNickname || "사용자";

  useEffect(() => {
    if (!isMobileNicknameEditing) {
      setMobileNicknameInput(displayName);
    }
  }, [displayName, isMobileNicknameEditing]);

  const handleMobileNicknameChange = async () => {
    if (!user || !mobileNicknameInput.trim()) {
      toast.error("닉네임을 입력해주세요");
      return;
    }

    const nextNickname = mobileNicknameInput.trim();
    if (nextNickname.length < 2 || nextNickname.length > 20) {
      toast.error("닉네임은 2-20자 사이여야 합니다");
      return;
    }

    setMobileNicknameSaving(true);
    try {
      const { error } = await supabase
        .from("profiles" as never)
        .update({ nickname: nextNickname } as never)
        .eq("user_id", user.id);

      if (error) throw error;

      setProfile((prev) => ({
        nickname: nextNickname,
        avatar_url: prev?.avatar_url,
      }));
      await queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      setIsMobileNicknameEditing(false);
      router.refresh();
      toast.success("닉네임이 변경되었습니다");
    } catch (error) {
      const err = error as { message?: string };
      toast.error(err.message || "닉네임 변경에 실패했습니다");
    } finally {
      setMobileNicknameSaving(false);
    }
  };

  const handleMobileAvatarUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("이미지 크기는 2MB 이하여야 합니다");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드 가능합니다");
      return;
    }

    setMobileAvatarUploading(true);
    try {
      const { compressImage } = await import("@/lib/image-utils");
      const compressedBlob = await compressImage(file);
      const filePath = `${user.id}/avatar.jpg`;

      const oldAvatarUrl = profile?.avatar_url;
      if (oldAvatarUrl?.includes("profile-avatars")) {
        const oldPath = oldAvatarUrl
          .split("profile-avatars/")
          .pop()
          ?.split("?")[0];
        if (oldPath) {
          await supabase.storage.from("profile-avatars").remove([oldPath]);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(filePath, compressedBlob, {
          upsert: true,
          contentType: "image/jpeg",
        });

      if (uploadError) throw uploadError;

      const baseUrl = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(filePath).data.publicUrl;
      const publicUrl = `${baseUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles" as never)
        .update({ avatar_url: publicUrl } as never)
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      setProfile((prev) => ({
        nickname: prev?.nickname || displayName,
        avatar_url: publicUrl,
      }));
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["review-feed"] });
      queryClient.invalidateQueries({ queryKey: ["review-feed-panel"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-reviews"] });
      router.refresh();
      toast.success("프로필 사진이 변경되었습니다");
    } catch (error) {
      console.error("모바일 프로필 사진 업로드 실패:", error);
      toast.error("프로필 사진 업로드에 실패했습니다");
    } finally {
      setMobileAvatarUploading(false);
      event.target.value = "";
    }
  };

  const handleMobileAvatarDelete = async () => {
    if (!user || !profile?.avatar_url) return;
    if (!confirm("프로필 사진을 삭제하시겠습니까?")) return;

    setMobileAvatarUploading(true);
    try {
      if (profile.avatar_url.includes("profile-avatars")) {
        const oldPath = profile.avatar_url
          .split("profile-avatars/")
          .pop()
          ?.split("?")[0];
        if (oldPath) {
          await supabase.storage.from("profile-avatars").remove([oldPath]);
        }
      }

      const { error: updateError } = await supabase
        .from("profiles" as never)
        .update({ avatar_url: null } as never)
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      setProfile((prev) => ({
        nickname: prev?.nickname || displayName,
        avatar_url: undefined,
      }));
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["review-feed"] });
      queryClient.invalidateQueries({ queryKey: ["review-feed-panel"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-reviews"] });
      router.refresh();
      toast.success("프로필 사진이 삭제되었습니다");
    } catch (error) {
      console.error("모바일 프로필 사진 삭제 실패:", error);
      toast.error("프로필 사진 삭제에 실패했습니다");
    } finally {
      setMobileAvatarUploading(false);
    }
  };

  const handlePasswordChange = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!user?.email) {
      toast.error("사용자 정보를 찾을 수 없습니다");
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("모든 비밀번호 필드를 입력해주세요");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("새 비밀번호가 일치하지 않습니다");
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 12) {
      toast.error("비밀번호는 8자 이상 12자 이하여야 합니다");
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
        toast.error("현재 비밀번호가 올바르지 않습니다");
        return;
      }

      // 비밀번호 변경
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("비밀번호가 성공적으로 변경되었습니다");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "비밀번호 변경에 실패했습니다";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 계정 비활성화 (익명화 후 로그아웃)
  const handleAccountDeactivate = async () => {
    if (!user) return;

    if (deactivateConfirmationEmail !== user.email) {
      toast.error("이메일이 일치하지 않습니다");
      return;
    }

    setLoading(true);
    try {
      // 프로필 익명화
      const { error: profileError } = await supabase
        .from("profiles" as never)
        .update({ nickname: "탈퇴한 사용자" } as never)
        .eq("user_id", user.id);

      if (profileError) {
        console.warn("프로필 익명화 실패:", profileError);
      }

      toast.success("계정이 비활성화되었습니다. 잠시 후 로그아웃됩니다.");

      setTimeout(async () => {
        try {
          await supabase.auth.signOut();
          window.location.href = "/";
        } catch (signOutError) {
          console.warn("로그아웃 실패:", signOutError);
          window.location.href = "/";
        }
      }, 2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "계정 비활성화 중 오류가 발생했습니다";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 계정 완전 삭제 (Supabase Auth에서 삭제)
  const handleAccountPermanentDelete = async () => {
    if (!user) return;

    if (deleteConfirmationEmail !== user.email) {
      toast.error("이메일이 일치하지 않습니다");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "계정 삭제에 실패했습니다");
      }

      toast.success(
        "계정이 영구적으로 삭제되었습니다. 잠시 후 홈으로 이동합니다.",
      );

      // 세션 정리
      await supabase.auth.signOut();

      // localStorage에서 Supabase 관련 항목 정리
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("sb-") || key.startsWith("supabase")) {
          localStorage.removeItem(key);
        }
      });

      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "계정 삭제 중 오류가 발생했습니다";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  // 프로필 사진 URL (avatar_url 컬럼만 사용 - 삭제 시 완전히 제거됨)
  const avatarUrl = profile?.avatar_url || userProfile?.avatarUrl;
  const isMobileNicknameUnchanged = mobileNicknameInput.trim() === displayName;
  const tierProgress = getNextUserTierProgress(userProfile?.qualityScore ?? 0);
  const tierRemainingScore = tierProgress.remainingScore;
  const hasVerifiedReviews = (userProfile?.verifiedReviewCount ?? 0) > 0;
  const tierVerifiedReviewsNeeded = Math.ceil(tierRemainingScore);
  const tierLikesNeeded = hasVerifiedReviews
    ? Math.ceil(tierRemainingScore * 10)
    : null;
  const currentTierName = userProfile?.tier?.name ?? "🌱 뉴비";
  const nextTierName = tierProgress.nextTier?.name ?? "최고 등급";
  const tierRemainingLabel = tierProgress.nextTier
    ? `${tierRemainingScore}점`
    : "완료";
  const tierProgressLabel = `${tierProgress.progressPercent}%`;
  const activityActions = [
    {
      href: "/mypage/bookmarks",
      icon: Bookmark,
      title: "나의 북마크 내역",
      description: `${bookmarks.length}개 저장됨`,
      accent: "bg-primary/10 text-primary",
      desktopAccent: "md:bg-primary/10 md:text-primary",
    },
    {
      href: "/mypage/reviews",
      icon: MessageSquare,
      title: "나의 리뷰 내역",
      description: "작성한 리뷰 관리",
      accent: "bg-sky-500/10 text-sky-600",
      desktopAccent: "md:bg-sky-500/10 md:text-sky-600",
    },
  ];
  const reportActions = [
    {
      href: "/mypage/submissions/new",
      icon: MapPin,
      title: "신규 맛집 제보",
      description: "새 맛집 등록",
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
  ];
  const quickActionSections = [
    {
      id: "activity" as const,
      title: "내 활동",
      helper: "저장하고 작성한 기록",
      actions: activityActions,
    },
    {
      id: "report" as const,
      title: "제보하기",
      helper: "새 맛집과 정보 수정",
      actions: reportActions,
    },
  ];
  const recentActivityItems = [
    {
      icon: Bookmark,
      label: "저장한 맛집",
      value: `${bookmarks.length}개`,
      helper: "북마크에 담아둔 곳",
      impact: "취향 신호",
      accent: "bg-primary/10 text-primary",
    },
    {
      icon: MessageSquare,
      label: "작성한 리뷰",
      value: `${userProfile?.reviewCount ?? 0}개`,
      helper: "내가 남긴 리뷰 기록",
      impact: "등급 핵심",
      accent: "bg-sky-500/10 text-sky-600",
    },
    {
      icon: Heart,
      label: "받은 좋아요",
      value: `${userProfile?.totalLikes ?? 0}개`,
      helper: "리뷰에 쌓인 반응",
      impact: "신뢰도 반영",
      accent: "bg-red-500/10 text-red-600",
    },
  ];

  return (
    <div
      className="grid min-w-0 gap-3 sm:gap-5 md:h-full md:min-h-0 md:grid-cols-2 md:grid-rows-2 md:auto-rows-fr md:content-stretch md:items-stretch lg:gap-3"
      data-mypage-profile-page="true"
      data-mypage-profile-density="dashboard-matrix"
      data-mypage-profile-viewport-fit="true"
      data-mypage-profile-matrix="equal-2x2"
      data-mypage-profile-matrix-size="equal-track-fill"
      data-mypage-profile-mobile-flow="stack"
      data-mypage-profile-desktop-flow="matrix-2x2"
    >
      <div
        className="min-w-0 space-y-3 sm:space-y-5 md:contents md:space-y-0"
        data-mypage-profile-main-column="true"
      >
        <Card
          className="overflow-hidden shadow-none md:hidden"
          data-mypage-profile-hero="mobile-only"
        >
          <div
            className="flex flex-col items-center space-y-4 p-6 text-center md:hidden"
            data-mypage-profile-hero-layout="sidebar-match"
          >
            <div className="group relative h-24 w-24 shrink-0 rounded-full">
              <label
                htmlFor="mypage-mobile-avatar-upload"
                aria-label="프로필 사진 변경"
                className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-border shadow-sm transition-[border-color,box-shadow] group-hover:ring-2 group-hover:ring-primary/30 md:pointer-events-none"
                style={{
                  width: "6rem",
                  height: "6rem",
                  aspectRatio: "1 / 1",
                  borderRadius: "9999px",
                  overflow: "hidden",
                }}
                data-mypage-mobile-avatar-controls="true"
              >
                {avatarUrl ? (
                  <NextImage
                    src={avatarUrl}
                    alt={displayName}
                    fill
                    sizes="96px"
                    className="rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center rounded-full bg-muted"
                    style={{ borderRadius: "9999px" }}
                  >
                    <User className="h-9 w-9 text-muted-foreground" />
                  </div>
                )}
                <span
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 active:opacity-100 md:hidden"
                  style={{ borderRadius: "9999px" }}
                >
                  {mobileAvatarUploading ? (
                    <Loader2
                      className="h-7 w-7 animate-spin text-white"
                      aria-hidden="true"
                    />
                  ) : (
                    <Camera className="h-7 w-7 text-white" aria-hidden="true" />
                  )}
                </span>
                <input
                  id="mypage-mobile-avatar-upload"
                  name="mypage-mobile-avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleMobileAvatarUpload}
                  className="sr-only md:hidden"
                  disabled={mobileAvatarUploading}
                />
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleMobileAvatarDelete}
                  disabled={mobileAvatarUploading}
                  aria-label="프로필 사진 삭제"
                  className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white shadow-sm transition-colors hover:bg-destructive/90 disabled:opacity-50 md:hidden"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              className="flex w-full flex-col items-center space-y-2"
              data-mypage-profile-identity="sidebar-match"
              data-mypage-mobile-nickname-controls="true"
            >
              {isMobileNicknameEditing ? (
                <div
                  className="w-full space-y-2 md:hidden"
                  data-mypage-mobile-nickname-field="edit"
                >
                  <Input
                    id="mypage-mobile-nickname"
                    name="nickname"
                    autoComplete="nickname"
                    value={mobileNicknameInput}
                    onChange={(event) =>
                      setMobileNicknameInput(event.target.value)
                    }
                    placeholder="닉네임"
                    aria-label="닉네임"
                    className="h-10 rounded-xl text-center text-base font-semibold"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      onClick={handleMobileNicknameChange}
                      disabled={
                        mobileNicknameSaving ||
                        !mobileNicknameInput.trim() ||
                        isMobileNicknameUnchanged
                      }
                    >
                      {mobileNicknameSaving ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      저장
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-xl text-xs"
                      onClick={() => {
                        setMobileNicknameInput(displayName);
                        setIsMobileNicknameEditing(false);
                      }}
                      disabled={mobileNicknameSaving}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="flex max-w-full items-center gap-2 px-2"
                  data-mypage-mobile-nickname-field="display"
                >
                  <h3 className="truncate text-lg font-bold">{displayName}</h3>
                  {userProfile?.tier && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 shrink-0 whitespace-nowrap border-0 px-1.5 py-0 text-[10px]",
                        userProfile.tier.color,
                        userProfile.tier.bgColor,
                      )}
                    >
                      {userProfile.tier.name}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full px-2 text-[11px] text-muted-foreground"
                    onClick={() => {
                      setMobileNicknameInput(displayName);
                      setIsMobileNicknameEditing(true);
                    }}
                  >
                    수정
                  </Button>
                </div>
              )}
              {user.email && (
                <p className="max-w-full truncate px-2 text-xs text-muted-foreground">
                  {user.email}
                </p>
              )}
            </div>

            <div
              className="grid w-full grid-cols-3 gap-2 pt-2"
              data-mypage-profile-summary="true"
            >
              <div className="flex flex-col items-center rounded-lg bg-muted/40 p-2 transition-colors hover:bg-muted/60">
                <span className="mb-1 text-xs text-muted-foreground">도장</span>
                <span className="text-sm font-bold">
                  {userProfile?.verifiedReviewCount ?? 0}
                </span>
              </div>
              <div className="flex flex-col items-center rounded-lg bg-muted/40 p-2 transition-colors hover:bg-muted/60">
                <span className="mb-1 text-xs text-muted-foreground">리뷰</span>
                <span className="text-sm font-bold">
                  {userProfile?.reviewCount ?? 0}
                </span>
              </div>
              <div className="flex flex-col items-center rounded-lg bg-muted/40 p-2 transition-colors hover:bg-muted/60">
                <span className="mb-1 text-xs text-muted-foreground">
                  좋아요
                </span>
                <span className="text-sm font-bold">
                  {userProfile?.totalLikes ?? 0}
                </span>
              </div>
            </div>

          </div>
        </Card>

        <Card
          className="overflow-hidden md:order-1 md:col-start-1 md:row-start-1 md:h-full md:min-h-0 md:rounded-3xl md:border md:border-border/70 md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"
          data-mypage-next-actions="true"
          data-mypage-quick-actions="combined"
        >
          <CardContent
            className="space-y-3 p-4 md:hidden"
            data-mypage-mobile-quick-actions="grouped"
          >
            {quickActionSections.map((section) => (
              <section
                key={section.id}
                className="space-y-2"
                data-mypage-mobile-action-section={section.id}
              >
                <div className="flex items-end justify-between gap-2 px-1">
                  <h4 className="text-sm font-semibold">{section.title}</h4>
                  <p className="text-[11px] text-muted-foreground">
                    {section.helper}
                  </p>
                </div>
                <div
                  className="grid gap-2"
                  data-mypage-mobile-action-grid={section.id}
                >
                  {section.actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="group flex min-h-14 min-w-0 touch-manipulation items-center gap-3 rounded-2xl border border-border bg-background px-3 py-3 transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        data-mypage-mobile-action-row="true"
                        data-mypage-action-group={section.id}
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${action.accent}`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {action.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {action.description}
                          </span>
                        </span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </CardContent>
          <CardContent
            className="hidden h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:flex md:flex-col md:gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-mypage-desktop-tier-dashboard="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">등급 대시보드</h4>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  현재 등급과 다음 목표를 한눈에 확인합니다
                </p>
              </div>
              {userProfile?.tier && (
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 shrink-0 whitespace-nowrap border-0 px-1.5 py-0 text-[10px]",
                    userProfile.tier.color,
                    userProfile.tier.bgColor,
                  )}
                >
                  {userProfile.tier.name}
                </Badge>
              )}
            </div>

            <div
              className="rounded-2xl border border-border/70 bg-card px-3 py-3"
              data-mypage-desktop-tier-progress="true"
            >
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">다음 목표</p>
                  <p className="mt-0.5 truncate text-xl font-bold tracking-tight">
                    {tierProgress.nextTier
                      ? `${nextTierName}까지 인증 리뷰 ${tierVerifiedReviewsNeeded}개`
                      : "최고 등급 유지 중"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-muted-foreground">
                    품질 점수
                  </p>
                  <p className="text-lg font-bold tracking-tight">
                    {(userProfile?.qualityScore ?? 0).toFixed(1)}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground">
                      점
                    </span>
                  </p>
                </div>
              </div>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="다음 등급 진행률"
                aria-valuenow={tierProgress.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${tierProgress.progressPercent}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>

            <div
              className="grid min-h-0 flex-1 grid-cols-2 gap-2"
              data-mypage-desktop-tier-metrics="true"
            >
              <div className="flex min-w-0 flex-col justify-center rounded-2xl bg-muted/40 px-3 py-2">
                <span className="block text-[11px] text-muted-foreground">
                  현재 등급
                </span>
                <span className="block truncate text-sm font-bold">
                  {currentTierName}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  공개 프로필 배지
                </span>
              </div>
              <div className="flex min-w-0 flex-col justify-center rounded-2xl bg-muted/40 px-3 py-2">
                <span className="block text-[11px] text-muted-foreground">
                  다음 목표
                </span>
                <span className="block truncate text-sm font-bold">
                  {nextTierName}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  인증 활동 기준
                </span>
              </div>
              <div className="flex min-w-0 flex-col justify-center rounded-2xl bg-muted/40 px-3 py-2">
                <span className="block text-[11px] text-muted-foreground">
                  남은 점수
                </span>
                <span className="block truncate text-sm font-bold">
                  {tierRemainingLabel}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  리뷰·좋아요로 채우기
                </span>
              </div>
              <div className="flex min-w-0 flex-col justify-center rounded-2xl bg-muted/40 px-3 py-2">
                <span className="block text-[11px] text-muted-foreground">
                  진행률
                </span>
                <span className="block truncate text-sm font-bold">
                  {tierProgressLabel}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  다음 등급까지
                </span>
              </div>
            </div>

            <div
              className="shrink-0 rounded-2xl border border-border/70 bg-card px-3 py-2.5"
              data-mypage-desktop-tier-action-guide="true"
            >
              {tierProgress.nextTier ? (
                <>
                  <p className="text-xs font-semibold text-foreground">
                    등급 올리는 법
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/35 px-3 py-1.5">
                      <span className="block text-[11px] text-muted-foreground">
                        인증 리뷰
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-foreground">
                        {tierVerifiedReviewsNeeded}개 더 필요
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                        인증 도장 1개는 품질 점수 약 1점으로 반영돼요.
                      </span>
                    </div>
                    <div className="rounded-xl bg-muted/35 px-3 py-1.5">
                      <span className="block text-[11px] text-muted-foreground">
                        받은 좋아요
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-foreground">
                        {hasVerifiedReviews && tierLikesNeeded !== null
                          ? `약 ${tierLikesNeeded}개 더 필요`
                          : "인증 리뷰 후 반영"}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                        좋아요 10개는 품질 점수 약 1점으로 반영돼요.
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  이미 최고 등급입니다. 인증 리뷰와 좋아요를 꾸준히 유지해
                  랭킹 경쟁력을 지켜보세요.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card
          className="hidden min-w-0 md:order-3 md:col-start-1 md:row-start-2 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:border-border/70 md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"
          data-mypage-desktop-recent-activity="true"
        >
          <CardHeader className="shrink-0 pb-3 lg:p-3 lg:pb-1.5">
            <CardTitle className="text-base">최근 활동</CardTitle>
            <CardDescription className="lg:hidden">
              저장·리뷰·반응 기록을 간단히 확인합니다
            </CardDescription>
          </CardHeader>
          <CardContent className="grid min-h-0 flex-1 gap-2 md:grid-rows-3 lg:p-3 lg:pt-0">
            {recentActivityItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex min-h-0 min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-background px-3 py-2.5"
                  data-mypage-desktop-recent-activity-row="true"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.accent}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="block truncate text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {item.impact}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.helper}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {item.value}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div
        className="grid min-w-0 gap-3 sm:gap-5 md:contents"
        data-mypage-profile-side-layout="matrix"
        data-mypage-profile-side-column="true"
      >
        {/* 비밀번호 변경 */}
        <Card
          className="min-w-0 md:order-2 md:col-start-2 md:row-start-1 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:border-border/70 md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"
          data-mypage-password-card="full-width"
        >
          <CardHeader className="shrink-0 lg:p-3 lg:pb-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-5 w-5" aria-hidden="true" />
              비밀번호 변경
            </CardTitle>
            <CardDescription className="lg:hidden">
              계정 보안을 위해 정기적으로 비밀번호를 변경해주세요
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 md:flex md:flex-1 md:flex-col lg:p-3 lg:pt-0">
            <form
              className="min-h-0 space-y-4 md:flex md:flex-1 md:flex-col lg:space-y-3"
              onSubmit={handlePasswordChange}
            >
              <div className="space-y-1.5">
                <Label htmlFor="current-password">현재 비밀번호</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    name="current-password"
                    autoComplete="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="현재 비밀번호를 입력하세요…"
                    className="lg:h-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    aria-label={
                      showCurrentPassword
                        ? "현재 비밀번호 숨기기"
                        : "현재 비밀번호 보기"
                    }
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-password">새 비밀번호</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    name="new-password"
                    autoComplete="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="새 비밀번호를 입력하세요…"
                    className="lg:h-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={
                      showNewPassword
                        ? "새 비밀번호 숨기기"
                        : "새 비밀번호 보기"
                    }
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    name="confirm-password"
                    autoComplete="new-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="새 비밀번호를 다시 입력하세요…"
                    className="lg:h-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={
                      showConfirmPassword
                        ? "새 비밀번호 확인 숨기기"
                        : "새 비밀번호 확인 보기"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div
                className="hidden rounded-2xl border border-border/70 bg-muted/25 px-3 py-3 md:block"
                data-mypage-password-guidance="true"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-foreground">
                    안전한 비밀번호 기준
                  </p>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    변경 전 확인
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                  <span className="rounded-xl bg-background px-2 py-2">
                    8-12자
                  </span>
                  <span className="rounded-xl bg-background px-2 py-2">
                    현재 비밀번호
                  </span>
                  <span className="rounded-xl bg-background px-2 py-2">
                    재입력 일치
                  </span>
                </div>
              </div>

              <Button
                type="submit"
                disabled={
                  loading || !currentPassword || !newPassword || !confirmPassword
                }
                className="w-full border border-transparent md:mt-auto lg:h-9 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
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
            </form>
          </CardContent>
        </Card>

        <Card
          className="min-w-0 border-border/70 md:order-4 md:col-start-2 md:row-start-2 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"
          data-mypage-danger-zone="true"
          data-mypage-danger-zone-layout="matrix-bottom-right"
        >
          <CardContent className="min-h-0 p-3 md:flex md:flex-1 md:flex-col lg:p-3">
            <details
              open
              className="group p-1 md:flex md:flex-1 md:flex-col lg:p-0"
            >
              <summary className="flex min-h-10 cursor-pointer touch-manipulation list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-9">
                <span>비활성화·삭제 옵션 보기</span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-3 grid gap-2 md:flex-1">
                <p
                  className="text-xs leading-5 text-muted-foreground"
                  data-mypage-danger-zone-guidance="compact"
                >
                  비활성화는 복구 가능, 완전 삭제는 복구 불가입니다.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="min-h-11 w-full touch-manipulation border-yellow-500 text-yellow-700 hover:bg-yellow-50 lg:min-h-9 lg:px-3"
                    >
                      <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
                      계정 비활성화
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        계정을 비활성화하시겠습니까?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        닉네임은 탈퇴한 사용자로 표시되고, 다시 로그인하면 복구할 수 있습니다.
                        계속하려면 계정 이메일을 입력하세요.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                      <Input
                        value={deactivateConfirmationEmail}
                        onChange={(e) =>
                          setDeactivateConfirmationEmail(e.target.value)
                        }
                        placeholder={user.email || ""}
                        className="text-center"
                        aria-label="계정 비활성화 확인 이메일"
                        name="deactivate-confirmation-email"
                        autoComplete="email"
                      />
                      {deactivateConfirmationEmail &&
                        deactivateConfirmationEmail !== user.email && (
                          <p className="text-sm text-destructive mt-2 text-center">
                            이메일이 일치하지 않습니다
                          </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        onClick={() => setDeactivateConfirmationEmail("")}
                      >
                        취소
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleAccountDeactivate}
                        className="bg-yellow-600 text-white hover:bg-yellow-700"
                        disabled={
                          loading || deactivateConfirmationEmail !== user.email
                        }
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

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      className="min-h-11 w-full touch-manipulation lg:min-h-9 lg:px-3"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      계정 완전 삭제
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        계정을 완전히 삭제하시겠습니까?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        이 작업은 되돌릴 수 없습니다. 계속하려면 계정 이메일을 입력하세요.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                      <Input
                        value={deleteConfirmationEmail}
                        onChange={(e) =>
                          setDeleteConfirmationEmail(e.target.value)
                        }
                        placeholder={user.email || ""}
                        className="text-center"
                        aria-label="계정 영구 삭제 확인 이메일"
                        name="delete-confirmation-email"
                        autoComplete="email"
                      />
                      {deleteConfirmationEmail &&
                        deleteConfirmationEmail !== user.email && (
                          <p className="text-sm text-destructive mt-2 text-center">
                            이메일이 일치하지 않습니다
                          </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        onClick={() => setDeleteConfirmationEmail("")}
                      >
                        취소
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleAccountPermanentDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={
                          loading || deleteConfirmationEmail !== user.email
                        }
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
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
