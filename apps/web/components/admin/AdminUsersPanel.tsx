"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getAdminModuleTitle } from "@/lib/admin/admin-module-metadata";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInitialLoadPending } from '@/lib/use-initial-load-pending';
import { useFilledSkeletonCount } from "@/lib/use-filled-skeleton-count";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  sourceTotal: number;
  isPartial: boolean;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};
type AdminUserMutationResponse = {
  error?: string;
  message?: string;
  auditId?: string | null;
  preflightAuditId?: string | null;
  step?: string | null;
  audit?: {
    readbackId?: string | null;
    correlationId?: string | null;
    auditIds?: string[];
  } | null;
  auditIds?: string[];
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

type AdminUserReadbackConflict = {
  pending: PendingAdminUserReadback;
  latest: ManagedUser;
};

type PendingAdminUserIntent =
  | { type: "select"; id: string | null }
  | { type: "search"; query: string }
  | { type: "filter"; filter: AdminUsersFilter }
  | { type: "sort"; sort: AdminUsersSort }
  | { type: "page"; page: number }
  | { type: "reset" }
  | { type: "refresh" };

type AdminUsersPagination = Pick<AdminUsersResponse, 'page' | 'perPage' | 'total' | 'sourceTotal' | 'isPartial' | 'hasPreviousPage' | 'hasNextPage'>;
type AdminUsersFilter = 'all' | 'admin' | 'disabled' | 'unconfirmed';
type AdminUsersSort = 'newest' | 'lastSignIn' | 'name';

const ADMIN_USERS_PER_PAGE = 120;
const DEFAULT_PAGINATION: AdminUsersPagination = {
  page: 1,
  perPage: ADMIN_USERS_PER_PAGE,
  total: 0,
  sourceTotal: 0,
  isPartial: false,
  hasPreviousPage: false,
  hasNextPage: false,
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

function mergeExactUserReadback(users: ManagedUser[], exactUser: ManagedUser) {
  return users.map((candidate) => candidate.id === exactUser.id ? exactUser : candidate);
}

function isExactAdminUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

const listDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  hour12: false,
});

function formatListDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return listDateTimeFormatter.format(date);
}

function getProfileForm(user: ManagedUser): EditableProfile {
  return {
    nickname: user.nickname,
    username: user.username,
    avatarUrl: user.avatarUrl ?? "",
  };
}
function getMutationAuditText(payload: AdminUserMutationResponse | null) {
  const readbackId = payload?.audit?.readbackId ?? payload?.auditId;
  const correlationId = payload?.audit?.correlationId ?? payload?.preflightAuditId;
  const auditEntries = [
    readbackId ? `감사 ID: ${readbackId}` : "",
    correlationId ? `사전 감사 ID: ${correlationId}` : "",
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
          <div key={index} className="rounded-md border border-border/70 bg-background p-3">
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
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
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
  const [userFilter, setUserFilter] = useState<AdminUsersFilter>("all");
  const [sortOrder, setSortOrder] = useState<AdminUsersSort>("newest");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<AdminUsersPagination>(DEFAULT_PAGINATION);
  const [detailTab, setDetailTab] = useState("profile");
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [pendingIntent, setPendingIntent] = useState<PendingAdminUserIntent | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [mutationResult, setMutationResult] = useState<AdminUserMutationResult | null>(null);
  const [pendingReadback, setPendingReadback] = useState<PendingAdminUserReadback | null>(null);
  const [readbackConflict, setReadbackConflict] = useState<AdminUserReadbackConflict | null>(null);
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
  const visibleUsers = users;
  const countsUnknown = Boolean(errorMessage) && users.length === 0;
  const showUnreadUsersSkeleton = isLoading && users.length === 0 && !countsUnknown;

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    const generation = ++usersReadGeneration.current;
    const pendingAtReadStart = pendingReadbackRef.current;
    let readbackUsers: ManagedUser[] | null = null;
    setIsLoading(true);

    try {
      if (pendingAtReadStart) {
        const exact = await fetch(`/api/admin/users?${new URLSearchParams({ user_id: pendingAtReadStart.targetUserId })}`, { signal, cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await exact.json().catch(() => null) as AdminUsersResponse | null;
        if (!exact.ok || !payload || !Array.isArray(payload.users) || payload.users.length !== 1 || payload.users[0].id !== pendingAtReadStart.targetUserId) throw new Error("user_readback_unavailable");
        if (generation !== usersReadGeneration.current || signal?.aborted) return null;
        readbackUsers = payload.users;
        if (pendingReadbackRef.current === pendingAtReadStart) {
          const latest = readbackUsers[0];
          setUsers((current) => mergeExactUserReadback(current, latest));
          if (matchesPendingUserReadback(readbackUsers, pendingAtReadStart)) {
            setReadbackConflict(null);
            updatePendingReadback(null);
            setMutationResult({ action: pendingAtReadStart.action, targetUserId: pendingAtReadStart.targetUserId, status: "success", message: `적용 완료: ${pendingAtReadStart.message}${pendingAtReadStart.auditText} 상태를 다시 확인했습니다.` });
            toast({ title: "상태 재확인 완료", description: "요청한 사용자 상태를 확인했습니다." });
          } else {
            setReadbackConflict({ pending: pendingAtReadStart, latest });
            setMutationResult({ action: pendingAtReadStart.action, targetUserId: pendingAtReadStart.targetUserId, status: "warning", message: `요청한 상태와 다른 최신 사용자 상태를 확인했습니다.${pendingAtReadStart.auditText} 최신 상태를 수용하면 추가 변경 없이 잠금을 해제합니다.` });
            toast({ title: "최신 상태 확인 필요", description: "요청과 다른 최신 사용자 상태를 확인했습니다." });
          }
        }
      }
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(ADMIN_USERS_PER_PAGE),
        filter: userFilter,
        sort: sortOrder,
      });
      const normalizedSearch = searchQuery.trim();
      if (normalizedSearch) params.set(isExactAdminUserId(normalizedSearch) ? "user_id" : "search", normalizedSearch);

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
      if (!Number.isFinite(payload.page) || !Number.isFinite(payload.perPage) || !Number.isFinite(payload.total)) {
        throw new Error("사용자 목록 페이지 응답을 확인하지 못했습니다.");
      }
      if (generation !== usersReadGeneration.current || signal?.aborted) return null;
      setErrorMessage("");
      const nextUsers = payload.users;
      const nextSummary = "summary" in (payload ?? {}) ? (payload as AdminUsersResponse).summary : DEFAULT_SUMMARY;
      setUsers(nextUsers);
      setSummary(nextSummary);
      setPagination({
        page: payload.page,
        perPage: payload.perPage,
        total: payload.total,
        sourceTotal: Number.isFinite(payload.sourceTotal) ? payload.sourceTotal : payload.total,
        isPartial: payload.isPartial === true,
        hasPreviousPage: payload.hasPreviousPage === true,
        hasNextPage: payload.hasNextPage === true,
      });
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
  }, [page, searchQuery, sortOrder, toast, updatePendingReadback, userFilter]);

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

  const cancelPendingIntent = () => {
    setPendingIntent(null);
    setSearchInput(searchQuery);
  };

  const applyIntent = (intent: PendingAdminUserIntent) => {
    setPendingIntent(null);
    if (intent.type === "select") {
      setSelectedUserId(intent.id);
      setDetailTab("profile");
      if (intent.id) requestAnimationFrame(() => detailRef.current?.focus());
    } else if (intent.type === "search") {
      setSearchInput(intent.query);
      setSearchQuery(intent.query);
      setPage(1);
    } else if (intent.type === "filter") {
      setUserFilter(intent.filter);
      setPage(1);
    } else if (intent.type === "sort") {
      setSortOrder(intent.sort);
      setPage(1);
    } else if (intent.type === "page") {
      setPage(intent.page);
    } else if (intent.type === "reset") {
      setSearchInput("");
      setSearchQuery("");
      setUserFilter("all");
      setPage(1);
    } else {
      void loadUsers();
    }
  };
  const requestIntent = (intent: PendingAdminUserIntent) => {
    if (isMutating || (pendingReadback && intent.type !== "refresh")) return;
    if (pendingReadback && intent.type === "refresh") {
      applyIntent(intent);
      return;
    }
    if (intent.type === "select" && intent.id === selectedUserId) {
      detailRef.current?.focus();
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
    setReadbackConflict(null);
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
        if (response.status >= 400 && response.status < 500) {
          setReadbackConflict(null);
          updatePendingReadback(null);
        }
        throw new Error(`${payload?.error ?? "사용자 변경을 적용하지 못했습니다."}${auditText}`);
      }

      const message = payload?.message ?? successMessage;
      const pending = { ...expectedReadback, message, auditText };
      updatePendingReadback(pending);
      const nextUsers = await loadUsers();
      // loadUsers already reported a returned exact readback, whether it matched or conflicted.
      if (nextUsers?.some((candidate) => candidate.id === pending.targetUserId)) return;
      setMutationResult({
        action,
        targetUserId: selectedUser.id,
        status: "warning",
        message: `변경 결과 재확인 필요: ${message}${auditText} 조회 결과가 요청한 상태와 일치하는지 새로고침으로 확인해 주세요.`,
      });
      toast({ title: "적용 완료 · 재조회 필요", description: message });
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

  const acceptLatestUserReadback = () => {
    const conflict = readbackConflict;
    if (!conflict || pendingReadbackRef.current !== conflict.pending || isMutating) return;
    setUsers((current) => mergeExactUserReadback(current, conflict.latest));
    updatePendingReadback(null);
    setReadbackConflict(null);
    setMutationResult({
      action: conflict.pending.action,
      targetUserId: conflict.pending.targetUserId,
      status: "warning",
      message: `요청한 상태와 달랐던 최신 사용자 상태를 수용했습니다.${conflict.pending.auditText} 추가 변경은 적용하지 않았습니다.`,
    });
    toast({ title: "최신 상태 수용", description: "추가 변경 없이 사용자 상태 잠금을 해제했습니다." });
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
          <Button type="button" variant="outline" size="sm" onClick={cancelPendingIntent}>계속 편집</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { if (selectedUser) setProfileForm(getProfileForm(selectedUser)); applyIntent(pendingIntent); }}>변경 버리고 이동</Button>
        </div>
      )}
            <CardHeader className="admin-cms-inspector-header sticky top-0 z-10 flex min-h-11 shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b bg-card px-3 py-2 md:min-h-10">
              <CardTitle className="admin-section-title flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />사용자 상세</CardTitle>
              {selectedUser && detailTab === "profile" && <Button type="button" size="sm" disabled={isMutating || isLoading || Boolean(errorMessage) || Boolean(pendingReadback) || !isProfileDirty} onClick={() => void patchSelectedUser({ profile: profileForm }, "프로필 정보를 저장했습니다.", "profile")}><Save className="h-4 w-4" aria-hidden="true" />{isMutating ? "적용 중…" : "프로필 저장"}</Button>}
              {selectedUser && <Button type="button" variant="ghost" size="sm" disabled={isMutating || Boolean(pendingReadback)} onClick={() => requestIntent({ type: "select", id: null })}><X className="h-4 w-4" aria-hidden="true" />{isNarrow ? "목록으로" : "선택 해제"}</Button>}
            </CardHeader>
            {pendingReadback && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="min-w-0 flex-1">{readbackConflict ? "요청과 다른 최신 상태를 확인했습니다. 최신 상태를 수용하거나 다시 확인해 주세요." : "이전 변경을 재확인한 후 다음 작업을 진행할 수 있습니다."}</span>{readbackConflict && <Button type="button" size="sm" variant="outline" disabled={isLoading || isMutating} onClick={acceptLatestUserReadback}>최신 상태 수용</Button>}<Button type="button" size="sm" variant="outline" disabled={isLoading || isMutating} onClick={() => requestIntent({ type: "refresh" })}>상태 재확인</Button></div>}
            {selectedUser && <div className="flex shrink-0 gap-1 border-b px-3 py-1" role="tablist" aria-label="사용자 상세 작업" onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "profile" : event.key === "End" ? "access" : detailTab === "profile" ? "access" : "profile"; setDetailTab(next); document.getElementById(`user-${next}-tab`)?.focus(); }}>
              <button type="button" role="tab" tabIndex={detailTab === "profile" ? 0 : -1} id="user-profile-tab" aria-selected={detailTab === "profile"} aria-controls="user-profile-panel" className={cn("rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", detailTab === "profile" ? "bg-primary/10 text-primary" : "text-muted-foreground")} onClick={() => setDetailTab("profile")}>프로필</button>
              <button type="button" role="tab" tabIndex={detailTab === "access" ? 0 : -1} id="user-access-tab" aria-selected={detailTab === "access"} aria-controls="user-access-panel" className={cn("rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", detailTab === "access" ? "bg-primary/10 text-primary" : "text-muted-foreground")} onClick={() => setDetailTab("access")}>권한·계정</button>
            </div>}
            <CardContent className="admin-cms-inspector-body min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {!selectedUser ? (
                <div className="admin-empty-state admin-cms-empty flex min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.
                </div>
              ) : (
                <>
                  <section className="admin-detail-section p-3" aria-label="선택한 사용자 요약">
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
                  </section>

                  <div id="user-profile-panel" role="tabpanel" aria-labelledby="user-profile-tab" hidden={detailTab !== "profile"} className="grid gap-3 sm:grid-cols-2 [&[hidden]]:hidden">
                    <div className="space-y-1">
                      <Label htmlFor="selected-nickname" className="admin-field-label">닉네임</Label>
                      <Input disabled={isMutating || isLoading || Boolean(pendingReadback)} id="selected-nickname" value={profileForm.nickname} onChange={(event) => setProfileForm((current) => ({ ...current, nickname: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="selected-username" className="admin-field-label">사용자명</Label>
                      <Input disabled={isMutating || isLoading || Boolean(pendingReadback)} id="selected-username" value={profileForm.username} onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value }))} className="rounded-lg" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="selected-avatar" className="admin-field-label">아바타 URL</Label>
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
      <AdminPageHeader title={getAdminModuleTitle("users")} titleId="admin-users-title" icon={UsersRound} className="admin-cms-page-header"
        data-admin-module-header="compact" data-admin-module-header-module="users"
        summary={<div className="flex flex-wrap gap-1" data-admin-users-summary data-admin-module-summary="true">
            <SummaryMetric label="전체 사용자" value={countsUnknown ? "미확인" : pagination.sourceTotal} isLoading={showUnreadUsersSkeleton} />
            <SummaryMetric label="조건 일치" value={countsUnknown ? "미확인" : pagination.total} isLoading={showUnreadUsersSkeleton} />
            <SummaryMetric label="현재 페이지" value={countsUnknown ? "미확인" : summary.loadedUsers} isLoading={showUnreadUsersSkeleton} />
          </div>}
        actions={<Button type="button" variant="ghost" size="sm" aria-label="사용자 목록 새로고침" onClick={() => { if (isLoading || isMutating || pendingReadback) return; requestIntent({ type: "refresh" }); }} disabled={isMutating || Boolean(pendingReadback)} aria-disabled={isLoading || isMutating || Boolean(pendingReadback)} aria-busy={isLoading} data-admin-users-refresh>
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />새로고침
        </Button>}
      />


      <div className="admin-surface admin-cms-workspace grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]" data-admin-module-content="bounded">
        <Card className="admin-cms-list-pane flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-card shadow-none xl:border-r">
          <CardHeader className="admin-toolbar admin-cms-toolbar sticky top-0 z-10 shrink-0 !flex-row space-y-0 bg-card" data-admin-users-toolbar>
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
                  disabled={isMutating || Boolean(pendingReadback)}
                  placeholder="닉네임, 이메일, 사용자 ID로 검색"
                  className="h-11 rounded-md pl-9 md:h-8"
                />
              </div>
              <Button type="submit" className="h-11 shrink-0 rounded-md px-4 md:h-8" disabled={isLoading || isMutating || Boolean(pendingReadback)} data-admin-users-search-submit>검색</Button>
            </form>
            <div className="flex w-full flex-wrap items-center gap-2">
              <select aria-label="사용자 상태 필터" value={userFilter} disabled={isMutating || Boolean(pendingReadback)} onChange={(event) => requestIntent({ type: "filter", filter: event.target.value as AdminUsersFilter })} className="h-11 min-w-0 rounded-md border border-input bg-background px-2 text-xs md:h-8">
                <option value="all">모든 사용자</option><option value="admin">관리자</option><option value="disabled">비활성</option><option value="unconfirmed">이메일 미확인</option>
              </select>
              <select aria-label="사용자 정렬" value={sortOrder} disabled={isMutating || Boolean(pendingReadback)} onChange={(event) => requestIntent({ type: "sort", sort: event.target.value as AdminUsersSort })} className="h-11 min-w-0 rounded-md border border-input bg-background px-2 text-xs md:h-8"><option value="newest">가입 최신순</option><option value="lastSignIn">최근 로그인순</option><option value="name">닉네임순</option></select>
              {(searchQuery || userFilter !== "all") && <Button type="button" variant="ghost" size="sm" disabled={isMutating || Boolean(pendingReadback)} onClick={() => requestIntent({ type: "reset" })}>검색·필터 초기화</Button>}
            </div>
            {errorMessage && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                <span className="flex-1">{errorMessage}{users.length > 0 && " 이전 목록을 표시합니다."}</span>
                <Button type="button" variant="outline" size="sm" aria-disabled={isLoading || isMutating} aria-busy={isLoading} onClick={() => { if (isLoading || isMutating) return; requestIntent({ type: "refresh" }); }}>다시 시도</Button>
              </div>
            )}
            {pagination.isPartial && !errorMessage && (
              <div role="status" className="w-full rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                검색·필터·정렬은 최대 1,000명 범위의 결과입니다. 전체 {pagination.sourceTotal.toLocaleString()}명 중 이후 사용자는 사용자 ID 검색으로 확인해 주세요.
              </div>
            )}
          </CardHeader>
          <CardContent className="admin-cms-table-container min-h-0 flex-1 space-y-0 overflow-y-auto p-0">
            {showUnreadUsersSkeleton ? (
              <UserTableSkeleton />
            ) : errorMessage && users.length === 0 ? (
              <div className="admin-empty-state p-4 text-center text-sm text-muted-foreground">목록을 확인한 후 사용자 작업을 진행할 수 있습니다.</div>
            ) : visibleUsers.length === 0 ? (
              <div className="admin-empty-state p-4 text-center text-sm text-muted-foreground">
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
                          <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="h-11 shrink-0 rounded-md md:h-8" onClick={() => requestIntent({ type: "select", id: managedUser.id })} aria-pressed={isSelected} disabled={isMutating || Boolean(pendingReadback)} aria-label={`${managedUser.nickname} 상세 보기${sortOrder === "lastSignIn" ? `, 최근 로그인 ${formatListDateTime(managedUser.lastSignInAt)}` : ""}`} data-admin-users-detail-button>
                            {isSelected ? "선택됨" : "상세"}
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="사용자 상태 요약">
                          <RoleBadge isAdmin={managedUser.isAdmin} />
                          <StatusBadge user={managedUser} />
                          {sortOrder === "lastSignIn" && <span className="self-center whitespace-nowrap text-xs tabular-nums text-muted-foreground">로그인 {formatListDateTime(managedUser.lastSignInAt)}</span>}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="admin-cms-record-list hidden overflow-hidden md:block">
                  <table className="admin-cms-table w-full table-fixed text-left text-sm">
                    <caption className="sr-only">관리자 사용자 목록</caption>
                    <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
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
                                aria-label={`${managedUser.nickname} 상세 보기${sortOrder === "lastSignIn" ? `, 최근 로그인 ${formatListDateTime(managedUser.lastSignInAt)}` : ""}`}
                              >
                                <span className="block truncate font-semibold text-foreground">{managedUser.nickname}</span>
                                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                                  <span className="min-w-0 truncate">{managedUser.email || managedUser.id}</span>
                                  {sortOrder === "lastSignIn" && <span className="shrink-0 tabular-nums">· 로그인 {formatListDateTime(managedUser.lastSignInAt)}</span>}
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-2 align-middle"><RoleBadge isAdmin={managedUser.isAdmin} /></td>
                            <td className="hidden px-3 py-2 align-middle md:table-cell"><StatusBadge user={managedUser} /></td>
                            <td className="px-3 py-2 align-middle">
                              <Button type="button" variant={isSelected ? "default" : "outline"} size="sm" className="h-11 rounded-md md:h-8" disabled={isMutating || Boolean(pendingReadback)} aria-pressed={isSelected} onClick={() => requestIntent({ type: "select", id: managedUser.id })} data-admin-users-detail-button>
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
          <div className="admin-cms-footer shrink-0 justify-between gap-2" aria-live="polite">
            <span className="tabular-nums">{countsUnknown ? "조회 실패" : `${visibleUsers.length}명 · 조건 일치 ${pagination.total.toLocaleString()}명 · 전체 ${pagination.sourceTotal.toLocaleString()}명`}</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-11 px-2 md:h-8" aria-label="이전 사용자 페이지" disabled={!pagination.hasPreviousPage || isMutating || Boolean(pendingReadback) || undefined} aria-disabled={!pagination.hasPreviousPage || isLoading || isMutating || Boolean(pendingReadback) || undefined} aria-busy={isLoading || undefined} onClick={() => { if (!pagination.hasPreviousPage || isLoading || isMutating || pendingReadback) return; const target = pagination.page - 1; if (target === page) requestIntent({ type: "refresh" }); else requestIntent({ type: "page", page: target }); }}><ChevronLeft className="h-4 w-4" aria-hidden="true" />이전</Button>
              <span className="min-w-14 text-center tabular-nums">{pagination.page} / {Math.max(1, Math.ceil(pagination.total / pagination.perPage))}</span>
              <Button type="button" variant="outline" size="sm" className="h-11 px-2 md:h-8" aria-label="다음 사용자 페이지" disabled={!pagination.hasNextPage || isMutating || Boolean(pendingReadback) || undefined} aria-disabled={!pagination.hasNextPage || isLoading || isMutating || Boolean(pendingReadback) || undefined} aria-busy={isLoading || undefined} onClick={() => { if (!pagination.hasNextPage || isLoading || isMutating || pendingReadback) return; const target = pagination.page + 1; if (target === page) requestIntent({ type: "refresh" }); else requestIntent({ type: "page", page: target }); }}>다음<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          </div>
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
