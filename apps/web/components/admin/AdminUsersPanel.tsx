"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  ADMIN_USER_DISPLAY_FIELD_LABELS,
  ADMIN_USER_DISPLAY_FIELDS,
} from "@/lib/admin/admin-user-display";
import { RISKY_WORK_STEPS } from "@/lib/admin/risky-work-procedure";
import { sanitizePrivacyValue } from "@/lib/privacy/sanitize";
import { cn } from "@/lib/utils";

type ManagedUser = {
  id: string;
  emailMaskToken: string;
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
  status: "success" | "error";
  message: string;
};

type EditableProfile = {
  nickname: string;
  username: string;
  avatarUrl: string;
};

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
        "min-w-0 rounded-2xl border border-border/70 bg-muted/25 px-3 py-2 shadow-sm sm:rounded-lg sm:border-0 sm:bg-muted/35 sm:shadow-none",
        tone === "primary" && "border-primary/20 bg-primary/10",
        tone === "danger" && "border-destructive/20 bg-destructive/10",
      )}
      data-admin-users-summary-metric={label}
    >
      <p className="truncate text-[11px] font-medium leading-4 text-muted-foreground sm:text-xs">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-6 tracking-[-0.04em] text-foreground sm:text-xl">
        {isLoading ? <span className="inline-block h-5 w-10 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none sm:h-6 sm:w-12" aria-hidden="true" /> : value}
      </p>
    </div>
  );
}

function UserTableSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="사용자 목록 로딩 중" data-admin-users-loading-list>
      <span className="sr-only">사용자 목록을 불러오는 중입니다.</span>
      <div className="grid gap-2 md:hidden" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
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
        <table className="w-full text-left text-sm">
          <caption className="sr-only">관리자 사용자 목록 로딩</caption>
          <thead className="bg-muted/35 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">사용자</th>
              <th scope="col" className="px-3 py-2 font-semibold">권한</th>
              <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">상태</th>
              <th scope="col" className="px-3 py-2 font-semibold">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 bg-background/70">
            {Array.from({ length: 6 }).map((_, index) => (
              <tr key={index}>
                <td className="min-w-0 px-3 py-3 align-top">
                  <button type="button" tabIndex={-1} className="block min-w-0 text-left" aria-hidden="true">
                    <span className="block truncate font-semibold text-foreground">
                      <Skeleton className={cn("h-5 rounded-full motion-reduce:animate-none", index % 2 === 0 ? "w-28" : "w-20")} aria-hidden="true" />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <Skeleton className="h-4 w-40 max-w-full rounded-full motion-reduce:animate-none" aria-hidden="true" />
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3 align-top">
                  <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
                    <Skeleton className="h-4 w-14 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </Badge>
                </td>
                <td className="hidden px-3 py-3 align-top md:table-cell">
                  <Badge variant="secondary" className="border-transparent bg-emerald-50 text-emerald-800">
                    <Skeleton className="h-4 w-8 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </Badge>
                </td>
                <td className="px-3 py-3 align-top">
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

export default function AdminUsersPanel() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [summary, setSummary] = useState<AdminUsersSummary>(DEFAULT_SUMMARY);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<EditableProfile>({ nickname: "", username: "", avatarUrl: "" });
  const [riskConfirmation, setRiskConfirmation] = useState("");
  const [mutationResult, setMutationResult] = useState<AdminUserMutationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const currentUserId = currentUser?.id ?? null;
  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const isSelfSelected = Boolean(selectedUser && selectedUser.id === currentUserId);
  const canApplyRoleAction = riskConfirmation === "권한변경";
  const canDisableAction = riskConfirmation === "비활성화";
  const canReactivateAction = riskConfirmation === "재활성화";

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({ perPage: "120" });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as AdminUsersResponse | { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : "사용자 목록을 불러오지 못했습니다.");
      }

      const nextUsers = "users" in (payload ?? {}) ? (payload as AdminUsersResponse).users : [];
      const nextSummary = "summary" in (payload ?? {}) ? (payload as AdminUsersResponse).summary : DEFAULT_SUMMARY;
      setUsers(nextUsers);
      setSummary(nextSummary);
      setSelectedUserId((current) => {
        if (current && nextUsers.some((candidate) => candidate.id === current)) return current;
        return null;
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setErrorMessage(error instanceof Error ? error.message : "사용자 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    void loadUsers(controller.signal);
    return () => controller.abort();
  }, [loadUsers]);

  useEffect(() => {
    if (!selectedUser) {
      setProfileForm({ nickname: "", username: "", avatarUrl: "" });
      setRiskConfirmation("");
      return;
    }

    setProfileForm(getProfileForm(selectedUser));
    setRiskConfirmation("");
  }, [selectedUser]);

  useEffect(() => {
    setMutationResult((current) => {
      if (!current?.targetUserId) return current;
      return current.targetUserId === selectedUser?.id ? current : null;
    });
  }, [selectedUser?.id]);

  const patchSelectedUser = async (
    body: Record<string, unknown>,
    successMessage: string,
    action: AdminUserMutationAction,
  ) => {
    if (!selectedUser) return;
    setIsMutating(true);
    setMutationResult(null);

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...body, confirmation: riskConfirmation }),
      });
      const payload = await response.json().catch(() => null) as AdminUserMutationResponse | null;
      const auditText = getMutationAuditText(payload);
      if (!response.ok) {
        throw new Error(`${payload?.error ?? "사용자 변경을 적용하지 못했습니다."}${auditText}`);
      }

      const message = payload?.message ?? successMessage;
      setMutationResult({
        action,
        targetUserId: selectedUser.id,
        status: "success",
        message: `적용 완료: ${message}${auditText} 상태를 다시 확인했습니다.`,
      });
      toast({ title: "적용 완료", description: message });
      await loadUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "사용자 변경을 적용하지 못했습니다.";
      setMutationResult({
        action,
        targetUserId: selectedUser.id,
        status: "error",
        message: `적용 실패: ${message}`,
      });
      toast({ title: "적용 실패", description: message, variant: "destructive" });
    } finally {
      setIsMutating(false);
      setRiskConfirmation("");
    }
  };

  const visibleMutationResult =
    !mutationResult?.targetUserId || mutationResult.targetUserId === selectedUser?.id
      ? mutationResult
      : null;
  const mutationResultMessage = visibleMutationResult?.message ?? "";

  return (
    <section
      aria-labelledby="admin-users-title"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-admin-embedded-module-shell="true"
      data-admin-embedded-module-id="users"
    >
      <div
        className="shrink-0 border-b border-border bg-card px-2 py-1.5"
        data-admin-module-header="compact"
        data-admin-module-header-module="users"
      >
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">계정·권한 운영</p>
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <h2 id="admin-users-title" className="whitespace-nowrap bg-gradient-primary bg-clip-text text-base font-bold text-transparent">
                사용자 관리
              </h2>
            </div>
            <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
              계정 상태, 관리자 권한, 프로필 정보를 한 화면에서 확인하고 위험 변경은 재확인 후 적용합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2" aria-label="사용자 관리 안전 원칙" data-admin-module-actions="top-right">
            {['관리자 확인 필수', '자기 잠금 방지', '상태 재확인', '삭제 대신 비활성화'].map((label) => (
              <Badge key={label} variant="outline" className="max-w-full rounded-full border-primary/25 bg-background px-2.5 text-[11px] text-primary sm:text-xs">{label}</Badge>
            ))}
            {RISKY_WORK_STEPS.map((step) => (
              <Badge key={step} variant="secondary" className="max-w-full rounded-full px-2.5 text-[11px] sm:text-xs">{step}</Badge>
            ))}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-2 xl:grid-cols-4" data-admin-users-summary data-admin-module-summary="true">
          <SummaryMetric label="불러온 사용자" value={summary.loadedUsers} tone="primary" isLoading={isLoading} />
          <SummaryMetric label="관리자" value={summary.adminUsers} isLoading={isLoading} />
          <SummaryMetric label="비활성 계정" value={summary.disabledUsers} tone={summary.disabledUsers > 0 ? 'danger' : 'default'} isLoading={isLoading} />
          <SummaryMetric label="이메일 미확인" value={summary.unconfirmedUsers} isLoading={isLoading} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] xl:grid-cols-[minmax(340px,0.95fr)_minmax(400px,1.05fr)] xl:overflow-hidden xl:p-2" data-admin-module-content="bounded">
        <Card className="min-h-0 border-border bg-card shadow-sm xl:flex xl:flex-col xl:overflow-hidden">
          <CardHeader className="shrink-0 space-y-2 p-2 pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">사용자 목록</CardTitle>
              <Button type="button" variant="outline" size="sm" className="h-9 w-full rounded-full sm:w-auto sm:rounded-lg" onClick={() => void loadUsers()} disabled={isLoading || isMutating} data-admin-users-refresh>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
                새로고침
              </Button>
            </div>
            <form
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                setSearchQuery(searchInput);
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
                  className="h-9 rounded-full pl-9 sm:rounded-lg"
                />
              </div>
              <Button type="submit" className="h-9 w-full rounded-full sm:w-auto sm:rounded-lg" data-admin-users-search-submit>검색</Button>
            </form>
            {errorMessage && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 p-2 pt-0 xl:overflow-y-auto">
            {isLoading ? (
              <UserTableSkeleton />
            ) : users.length === 0 ? (
              <div className="rounded-lg bg-muted/25 p-4 text-center text-sm text-muted-foreground">
                조건에 맞는 사용자가 없습니다. 필터를 줄이거나 전체 보기로 돌아가세요.
              </div>
            ) : (
              <div data-admin-users-list>
                <div className="grid gap-2 md:hidden">
                  {users.map((managedUser) => {
                    const isSelected = managedUser.id === selectedUser?.id;
                    return (
                      <article
                        key={managedUser.id}
                        className={cn(
                          "rounded-2xl border border-border/70 bg-background/85 p-3 shadow-sm",
                          isSelected && "border-primary/40 bg-primary/5",
                        )}
                        data-admin-users-mobile-card
                        data-admin-users-selected={isSelected ? "true" : "false"}
                      >
                        <button
                          type="button"
                          className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => setSelectedUserId(managedUser.id)}
                          aria-label={`${managedUser.nickname} 상세 보기`}
                        >
                          <span className="block truncate text-sm font-semibold text-foreground">{managedUser.nickname}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{managedUser.emailMaskToken || managedUser.id}</span>
                        </button>
                        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="사용자 상태 요약">
                          <RoleBadge isAdmin={managedUser.isAdmin} />
                          <StatusBadge user={managedUser} />
                        </div>
                        <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="mt-3 h-9 w-full rounded-full" onClick={() => setSelectedUserId(managedUser.id)} data-admin-users-detail-button>
                          상세
                        </Button>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden overflow-hidden rounded-lg md:block">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">관리자 사용자 목록</caption>
                    <thead className="bg-muted/35 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">사용자</th>
                        <th scope="col" className="px-3 py-2 font-semibold">권한</th>
                        <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">상태</th>
                        <th scope="col" className="px-3 py-2 font-semibold">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-background/70">
                      {users.map((managedUser) => {
                        const isSelected = managedUser.id === selectedUser?.id;
                        return (
                          <tr key={managedUser.id} className={cn(isSelected && "bg-primary/5")}>
                            <td className="min-w-0 px-3 py-3 align-top">
                              <button
                                type="button"
                                className="block min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                onClick={() => setSelectedUserId(managedUser.id)}
                                aria-label={`${managedUser.nickname} 상세 보기`}
                              >
                                <span className="block truncate font-semibold text-foreground">{managedUser.nickname}</span>
                                <span className="block truncate text-xs text-muted-foreground">{managedUser.emailMaskToken || managedUser.id}</span>
                              </button>
                            </td>
                            <td className="px-3 py-3 align-top"><RoleBadge isAdmin={managedUser.isAdmin} /></td>
                            <td className="hidden px-3 py-3 align-top md:table-cell"><StatusBadge user={managedUser} /></td>
                            <td className="px-3 py-3 align-top">
                              <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="rounded-lg" onClick={() => setSelectedUserId(managedUser.id)} data-admin-users-detail-button>
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
        </Card>

        <div className="min-h-0 space-y-2 xl:overflow-y-auto">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="p-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                새 계정 안내
              </CardTitle>
              <p className="text-xs leading-5 text-muted-foreground">
                새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.
              </p>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              <p className="text-sm leading-6 text-muted-foreground">
                정책·연령·보호자 확인이 포함된 가입 흐름을 완료해야 합니다. 관리자 화면에서는 계정을 만들 수 없습니다.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="p-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                상세·위험 변경
              </CardTitle>
              <p className="text-xs leading-5 text-muted-foreground">
                권한 변경과 계정 비활성화는 입력 확인 후 적용합니다. 마지막 관리자와 본인 계정 잠금은 서버에서 차단됩니다.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 p-2 pt-0">
              {!selectedUser ? (
                <div className="rounded-lg bg-muted/25 p-4 text-center text-sm text-muted-foreground">
                  사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.
                </div>
              ) : (
                <>
                  <div className="rounded-lg bg-muted/25 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-foreground">{selectedUser.nickname}</p>
                        <p className="truncate text-sm text-muted-foreground">{selectedUser.emailMaskToken}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <RoleBadge isAdmin={selectedUser.isAdmin} />
                        <StatusBadge user={selectedUser} />
                        {isSelfSelected && <Badge variant="secondary" className="border-transparent bg-primary/10 text-primary">현재 로그인 계정</Badge>}
                      </div>
                    </div>
                    <dl
                      className="mt-3 grid gap-2 text-sm sm:grid-cols-2"
                      data-admin-user-display-fields={ADMIN_USER_DISPLAY_FIELDS.join(" ")}
                    >
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.accountId}</dt><dd className="mt-1 break-all font-mono text-xs text-foreground">{selectedUser.id}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.displayName}</dt><dd className="mt-1 text-foreground">{selectedUser.nickname}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.role}</dt><dd className="mt-1 text-foreground">{selectedUser.roleLabel}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.status}</dt><dd className="mt-1 text-foreground">{selectedUser.statusLabel}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.createdAt}</dt><dd className="mt-1 text-foreground">{formatDateTime(selectedUser.createdAt)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.lastLoginAt}</dt><dd className="mt-1 text-foreground">{formatDateTime(selectedUser.lastSignInAt)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.emailConfirmed}</dt><dd className="mt-1 text-foreground">{selectedUser.emailConfirmedAt ? "확인됨" : "미확인"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">{ADMIN_USER_DISPLAY_FIELD_LABELS.emailMaskToken}</dt><dd className="mt-1 break-all font-mono text-xs text-foreground">{sanitizePrivacyValue(selectedUser.emailMaskToken).value as string}</dd></div>
                    </dl>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="selected-nickname">닉네임</Label>
                      <Input id="selected-nickname" value={profileForm.nickname} onChange={(event) => setProfileForm((current) => ({ ...current, nickname: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-username">사용자명</Label>
                      <Input id="selected-username" value={profileForm.username} onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="selected-avatar">아바타 URL</Label>
                      <Input id="selected-avatar" value={profileForm.avatarUrl} onChange={(event) => setProfileForm((current) => ({ ...current, avatarUrl: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="md:col-span-2">
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating} onClick={() => void patchSelectedUser({ profile: profileForm }, "프로필 정보를 저장했습니다.", "profile")}>
                        <Save className="h-4 w-4" aria-hidden="true" />
                        프로필 저장
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-amber-950">
                      <Crown className="h-4 w-4" aria-hidden="true" />
                      권한 변경 전 확인
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-amber-900">
                      관리자 권한은 사용자 데이터와 운영 액션에 영향을 줍니다. 적용하려면 아래 입력칸에 <strong>권한변경</strong>을 입력하세요.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <Input aria-label="권한 변경 확인 문구" value={riskConfirmation} onChange={(event) => setRiskConfirmation(event.target.value)} placeholder="권한변경 / 비활성화 / 재활성화" className="rounded-xl bg-background" />
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || selectedUser.isAdmin || !canApplyRoleAction} onClick={() => void patchSelectedUser({ role: "admin" }, "관리자 권한을 부여했습니다.", "role")}>
                        관리자 부여
                      </Button>
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || !selectedUser.isAdmin || isSelfSelected || !canApplyRoleAction} onClick={() => void patchSelectedUser({ role: "user" }, "관리자 권한을 회수했습니다.", "role")}>
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
                      영구 삭제 대신 비활성화/재활성화를 우선 사용합니다. 비활성화하려면 확인 문구에 <strong>비활성화</strong>를 입력하세요.
                    </p>
                    <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                      <Button type="button" variant="destructive" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || selectedUser.isDisabled || isSelfSelected || !canDisableAction} onClick={() => void patchSelectedUser({ accountStatus: "disabled" }, "계정을 비활성화했습니다.", "accountStatus")}>
                        <Ban className="h-4 w-4" aria-hidden="true" />
                        계정 비활성화
                      </Button>
                      <Button type="button" variant="outline" className="w-full rounded-full sm:w-auto sm:rounded-lg" disabled={isMutating || !selectedUser.isDisabled || !canReactivateAction} onClick={() => void patchSelectedUser({ accountStatus: "active" }, "계정을 재활성화했습니다.", "accountStatus")}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        재활성화
                      </Button>
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
                {mutationResultMessage || "변경 결과는 적용 후 상태를 다시 읽어 확인합니다."}
              </p>
              {visibleMutationResult?.status === "success" && (
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  상태 재확인이 완료되었습니다.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
