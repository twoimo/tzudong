"use client";

import { useState, useEffect, useCallback } from "react";
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
  LogOut,
  Bookmark,
  Camera,
  ChevronRight,
  MessageSquare,
  MapPin,
  Edit,
  X,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useUserProfile } from "@/hooks/useUserProfile";
import { cn } from "@/lib/utils";

interface Profile {
  nickname: string;
  avatar_url?: string;
}

const PROFILE_SELECT = "nickname, avatar_url";

export default function ProfilePage() {
  const { user, signOut, profileNickname } = useAuth();
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

  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      toast.error("로그아웃에 실패했습니다");
    }
  };

  const handlePasswordChange = async () => {
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
  const activityActions = [
    {
      href: "/mypage/bookmarks",
      icon: Bookmark,
      title: "저장한 맛집",
      description: `${bookmarks.length}개 저장됨`,
      accent: "bg-primary/10 text-primary",
      desktopAccent: "md:bg-primary/10 md:text-primary",
    },
    {
      href: "/mypage/reviews",
      icon: MessageSquare,
      title: "내 리뷰",
      description: "작성한 리뷰 관리",
      accent: "bg-sky-500/10 text-sky-600",
      desktopAccent: "md:bg-sky-500/10 md:text-sky-600",
    },
  ];
  const reportActions = [
    {
      href: "/mypage/submissions/new",
      icon: MapPin,
      title: "맛집 제보",
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
    {
      href: "/mypage/submissions/edit",
      icon: Edit,
      title: "수정 요청",
      description: "정보 바로잡기",
      accent: "bg-amber-500/10 text-amber-600",
    },
    {
      href: "/mypage/submissions/recommend",
      icon: Youtube,
      title: "쯔양 제보",
      description: "영상 속 맛집",
      accent: "bg-red-500/10 text-red-600",
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

  return (
    <div
      className="grid min-w-0 gap-3 sm:gap-5 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)] md:items-start lg:max-h-[calc(100dvh-6.25rem)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)] lg:gap-3 lg:overflow-hidden xl:max-h-[calc(100dvh-6rem)]"
      data-mypage-profile-page="true"
      data-mypage-profile-density="one-screen"
      data-mypage-profile-viewport-fit="true"
    >
      <div
        className="min-w-0 space-y-3 sm:space-y-5 md:order-1 lg:space-y-2.5"
        data-mypage-profile-main-column="true"
      >
        <Card
          className="overflow-hidden md:hidden"
          data-mypage-profile-hero="mobile-only"
        >
          <div
            className="flex flex-col items-center space-y-4 border-b border-border p-6 text-center md:hidden"
            data-mypage-profile-hero-layout="sidebar-match"
          >
            <div className="group relative h-24 w-24 shrink-0 rounded-full">
              <label
                htmlFor="mypage-mobile-avatar-upload"
                aria-label="프로필 사진 변경"
                className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-border shadow-sm transition-all group-hover:ring-2 group-hover:ring-primary/30 md:pointer-events-none"
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

            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl text-xs"
              onClick={handleLogout}
              data-mypage-profile-session-action="logout"
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              로그아웃
            </Button>
          </div>
        </Card>

        <Card
          className="overflow-hidden md:border-0 md:bg-transparent md:shadow-none"
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
                <div className="grid gap-2">
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
            className="hidden space-y-3 rounded-3xl border border-border/70 bg-background/85 p-3 shadow-sm backdrop-blur-sm md:block"
            data-mypage-desktop-quick-actions="list"
          >
            {quickActionSections.map((section) => (
              <section
                key={section.id}
                className="space-y-2"
                data-mypage-desktop-action-section={section.id}
              >
                <div className="flex items-end justify-between gap-2 px-1">
                  <h4 className="text-sm font-semibold">{section.title}</h4>
                  <p className="text-[11px] text-muted-foreground">
                    {section.helper}
                  </p>
                </div>
                <div className="grid gap-2">
                  {section.actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="group flex min-h-12 min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        data-mypage-desktop-action-row="true"
                        data-mypage-action-group={section.id}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${action.accent}`}
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
        </Card>
      </div>

      <div
        className="grid min-w-0 gap-3 sm:gap-5 md:order-2 lg:gap-3"
        data-mypage-profile-side-layout="right-stack"
        data-mypage-profile-side-column="true"
      >
        {/* 비밀번호 변경 */}
        <Card className="min-w-0" data-mypage-password-card="full-width">
          <CardHeader className="lg:p-3 lg:pb-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-5 w-5" aria-hidden="true" />
              비밀번호 변경
            </CardTitle>
            <CardDescription className="lg:hidden">
              계정 보안을 위해 정기적으로 비밀번호를 변경해주세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 lg:space-y-2 lg:p-3 lg:pt-0">
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
                    showNewPassword ? "새 비밀번호 숨기기" : "새 비밀번호 보기"
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

            <Button
              onClick={handlePasswordChange}
              disabled={
                loading || !currentPassword || !newPassword || !confirmPassword
              }
              className="w-full lg:h-9"
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
      </div>

      <Card
        className="min-w-0 border-destructive/30 md:order-3 md:col-span-2"
        data-mypage-danger-zone="true"
        data-mypage-danger-zone-layout="full-row"
      >
        <CardHeader className="pb-3 lg:p-3 lg:pb-1.5">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            계정 위험 작업
          </CardTitle>
          <CardDescription className="lg:hidden">
            자주 쓰지 않는 작업은 한곳에 모았습니다. 필요한 경우에만 열어
            처리하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="lg:p-3 lg:pt-0">
          <details className="group rounded-2xl border border-border bg-muted/20 p-3 lg:p-2.5">
            <summary className="flex min-h-11 cursor-pointer touch-manipulation list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-9">
              <span>비활성화·삭제 옵션 보기</span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 grid gap-2">
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
                    <AlertDialogDescription className="space-y-2">
                      <span className="block">계정을 비활성화하면:</span>
                      <span className="block">
                        • 닉네임이 &apos;탈퇴한 사용자&apos;로 변경됩니다
                      </span>
                      <span className="block">• 작성한 리뷰는 유지됩니다</span>
                      <span className="block">• 랭킹에서 제외됩니다</span>
                      <span className="block">
                        • 나중에 다시 로그인하면 복구할 수 있습니다
                      </span>
                      <span className="block mt-4">
                        계속하시려면 아래에 계정 이메일을 입력해주세요.
                      </span>
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
                      정말로 계정을 완전히 삭제하시겠습니까?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <span className="block font-semibold text-destructive">
                        이 작업은 되돌릴 수 없습니다.
                      </span>
                      <span className="block">계정을 완전히 삭제하면:</span>
                      <span className="block">
                        • 모든 개인 정보가 삭제됩니다
                      </span>
                      <span className="block">
                        • 작성한 리뷰는 &apos;탈퇴한 사용자&apos;로 유지됩니다
                      </span>
                      <span className="block">
                        • 다시는 이 계정으로 로그인할 수 없습니다
                      </span>
                      <span className="block mt-4">
                        계속하시려면 아래에 계정 이메일을 입력해주세요.
                      </span>
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
  );
}
