"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInitialLoadPending } from '@/lib/use-initial-load-pending';
import { useFilledSkeletonCount } from "@/lib/use-filled-skeleton-count";
import {
  Ban,
  CheckCircle2,
  Crown,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type ManagedUser = {
  id: string;
  email: string;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  profileRole: string;
  isAdmin: boolean;
  isDisabled: boolean;
  bannedUntil: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  statusLabel: string;
  roleLabel: string;
};

type AdminUsersSummary = {
  loadedUsers: number;
  adminUsers: number;
  disabledUsers: number;
  unconfirmedUsers: number;
};

type AdminUsersResponse = {
  users: ManagedUser[];
  summary: AdminUsersSummary;
  page: number;
  perPage: number;
  total: number;
};
type AdminUserMutationResponse = {
  error?: string;
  message?: string;
  auditId?: string | null;
  preflightAuditId?: string | null;
  step?: string | null;
};

type AdminUserMutationAction = "profile" | "role" | "accountStatus";

type AdminUserMutationResult = {
  action: AdminUserMutationAction;
  targetUserId: string | null;
  status: "success" | "warning" | "error";
  message: string;
};

type EditableProfile = {
  nickname: string;
  username: string;
  avatarUrl: string;
};

type AdminUserMutationInput = {
  profile?: EditableProfile;
  role?: "admin" | "user";
  accountStatus?: "active" | "disabled";
};

type PendingAdminUserReadback = {
  action: AdminUserMutationAction;
  targetUserId: string;
  expected: Partial<Pick<ManagedUser, "nickname" | "username" | "avatarUrl" | "isAdmin" | "isDisabled">>;
  message: string;
  auditText: string;
};

function createPendingUserReadback(targetUserId: string, body: AdminUserMutationInput, action: AdminUserMutationAction, message: string): PendingAdminUserReadback {
  return {
    action,
    targetUserId,
    expected: body.profile ? {
      nickname: body.profile.nickname.trim(),
      username: body.profile.username.trim(),
      avatarUrl: body.profile.avatarUrl.trim() || null,
    } : body.role ? { isAdmin: body.role === "admin" } : { isDisabled: body.accountStatus === "disabled" },
    message,
    auditText: "",
  };
}

function matchesPendingUserReadback(users: ManagedUser[] | null, pending: PendingAdminUserReadback) {
  const actual = users?.find((candidate) => candidate.id === pending.targetUserId);
  if (!actual) return false;
  return Object.entries(pending.expected).every(([key, value]) => actual[key as keyof typeof pending.expected] === value);
}

const DEFAULT_SUMMARY: AdminUsersSummary = {
  loadedUsers: 0,
  adminUsers: 0,
  disabledUsers: 0,
  unconfirmedUsers: 0,
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getProfileForm(user: ManagedUser): EditableProfile {
  return {
    nickname: user.nickname,
    username: user.username,
    avatarUrl: user.avatarUrl ?? "",
  };
}
function getMutationAuditText(payload: AdminUserMutationResponse | null) {
  const auditEntries = [
    payload?.auditId ? `감사 ID: ${payload.auditId}` : "",
    payload?.preflightAuditId ? `사전 감사 ID: ${payload.preflightAuditId}` : "",
    payload?.step ? `단계: ${payload.step}` : "",
  ].filter(Boolean);

  return auditEntries.length > 0 ? ` ${auditEntries.join(" · ")}` : "";
}

function SummaryMetric({ label, value, tone = "default", isLoading = false }: { label: string; value: number | string; tone?: "default" | "danger" | "primary"; isLoading?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs",
        tone === "primary" && "border-primary/20 bg-primary/10",
        tone === "danger" && "border-destructive/20 bg-destructive/10",
      )}
      data-admin-users-summary-metric={label}
    >
      <p className="truncate text-xs leading-5 text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold tabular-nums text-foreground">
        {isLoading ? <span className="inline-block h-5 w-10 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none sm:h-6 sm:w-12" aria-hidden="true" /> : value}
      </p>
    </div>
  );
}

function UserTableSkeleton() {
  const { ref: mobileSkeletonRef, count: mobileSkeletonCount } = useFilledSkeletonCount(112, 4);
  const { ref: desktopSkeletonRef, count: desktopSkeletonCount } = useFilledSkeletonCount(56, 6, 36);
  return (
    <div ref={desktopSkeletonRef} role="status" aria-busy="true" aria-label="사용자 목록 로딩 중" data-admin-users-loading-list className="h-full min-h-0 flex-1">
      <span className="sr-only">사용자 목록을 불러오는 중입니다.</span>
      <div ref={mobileSkeletonRef} className="admin-cms-record-list divide-y divide-border md:hidden" aria-hidden="true">
        {Array.from({ length: mobileSkeletonCount }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border/70 bg-background/80 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className={cn("h-4 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-28" : "w-20")} />
                <Skeleton className="h-3.5 w-44 max-w-full rounded-full motion-reduce:animate-none" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0 rounded-full motion-reduce:animate-none" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Skeleton className="h-6 w-16 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-6 w-20 rounded-full motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <table className="admin-cms-table w-full table-fixed text-left text-sm">
          <caption className="sr-only">관리자 사용자 목록 로딩</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-[40%] px-3 py-2 font-semibold">사용자</th>
              <th scope="col" className="px-3 py-2 font-semibold">권한</th>
              <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">상태</th>
              <th scope="col" className="px-3 py-2 font-semibold">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 bg-background/70">
            {Array.from({ length: desktopSkeletonCount }).map((_, index) => (
              <tr key={index}>
                <td className="min-w-0 px-3 py-2 align-middle">
                  <button type="button" tabIndex={-1} className="block min-w-0 text-left" aria-hidden="true">
                    <span className="block truncate font-semibold text-foreground">
                      <Skeleton className={cn("h-5 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-28" : "w-20")} aria-hidden="true" />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <Skeleton className="h-4 w-40 max-w-full rounded-full motion-reduce:animate-none" aria-hidden="true" />
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2 align-middle">
                  <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
                    <Skeleton className="h-4 w-14 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </Badge>
                </td>
                <td className="hidden px-3 py-2 align-middle md:table-cell">
                  <Badge variant="secondary" className="border-transparent bg-emerald-50 text-emerald-800">
                    <Skeleton className="h-4 w-8 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </Badge>
                </td>
                <td className="px-3 py-2 align-middle">
                  <span className="inline-flex h-9 items-center justify-center rounded-md bg-muted/60 px-3 text-sm font-medium" aria-hidden="true">
                    <Skeleton className="h-5 w-6 rounded-full motion-reduce:animate-none" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ user }: { user: ManagedUser }) {
  if (user.isDisabled) {
    return <Badge variant="secondary" className="border-transparent bg-destructive/10 text-destructive">비활성</Badge>;
  }

  if (!user.emailConfirmedAt) {
    return <Badge variant="secondary" className="border-transparent bg-amber-50 text-amber-800">이메일 미확인</Badge>;
  }

  return <Badge variant="secondary" className="border-transparent bg-emerald-50 text-emerald-800">활성</Badge>;
}

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return isAdmin ? (
    <Badge className="bg-primary text-primary-foreground">관리자</Badge>
  ) : (
    <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">일반 사용자</Badge>
  );
}

export default function AdminUsersPanel({
  onInitialContentReady,
}: {
  onInitialContentReady?: () => void;
} = {}) {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [summary, setSummary] = useState<AdminUsersSummary>(DEFAULT_SUMMARY);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<EditableProfile>({ nickname: "", username: "", avatarUrl: "" });
  const [riskConfirmation, setRiskConfirmation] = useState("");
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [detailTab, setDetailTab] = useState("profile");
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [pendingIntent, setPendingIntent] = useState<{ type: "select"; id: string | null } | { type: "search"; query: string } | { type: "refresh" } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [mutationResult, setMutationResult] = useState<AdminUserMutationResult | null>(null);
  const [pendingReadback, setPendingReadback] = useState<PendingAdminUserReadback | null>(null);
  const pendingReadbackRef = useRef<PendingAdminUserReadback | null>(null);
  const usersReadGeneration = useRef(0);
  const updatePendingReadback = useCallback((pending: PendingAdminUserReadback | null) => {
    pendingReadbackRef.current = pending;
    setPendingReadback(pending);
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadPending = useInitialLoadPending(!isLoading);
  useLayoutEffect(() => {
    if (!onInitialContentReady || initialLoadPending) return;
    onInitialContentReady();
  }, [isLoading, initialLoadPending, onInitialContentReady]);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const currentUserId = currentUser?.id ?? null;
  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const isSelfSelected = Boolean(selectedUser && selectedUser.id === currentUserId);
  const canApplyRoleAction = riskConfirmation === "권한변경";
  const canDisableAction = accountConfirmation === "비활성화";
  const canReactivateAction = accountConfirmation === "재활성화";
  const isProfileDirty = Boolean(selectedUser && JSON.stringify(profileForm) !== JSON.stringify(getProfileForm(selectedUser)));
  const visibleUsers = useMemo(() => users
    .filter((managedUser) => userFilter === "admin" ? managedUser.isAdmin : userFilter === "disabled" ? managedUser.isDisabled : userFilter === "unconfirmed" ? !managedUser.emailConfirmedAt : true)
    .sort((a, b) => {
      if (sortOrder === "name") return a.nickname.localeCompare(b.nickname, "ko");
      const field = sortOrder === "lastSignIn" ? "lastSignInAt" : "createdAt";
      return (Date.parse(b[field] ?? "") || 0) - (Date.parse(a[field] ?? "") || 0);
    }), [users, userFilter, sortOrder]);

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    const generation = ++usersReadGeneration.current;
    const pendingAtReadStart = pendingReadbackRef.current;
    let readbackUsers: ManagedUser[] | null = null;
    setIsLoading(true);
    setErrorMessage("");

    try {
      if (pendingAtReadStart) {
        const exact = await fetch(`/api/admin/users?${new URLSearchParams({ user_id: pendingAtReadStart.targetUserId })}`, { signal, cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await exact.json().catch(() => null) as AdminUsersResponse | null;
        if (!exact.ok || !payload || !Array.isArray(payload.users) || payload.users.length !== 1 || payload.users[0].id !== pendingAtReadStart.targetUserId) throw new Error("user_readback_unavailable");
        if (generation !== usersReadGeneration.current || signal?.aborted) return null;
        readbackUsers = payload.users;
        if (pendingReadbackRef.current === pendingAtReadStart && matchesPendingUserReadback(readbackUsers, pendingAtReadStart)) {
          updatePendingReadback(null);
          setMutationResult({ action: pendingAtReadStart.action, targetUserId: pendingAtReadStart.targetUserId, status: "success", message: `적용 완료: ${pendingAtReadStart.message}${pendingAtReadStart.auditText} 상태를 다시 확인했습니다.` });
          toast({ title: "상태 재확인 완료", description: "요청한 사용자 상태를 확인했습니다." });
        }
      }
      const params = new URLSearchParams({ perPage: "120" });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as AdminUsersResponse | { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : "사용자 목록을 불러오지 못했습니다.");
      }

      if (!payload || !("users" in payload) || !Array.isArray(payload.users)) {
        throw new Error("사용자 목록 응답을 확인하지 못했습니다.");
      }
      if (generation !== usersReadGeneration.current || signal?.aborted) return null;
      const nextUsers = payload.users;
      const nextSummary = "summary" in (payload ?? {}) ? (payload as AdminUsersResponse).summary : DEFAULT_SUMMARY;
      setUsers(nextUsers);
      setSummary(nextSummary);
      setSelectedUserId((current) => {
        if (current && nextUsers.some((candidate) => candidate.id === current)) return current;
        return null;
      });
      return readbackUsers ?? nextUsers;
    } catch (error) {
      if (generation !== usersReadGeneration.current) return null;
      if ((error as Error).name !== "AbortError") {
        setErrorMessage("사용자 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      }
      return readbackUsers;
    } finally {
      if (generation === usersReadGeneration.current && !signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [searchQuery, updatePendingReadback, toast]);

  useEffect(() => {
    const controller = new AbortController();
    void loadUsers(controller.signal);
    return () => controller.abort();
  }, [loadUsers]);

  useEffect(() => {
    if (!selectedUser) {
      setProfileForm({ nickname: "", username: "", avatarUrl: "" });
      setRiskConfirmation("");
      setAccountConfirmation("");
      return;
    }

    setProfileForm(getProfileForm(selectedUser));
    setRiskConfirmation("");
    setAccountConfirmation("");
  }, [selectedUser]);

  useEffect(() => {
    setMutationResult((current) => {
      if (pendingReadbackRef.current) return current;
      if (!current?.targetUserId) return current;
      return current.targetUserId === selectedUser?.id ? current : null;
    });
  }, [selectedUser?.id]);

  const applyIntent = (intent: NonNullable<typeof pendingIntent>) => {
    if (pendingReadback && intent.type === "select") return;
    setPendingIntent(null);
    if (intent.type === "select") {
      setSelectedUserId(intent.id);
      setDetailTab("profile");
      if (intent.id) requestAnimationFrame(() => detailRef.current?.focus());
    } else if (intent.type === "search") {
      setSearchInput(intent.query);
      setSearchQuery(intent.query);
    } else {
      void loadUsers();
    }
  };
  const requestIntent = (intent: NonNullable<typeof pendingIntent>) => {
    if (isMutating || (pendingReadback && intent.type === "select")) return;
    if (intent.type === "select" && intent.id === selectedUserId) {
      detailRef.current?.focus();
      return;
    }
    if (pendingReadback) {
      applyIntent(intent);
      return;
    }
    if (isProfileDirty) setPendingIntent(intent);
    else applyIntent(intent);
  };

  const patchSelectedUser = async (
    body: AdminUserMutationInput,
    successMessage: string,
    action: AdminUserMutationAction,
  ) => {
    if (!selectedUser || isMutating || isLoading || errorMessage || pendingReadbackRef.current) return;
    setIsMutating(true);
    setPendingIntent(null);
    setMutationResult(null);
    const expectedReadback = createPendingUserReadback(selectedUser.id, body, action, successMessage);
    updatePendingReadback(expectedReadback);

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...body, confirmation: action === "accountStatus" ? accountConfirmation : riskConfirmation }),
      });
      const payload = await response.json().catch(() => null) as AdminUserMutationResponse | null;
      const auditText = getMutationAuditText(payload);
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) updatePendingReadback(null);
        throw new Error(`${payload?.error ?? "사용자 변경을 적용하지 못했습니다."}${auditText}`);
      }

      const message = payload?.message ?? successMessage;
      const pending = { ...expectedReadback, message, auditText };
      updatePendingReadback(pending);
      const nextUsers = await loadUsers();
      const refreshed = matchesPendingUserReadback(nextUsers, pending);
      setMutationResult({
        action,
        targetUserId: selectedUser.id,
        status: refreshed ? "success" : "warning",
        message: refreshed
          ? `적용 완료: ${message}${auditText} 상태를 다시 확인했습니다.`
          : `변경 결과 재확인 필요: ${message}${auditText} 조회 결과가 요청한 상태와 일치하는지 새로고침으로 확인해 주세요.`,
      });
      toast({ title: refreshed ? "적용 완료" : "적용 완료 · 재조회 필요", description: message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "사용자 변경을 적용하지 못했습니다.";
      const uncertain = Boolean(pendingReadbackRef.current);
      setMutationResult({
        action,
        targetUserId: selectedUser.id,
        status: uncertain ? "warning" : "error",
        message: uncertain ? "변경 결과를 확인하지 못했습니다. 중복 적용하지 말고 새로고침으로 요청한 상태를 확인해 주세요." : `적용 실패: ${message}`,
      });
      toast({ title: uncertain ? "변경 결과 재확인 필요" : "적용 실패", description: uncertain ? "목록에서 요청한 상태를 다시 확인해 주세요." : message, variant: "destructive" });
    } finally {
      setIsMutating(false);
      setRiskConfirmation("");
      setAccountConfirmation("");
    }
  };

  const visibleMutationResult = pendingReadback ? mutationResult :
    !mutationResult?.targetUserId || mutationResult.targetUserId === selectedUser?.id
      ? mutationResult
      : null;
  const mutationResultMessage = visibleMutationResult?.message ?? "";

  const inspectorContent = (
        <div ref={detailRef} tabIndex={-1} className={cn("admin-cms-inspector !p-0 flex h-full min-h-0 flex-col overflow-hidden bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary", isNarrow && "!w-full !flex-auto")} aria-label="사용자 상세">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-card shadow-none">
      {pendingIntent && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 p-2 text-sm text-amber-950">
          <span className="flex-1">저장하지 않은 프로필 변경이 있습니다.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPendingIntent(null)}>계속 편집</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { if (selectedUser) setProfileForm(getProfileForm(selectedUser)); applyIntent(pendingIntent); }}>변경 버리고 이동</Button>
        </div>
      )}
            <CardHeader className="admin-cms-inspector-header sticky top-0 z-10 flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b bg-card px-3 py-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />사용자 상세</CardTitle>
              {selectedUser && detailTab === "profile" && <Button type="button" size="sm" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || !isProfileDirty} onClick={() => void patchSelectedUser({ profile: profileForm }, "프로필 정보를 저장했습니다.", "profile")}><Save className="h-4 w-4" aria-hidden="true" />{isMutating ? "적용 중…" : "프로필 저장"}</Button>}
              {selectedUser && <Button type="button" variant="ghost" size="sm" disabled={isMutating || Boolean(pendingReadback)} onClick={() => requestIntent({ type: "select", id: null })}><X className="h-4 w-4" aria-hidden="true" />{isNarrow ? "목록으로" : "선택 해제"}</Button>}
            </CardHeader>
            {pendingReadback && <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="min-w-0 flex-1">이전 변경을 재확인한 후 다음 작업을 진행할 수 있습니다.</span><Button type="button" size="sm" variant="outline" disabled={isLoading || isMutating} onClick={() => requestIntent({ type: "refresh" })}>상태 재확인</Button></div>}
            {selectedUser && <div className="flex shrink-0 gap-1 border-b px-3 py-1" role="tablist" aria-label="사용자 상세 작업" onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "profile" : event.key === "End" ? "access" : detailTab === "profile" ? "access" : "profile"; setDetailTab(next); document.getElementById(`user-${next}-tab`)?.focus(); }}>
              <button type="button" role="tab" tabIndex={detailTab === "profile" ? 0 : -1} id="user-profile-tab" aria-selected={detailTab === "profile"} aria-controls="user-profile-panel" className={cn("rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", detailTab === "profile" ? "bg-primary/10 text-primary" : "text-muted-foreground")} onClick={() => setDetailTab("profile")}>프로필</button>
              <button type="button" role="tab" tabIndex={detailTab === "access" ? 0 : -1} id="user-access-tab" aria-selected={detailTab === "access"} aria-controls="user-access-panel" className={cn("rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", detailTab === "access" ? "bg-primary/10 text-primary" : "text-muted-foreground")} onClick={() => setDetailTab("access")}>권한·계정</button>
            </div>}
            <CardContent className="admin-cms-inspector-body min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {!selectedUser ? (
                <div className="admin-cms-empty flex min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.
                </div>
              ) : (
                <>
                  <div className="rounded-lg bg-muted/25 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-foreground">{selectedUser.nickname}</p>
                        <p className="truncate text-sm text-muted-foreground">{selectedUser.email || selectedUser.id}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <RoleBadge isAdmin={selectedUser.isAdmin} />
                        <StatusBadge user={selectedUser} />
                        {isSelfSelected && <Badge variant="secondary" className="border-transparent bg-primary/10 text-primary">현재 로그인 계정</Badge>}
                      </div>
                    </div>
                    <details className="mt-3 border-t pt-2"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">계정 정보</summary><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">가입일</dt><dd className="mt-1 text-foreground">{formatDateTime(selectedUser.createdAt)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">최근 로그인</dt><dd className="mt-1 text-foreground">{formatDateTime(selectedUser.lastSignInAt)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">사용자 ID</dt><dd className="mt-1 break-all font-mono text-xs text-foreground">{selectedUser.id}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">비활성 만료</dt><dd className="mt-1 text-foreground">{formatDateTime(selectedUser.bannedUntil)}</dd></div>
                    </dl></details>
                  </div>

                  <div id="user-profile-panel" role="tabpanel" aria-labelledby="user-profile-tab" hidden={detailTab !== "profile"} className="grid gap-3 sm:grid-cols-2 [&[hidden]]:hidden">
                    <div className="space-y-1">
                      <Label htmlFor="selected-nickname">닉네임</Label>
                      <Input disabled={isMutating || isLoading || Boolean(pendingReadback)} id="selected-nickname" value={profileForm.nickname} onChange={(event) => setProfileForm((current) => ({ ...current, nickname: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-username">사용자명</Label>
                      <Input disabled={isMutating || isLoading || Boolean(pendingReadback)} id="selected-username" value={profileForm.username} onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="selected-avatar">아바타 URL</Label>
                      <Input disabled={isMutating || isLoading || Boolean(pendingReadback)} id="selected-avatar" value={profileForm.avatarUrl} onChange={(event) => setProfileForm((current) => ({ ...current, avatarUrl: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="md:col-span-2">
                      {isProfileDirty && <span className="ml-2 text-xs text-amber-800" role="status">저장하지 않은 변경</span>}
                      {isProfileDirty && <Button type="button" variant="ghost" size="sm" disabled={isMutating || Boolean(pendingReadback)} onClick={() => setProfileForm(getProfileForm(selectedUser))}>되돌리기</Button>}
                    </div>
                  </div>

                  <div id="user-access-panel" role="tabpanel" aria-labelledby="user-access-tab" hidden={detailTab !== "access"} className="space-y-3">
                  <Separator />
                  <p className="text-xs leading-5 text-muted-foreground">자기 잠금 방지: 본인 계정과 마지막 활성 관리자의 권한 회수·비활성화는 차단됩니다.{isProfileDirty && " 프로필을 저장하거나 되돌린 후 권한·계정을 변경하세요."}</p>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-amber-950">
                      <Crown className="h-4 w-4" aria-hidden="true" />
                      권한 변경 전 확인
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-amber-900">
                      관리자 권한은 사용자 데이터와 운영 액션에 영향을 줍니다. 적용하려면 아래 입력칸에 <strong>권한변경</strong>을 입력하세요.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input aria-label="권한 변경 확인 문구" value={riskConfirmation} onChange={(event) => setRiskConfirmation(event.target.value)} placeholder="권한변경" className="rounded-xl bg-background" />
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || isProfileDirty || selectedUser.isAdmin || !canApplyRoleAction} onClick={() => void patchSelectedUser({ role: "admin" }, "관리자 권한을 부여했습니다.", "role")}>
                        관리자 부여
                      </Button>
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || isProfileDirty || !selectedUser.isAdmin || isSelfSelected || !canApplyRoleAction} onClick={() => void patchSelectedUser({ role: "user" }, "관리자 권한을 회수했습니다.", "role")}>
                        권한 회수
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-destructive">
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      계정 처리 전 확인
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      영구 삭제 대신 계정 상태를 변경합니다. <strong>{selectedUser.isDisabled ? "재활성화" : "비활성화"}</strong>를 입력하세요.
                    </p>
                    <Input aria-label="계정 상태 변경 확인 문구" value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} placeholder={selectedUser.isDisabled ? "재활성화" : "비활성화"} className="mt-2 bg-background" />
                    <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap">
                      <Button type="button" variant="destructive" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || isProfileDirty || selectedUser.isDisabled || isSelfSelected || !canDisableAction} onClick={() => void patchSelectedUser({ accountStatus: "disabled" }, "계정을 비활성화했습니다.", "accountStatus")}>
                        <Ban className="h-4 w-4" aria-hidden="true" />
                        계정 비활성화
                      </Button>
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || isProfileDirty || !selectedUser.isDisabled || !canReactivateAction} onClick={() => void patchSelectedUser({ accountStatus: "active" }, "계정을 재활성화했습니다.", "accountStatus")}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        재활성화
                      </Button>
                    </div>
                  </div>
                  </div>
                </>
              )}

              <p
                className="min-h-5 text-sm text-muted-foreground"
                aria-live="polite"
                data-admin-user-mutation-action={visibleMutationResult?.action ?? undefined}
                data-admin-user-mutation-target={visibleMutationResult?.targetUserId ?? undefined}
              >
                {mutationResultMessage}
              </p>
              {visibleMutationResult?.status === "warning" && <p role="alert" className="text-sm text-amber-800">중복 적용하지 말고 목록을 새로고침해 확인해 주세요.</p>}
              {visibleMutationResult?.status === "success" && (
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  상태 재확인이 완료되었습니다.
                </p>
              )}
            </CardContent>
          </Card>
          <details className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">새 계정 안내</summary>
            <p className="mt-2 leading-5">새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다. 관리자 화면에서는 계정을 만들 수 없습니다.</p>
          </details>
        </div>
  );

  return (
    <section
      aria-labelledby="admin-users-title"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-admin-embedded-module-shell="true"
      data-admin-embedded-module-id="users"
    >
      <AdminPageHeader title="사용자 관리" titleId="admin-users-title" titleAs="h2" icon={UsersRound}
        data-admin-module-header="compact" data-admin-module-header-module="users"
        summary={<div className="flex flex-wrap gap-1" data-admin-users-summary data-admin-module-summary="true">
            <SummaryMetric label="불러온 사용자" value={summary.loadedUsers} isLoading={isLoading && users.length === 0} />
            <SummaryMetric label="관리자" value={summary.adminUsers} isLoading={isLoading && users.length === 0} />
            <SummaryMetric label="비활성" value={summary.disabledUsers} isLoading={isLoading && users.length === 0} />
            <SummaryMetric label="이메일 미확인" value={summary.unconfirmedUsers} isLoading={isLoading && users.length === 0} />
          </div>}
      />


      <div className="admin-cms-workspace grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]" data-admin-module-content="bounded">
        <Card className="admin-cms-list-pane flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-card shadow-none xl:border-r">
          <CardHeader className="admin-cms-toolbar sticky top-0 z-10 shrink-0 !flex-row space-y-0 bg-card" data-admin-users-toolbar>
            <CardTitle className="sr-only">사용자 목록</CardTitle>
            <form
              className="flex w-full min-w-0 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                requestIntent({ type: "search", query: searchInput });
              }}
            >
              <Label htmlFor="admin-user-search" className="sr-only">닉네임, 이메일, 사용자 ID로 검색</Label>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="admin-user-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="닉네임, 이메일, 사용자 ID로 검색"
                  className="h-9 rounded-md pl-9"
                />
              </div>
              <Button type="submit" className="h-9 shrink-0 rounded-md" disabled={isLoading || isMutating} data-admin-users-search-submit>검색</Button>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-md" aria-label="사용자 목록 새로고침" onClick={() => requestIntent({ type: "refresh" })} disabled={isLoading || isMutating} data-admin-users-refresh>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
              </Button>
            </form>
            <div className="flex w-full flex-wrap items-center gap-2">
              <select aria-label="사용자 상태 필터" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs">
                <option value="all">모든 사용자</option><option value="admin">관리자</option><option value="disabled">비활성</option><option value="unconfirmed">이메일 미확인</option>
              </select>
              <select aria-label="사용자 정렬" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"><option value="newest">가입 최신순</option><option value="lastSignIn">최근 로그인순</option><option value="name">닉네임순</option></select>
              {(searchQuery || userFilter !== "all") && <Button type="button" variant="ghost" size="sm" onClick={() => { setUserFilter("all"); requestIntent({ type: "search", query: "" }); }}>검색·필터 초기화</Button>}
            </div>
            {errorMessage && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                <span className="flex-1">{errorMessage}{users.length > 0 && " 이전 목록을 표시합니다."}</span>
                <Button type="button" variant="outline" size="sm" disabled={isLoading || isMutating} onClick={() => requestIntent({ type: "refresh" })}>다시 시도</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="admin-cms-table-container min-h-0 flex-1 space-y-0 overflow-y-auto p-0">
            {isLoading && users.length === 0 ? (
              <UserTableSkeleton />
            ) : errorMessage && users.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">목록을 확인한 후 사용자 작업을 진행할 수 있습니다.</div>
            ) : visibleUsers.length === 0 ? (
              <div className="rounded-lg bg-muted/25 p-4 text-center text-sm text-muted-foreground">
                {searchQuery || userFilter !== "all" ? "검색·필터에 맞는 사용자가 없습니다. 조건을 초기화해 보세요." : "등록된 사용자가 없습니다."}
              </div>
            ) : (
              <div data-admin-users-list>
                <div className="admin-cms-record-list divide-y divide-border md:hidden">
                  {visibleUsers.map((managedUser) => {
                    const isSelected = managedUser.id === selectedUser?.id;
                    return (
                      <article
                        key={managedUser.id}
                        className={cn(
                          "admin-cms-record-row border-l-2 border-transparent px-3 py-2",
                          isSelected && "admin-cms-row-selected border-l-primary bg-primary/5",
                        )}
                        data-selected={isSelected ? "true" : "false"}
                        data-admin-users-mobile-card
                        data-admin-users-selected={isSelected ? "true" : "false"}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">{managedUser.nickname}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{managedUser.email || managedUser.id}</p>
                          </div>
                          <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="h-8 shrink-0 rounded-md" onClick={() => requestIntent({ type: "select", id: managedUser.id })} aria-pressed={isSelected} disabled={isMutating || Boolean(pendingReadback)} aria-label={`${managedUser.nickname} 상세 보기`} data-admin-users-detail-button>
                            {isSelected ? "선택됨" : "상세"}
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="사용자 상태 요약">
                          <RoleBadge isAdmin={managedUser.isAdmin} />
                          <StatusBadge user={managedUser} />
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="admin-cms-record-list hidden overflow-hidden md:block">
                  <table className="admin-cms-table w-full table-fixed text-left text-sm">
                    <caption className="sr-only">관리자 사용자 목록</caption>
                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="w-[40%] px-3 py-2 font-semibold">사용자</th>
                        <th scope="col" className="px-3 py-2 font-semibold">권한</th>
                        <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">상태</th>
                        <th scope="col" className="px-3 py-2 font-semibold">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-background/70">
                      {visibleUsers.map((managedUser) => {
                        const isSelected = managedUser.id === selectedUser?.id;
                        return (
                          <tr key={managedUser.id} data-selected={isSelected ? "true" : "false"} className={cn("admin-cms-record-row", isSelected && "admin-cms-row-selected bg-primary/5")}>
                            <td className="min-w-0 px-3 py-2 align-middle">
                              <button
                                type="button"
                                className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                onClick={() => requestIntent({ type: "select", id: managedUser.id })}
                                disabled={isMutating || Boolean(pendingReadback)}
                                aria-pressed={isSelected}
                                aria-label={`${managedUser.nickname} 상세 보기`}
                              >
                                <span className="block truncate font-semibold text-foreground">{managedUser.nickname}</span>
                                <span className="block truncate text-xs text-muted-foreground">{managedUser.email || managedUser.id}</span>
                              </button>
                            </td>
                            <td className="px-3 py-2 align-middle"><RoleBadge isAdmin={managedUser.isAdmin} /></td>
                            <td className="hidden px-3 py-2 align-middle md:table-cell"><StatusBadge user={managedUser} /></td>
                            <td className="px-3 py-2 align-middle">
                              <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="h-8 rounded-md" disabled={isMutating || Boolean(pendingReadback)} aria-pressed={isSelected} onClick={() => requestIntent({ type: "select", id: managedUser.id })} data-admin-users-detail-button>
                                상세
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
          <div className="admin-cms-footer shrink-0 justify-between" aria-live="polite"><span className="tabular-nums">{visibleUsers.length} / {users.length}명</span><span>불러온 최대 120명 기준</span></div>
        </Card>

        {!isNarrow && inspectorContent}
        {isNarrow && <Sheet open={Boolean(selectedUser) || Boolean(pendingReadback)} onOpenChange={(open) => { if (!open) requestIntent({ type: "select", id: null }); }}>
          <SheetContent className="admin-cms-drawer flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(640px,100vw)] sm:max-w-none [&>button:last-child]:hidden" onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("admin-user-search")?.focus(); }}>
            <SheetTitle className="sr-only">사용자 상세</SheetTitle>
            <SheetDescription className="sr-only">선택한 사용자의 프로필과 권한·계정 상태를 확인합니다.</SheetDescription>
            {inspectorContent}
          </SheetContent>
        </Sheet>}
      </div>
    </section>
  );
}
