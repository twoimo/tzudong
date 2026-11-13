"use client";

import { isSupersededLogout } from "@/lib/auth/logout-result";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Camera,
  Edit,
  Loader2,
  LogOut,
  MessageSquare,
  Map,
  PlusCircle,
  Tv,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useHomeReturnHref } from "@/hooks/use-home-return-href";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/no-toast";
import {
  resolveProfileAvatarUrl,
} from "@/lib/profile-avatar-url";
import {
  clearCurrentProfileAvatar,
  updateCurrentProfileNickname,
  uploadCurrentProfileAvatar,
} from "@/lib/profile-mutation";
import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";
import { cn } from "@/lib/utils";
import { getTierDisplayName } from "./tier-display";

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
}

function SidebarItem({ href, icon, label, isActive }: SidebarItemProps) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function MyPageSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, signOut, profileNickname } = useAuth();
  const homeReturnHref = useHomeReturnHref(user?.id ?? null);
  const { data: profile } = useUserProfile(user?.id ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [isNicknameEditing, setIsNicknameEditing] = useState(false);

  const displayName = useMemo(
    () =>
      profile?.nickname ||
      profileNickname ||
      user?.email?.split("@")[0] ||
      "사용자",
    [profile?.nickname, profileNickname, user?.email],
  );

  useEffect(() => {
    if (!isNicknameEditing) {
      setNicknameInput(displayName);
    }
  }, [displayName, isNicknameEditing]);

  const refreshProfileAvatarQueries = async () => {
    if (!user) return;
    await invalidateProfileDisplayQueries(queryClient, user.id);
  };

  const handleNicknameChange = async () => {
    if (!user || !nicknameInput.trim()) {
      toast.error("닉네임을 입력해주세요");
      return;
    }

    const nextNickname = nicknameInput.trim();
    if (nextNickname.length < 2 || nextNickname.length > 20) {
      toast.error("닉네임은 2-20자 사이여야 합니다");
      return;
    }

    setNicknameSaving(true);
    try {
      await updateCurrentProfileNickname(supabase, user.id, nextNickname);

      await refreshProfileAvatarQueries();
      setIsNicknameEditing(false);
      router.refresh();
      toast.success("닉네임이 변경되었습니다");
    } catch {
      toast.error("닉네임 변경에 실패했습니다");
    } finally {
      setNicknameSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("이미지 크기는 2MB 이하여야 합니다");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드 가능합니다");
      return;
    }

    setAvatarUploading(true);
    try {
      const { compressImage } = await import("@/lib/image-utils");
      const compressedBlob = await compressImage(file);
      const result = await uploadCurrentProfileAvatar(
        supabase,
        user.id,
        profile?.avatarUrl ?? null,
        compressedBlob,
      );

      await refreshProfileAvatarQueries();
      router.refresh();
      if (result.cleanup.status === "pending") {
        toast.warning("프로필 사진은 변경되었지만 이전 사진 정리가 지연되고 있습니다");
      } else {
        toast.success("프로필 사진이 변경되었습니다");
      }
    } catch {
      try {
        await refreshProfileAvatarQueries();
      } catch {
        // The fixed failure remains fail closed when authoritative refresh is unavailable.
      }
      toast.error("이미지 업로드에 실패했습니다");
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  };

  const handleAvatarDelete = async () => {
    if (!user || profile?.avatarUrl === null || profile?.avatarUrl === undefined) return;
    if (!confirm("프로필 사진을 삭제하시겠습니까?")) return;

    setAvatarUploading(true);
    try {
      const result = await clearCurrentProfileAvatar(
        supabase,
        user.id,
        profile.avatarUrl,
      );

      await refreshProfileAvatarQueries();
      router.refresh();
      if (result.cleanup.status === "pending") {
        toast.warning("프로필 사진은 삭제되었지만 이전 사진 정리가 지연되고 있습니다");
      } else {
        toast.success("프로필 사진이 삭제되었습니다");
      }
    } catch {
      try {
        await refreshProfileAvatarQueries();
      } catch {
        // The fixed failure remains fail closed when authoritative refresh is unavailable.
      }
      toast.error("프로필 사진 삭제에 실패했습니다");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      if (isSupersededLogout(error)) return;
      toast.error("로그아웃에 실패했습니다");
    }
  };

  const menuItems = [
    {
      href: "/mypage/profile",
      icon: <User className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />,
      label: "내 프로필",
    },
    {
      divider: true,
    },
    {
      href: "/mypage/bookmarks",
      icon: <Bookmark className="h-4 w-4" />,
      label: "저장한 맛집",
    },
    {
      href: "/mypage/reviews",
      icon: <MessageSquare className="h-4 w-4" />,
      label: "내 리뷰",
    },
    {
      divider: true,
    },
    {
      href: "/mypage/submissions/new",
      icon: <PlusCircle className="h-4 w-4" />,
      label: "신규 맛집 제보 내역",
    },
    {
      href: "/mypage/submissions/edit",
      icon: <Edit className="h-4 w-4" />,
      label: "맛집 수정 요청 내역",
    },
    {
      href: "/mypage/submissions/recommend",
      icon: <Tv className="h-4 w-4" />,
      label: "쯔양 맛집 제보 내역",
    },
  ];

  if (!user) return null;

  const avatarUrl = resolveProfileAvatarUrl(profile?.avatarUrl, user.id);
  const hasAvatarReference =
    profile?.avatarUrl !== null && profile?.avatarUrl !== undefined;
  const isNicknameUnchanged = nicknameInput.trim() === displayName;

  return (
    <aside
      className="hidden h-full min-h-0 w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card md:flex"
      data-mypage-left-panel-expanded="true"
      data-layout-primitives="sidebar"
    >
      <div className="flex flex-col items-center space-y-3 border-b border-border p-4 text-center">
        <div className="group relative h-20 w-20 shrink-0 rounded-full">
          <label
            htmlFor="mypage-sidebar-avatar-upload"
            aria-label="프로필 사진 변경"
            className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
            style={{
              width: "5rem",
              height: "5rem",
              aspectRatio: "1 / 1",
              borderRadius: "9999px",
              overflow: "hidden",
            }}
          >
            {avatarUrl ? (
              <NextImage
                src={avatarUrl}
                alt={displayName}
                fill
                sizes="80px"
                className="rounded-full object-cover"
                style={{ borderRadius: "9999px" }}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center rounded-full bg-muted"
                style={{ borderRadius: "9999px" }}
              >
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
            )}

            <span
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 active:opacity-100"
              style={{ borderRadius: "9999px" }}
            >
              {avatarUploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              ) : (
                <Camera className="h-6 w-6 text-white" />
              )}
            </span>
            <input
              id="mypage-sidebar-avatar-upload"
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="sr-only"
              disabled={avatarUploading}
            />
          </label>

          {hasAvatarReference && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleAvatarDelete();
              }}
              className="absolute -right-3 -top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 group-focus-within:opacity-100"
              title="사진 삭제"
              aria-label="프로필 사진 삭제"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card"><X className="h-4 w-4" aria-hidden="true" /></span>
            </button>
          )}
        </div>

        <div
          className="flex w-full flex-col items-center space-y-2"
          data-mypage-sidebar-nickname-controls="true"
        >
          {isNicknameEditing ? (
            <div
              className="w-full space-y-2"
              data-mypage-sidebar-nickname-field="edit"
            >
              <Input
                id="mypage-sidebar-nickname"
                name="nickname"
                autoComplete="nickname"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                placeholder="닉네임"
                aria-label="닉네임"
                className="h-11 rounded-lg text-center text-base md:text-base"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-11 rounded-lg text-sm"
                  onClick={handleNicknameChange}
                  disabled={
                    nicknameSaving ||
                    !nicknameInput.trim() ||
                    isNicknameUnchanged
                  }
                >
                  {nicknameSaving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  저장
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 rounded-lg text-sm"
                  onClick={() => {
                    setNicknameInput(displayName);
                    setIsNicknameEditing(false);
                  }}
                  disabled={nicknameSaving}
                >
                  취소
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                닉네임은 2-20자 사이로 입력해주세요
              </p>
            </div>
          ) : (
            <div
              className="flex w-full flex-wrap items-center justify-center gap-x-2"
              data-mypage-sidebar-nickname-field="display"
            >
              <h3 className="max-w-full truncate text-base font-semibold">{displayName}</h3>
              {profile?.tier && (
                <Badge
                  variant="outline"
                  className="h-6 shrink-0 whitespace-nowrap border-border px-2 py-0 text-xs font-medium text-muted-foreground"
                >
                  {getTierDisplayName(profile.tier.name)}
                </Badge>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 min-w-11 rounded-lg px-2 text-xs text-muted-foreground"
                onClick={() => {
                  setNicknameInput(displayName);
                  setIsNicknameEditing(true);
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

        <div className="grid w-full grid-cols-3 gap-2 py-1">
          <div className="flex flex-col items-center p-2">
            <span className="mb-1 text-xs text-muted-foreground">도장</span>
            <span className="text-sm font-semibold tabular-nums">
              {profile?.verifiedReviewCount ?? 0}
            </span>
          </div>
          <div className="flex flex-col items-center border-x border-border p-2">
            <span className="mb-1 text-xs text-muted-foreground">리뷰</span>
            <span className="text-sm font-semibold tabular-nums">
              {profile?.reviewCount ?? 0}
            </span>
          </div>
          <div className="flex flex-col items-center p-2">
            <span className="mb-1 text-xs text-muted-foreground">좋아요</span>
            <span className="text-sm font-semibold tabular-nums">
              {profile?.totalLikes ?? 0}
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full rounded-lg text-sm text-muted-foreground"
          onClick={handleLogout}
          data-mypage-sidebar-session-action="logout"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          로그아웃
        </Button>
      </div>

      <nav aria-label="마이페이지" className="flex-1 space-y-1 px-3 py-3">
        {menuItems.map((item, index) => {
          if (item.divider) {
            return (
              <div
                key={index}
                className="mx-3 my-2 border-t border-border"
                aria-hidden="true"
              />
            );
          }

          const isActive = pathname === item.href;

          return (
            <SidebarItem
              key={item.href || index}
              href={item.href!}
              icon={item.icon}
              label={item.label!}
              isActive={isActive}
            />
          );
        })}
      </nav>
      <div className="sticky bottom-0 mt-auto border-t border-border bg-card p-4">
        <Button asChild variant="outline" className="min-h-11 w-full justify-center gap-2 rounded-xl">
          <Link href={homeReturnHref} data-mypage-return-to-map="true">
            <Map className="h-4 w-4" aria-hidden="true" />
            지도로 돌아가기
          </Link>
        </Button>
      </div>
    </aside>
  );
}
