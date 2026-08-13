"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
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
} from "lucide-react";
import { YouTubeIcon } from "@/components/icons/YouTubeIcon";
import Link from "next/link";
import { useBookmarks } from "@/hooks/use-bookmarks";
import {
  getNextUserTierProgress,
  useUserProfile,
} from "@/hooks/useUserProfile";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_DELETION_CONFIRMATION_TEXT,
  clearAccountDeletionBrowserStores,
  createAccountDeletionIdempotencyKey,
  parseAccountDeletionPreview,
  parseAccountDeletionReceipt,
  type AccountDeletionPreview,
  type AccountDeletionReceipt,
} from "@/lib/privacy/account-deletion";
import {
  createAccountDeletionReauthenticationSession,
  issueAccountDeletionReauthenticationProof,
} from "@/lib/privacy/account-deletion-reauth";
import {
  resolveProfileAvatarUrl,
} from "@/lib/profile-avatar-url";
import {
  clearCurrentProfileAvatar,
  updateCurrentProfileNickname,
  uploadCurrentProfileAvatar,
} from "@/lib/profile-mutation";
import { invalidateProfileDisplayQueries } from "@/lib/profile-display-cache";
import { readPublicProfileSummaries } from "@/lib/public-profile-read";

interface Profile {
  nickname: string;
  avatar_url?: string | null;
}

const accountDeletionFailureMessages: Record<string, string> = {
  REAUTH_REQUIRED: "현재 비밀번호를 다시 확인해 주세요.",
  REAUTH_PROOF_UNAVAILABLE: "재인증 증명이 만료되었거나 이미 사용되었습니다. 비밀번호를 다시 확인해 주세요.",
  APPLY_NOT_STARTED: "계정 삭제 요청을 시작하지 못했습니다.",
};
const accountDeletionFailureMessage = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "계정 삭제 요청을 시작하지 못했습니다.";
  }

  const reasonCode = (payload as { reasonCode?: unknown }).reasonCode;
  return typeof reasonCode === "string"
    ? accountDeletionFailureMessages[reasonCode] ?? "계정 삭제 요청을 시작하지 못했습니다."
    : "계정 삭제 요청을 시작하지 못했습니다.";
};



const CONSENT_CHANNEL_OPTIONS = [
  { id: "email", label: "이메일" },
  { id: "sms", label: "SMS" },
  { id: "push", label: "푸시" },
] as const;

type ConsentChannel = (typeof CONSENT_CHANNEL_OPTIONS)[number]["id"];
type OrdinaryConsentPurpose = "email_marketing" | "sms_marketing" | "push_marketing";
type ConsentPurpose = OrdinaryConsentPurpose | "night_marketing";
type ConsentDecision = "granted" | "withdrawn";

type ConsentSettings = {
  policy: {
    policyVersionId: string;
    version: string;
    contentSha256: string;
  };
  consents: {
    ordinary: Record<ConsentChannel, boolean>;
    night: Record<ConsentChannel, boolean>;
  };
};

type ConsentAction = {
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  decision: ConsentDecision;
};

type ConsentRequest = ConsentAction & {
  policyVersionId: string;
  noticeSha256: string;
  idempotencyKey: string;
  correlationId: string;
};

const ORDINARY_PURPOSE_BY_CHANNEL: Record<ConsentChannel, OrdinaryConsentPurpose> = {
  email: "email_marketing",
  sms: "sms_marketing",
  push: "push_marketing",
};

function isConsentRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConsentChannel(value: unknown): value is ConsentChannel {
  return typeof value === "string" && CONSENT_CHANNEL_OPTIONS.some((channel) => channel.id === value);
}

function isConsentDecision(value: unknown): value is ConsentDecision {
  return value === "granted" || value === "withdrawn";
}

function isConsentGroup(value: unknown): value is Record<ConsentChannel, boolean> {
  return isConsentRecord(value)
    && CONSENT_CHANNEL_OPTIONS.every((channel) => typeof value[channel.id] === "boolean");
}

function parseConsentSettings(value: unknown): ConsentSettings | null {
  if (!isConsentRecord(value) || !isConsentRecord(value.policy) || !isConsentRecord(value.consents)) {
    return null;
  }

  const { policy, consents } = value;
  if (typeof policy.policyVersionId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(policy.policyVersionId)
    || typeof policy.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(policy.version)
    || typeof policy.contentSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(policy.contentSha256)
    || !isConsentGroup(consents.ordinary)
    || !isConsentGroup(consents.night)) {
    return null;
  }

  return {
    policy: {
      policyVersionId: policy.policyVersionId,
      version: policy.version,
      contentSha256: policy.contentSha256,
    },
    consents: {
      ordinary: consents.ordinary,
      night: consents.night,
    },
  };
}

function hasConsentReadback(value: unknown, action: ConsentAction) {
  if (!isConsentRecord(value) || value.receipt !== "PRIVACY_CONSENT_RECORDED" || !isConsentRecord(value.state)) {
    return false;
  }

  return isConsentChannel(value.state.channel)
    && isConsentDecision(value.state.decision)
    && value.state.purpose === action.purpose
    && value.state.channel === action.channel
    && value.state.decision === action.decision;
}

function createConsentRequestIds() {
  if (typeof window === "undefined" || typeof window.crypto?.randomUUID !== "function") return null;

  const correlationId = window.crypto.randomUUID();
  return {
    correlationId,
    idempotencyKey: `privacy-consent-${window.crypto.randomUUID().replaceAll("-", "")}`,
  };
}
const ACCOUNT_DELETION_POLL_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const ACCOUNT_DELETION_POLL_DEADLINE_MS = 30_000;
type AccountDeletionPollResult =
  | Readonly<{ kind: "applied"; receipt: AccountDeletionReceipt }>
  | Readonly<{ kind: "in_progress" }>
  | Readonly<{ kind: "partial" | "failed"; reasonCode: string }>
  | Readonly<{ kind: "timeout" | "unavailable" | "aborted" }>;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function isAccountDeletionStatusCounts(value: unknown) {
  return isConsentRecord(value)
    && hasExactKeys(value, ["delete", "anonymize", "separate", "retain"])
    && Object.values(value).every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 2_147_483_647,
    );
}

function parseAccountDeletionStatusResponse(
  value: unknown,
  preview: AccountDeletionPreview,
): AccountDeletionPollResult | null {
  if (
    !isConsentRecord(value)
    || typeof value.status !== "string"
    || typeof value.reasonCode !== "string"
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)
    || !isAccountDeletionStatusCounts(value.counts)
  ) {
    return null;
  }

  if (value.status === "applied") {
    if (!hasExactKeys(value, ["status", "reasonCode", "counts", "receipt"])) return null;
    const receipt = parseAccountDeletionReceipt(value.receipt);
    return receipt
      && value.reasonCode === "APPLIED"
      && receipt.requestId === preview.requestId
      && receipt.sourceManifestHash === preview.sourceManifestHash
      ? { kind: "applied", receipt }
      : null;
  }

  if (
    !hasExactKeys(value, ["status", "reasonCode", "counts"])
    || (value.status !== "in_progress" && value.status !== "partial" && value.status !== "failed")
  ) {
    return null;
  }

  if (value.status === "in_progress") return { kind: "in_progress" };
  if (value.status === "partial" || value.status === "failed") {
    return { kind: value.status, reasonCode: value.reasonCode };
  }

  return null;
}

async function readAccountDeletionStatus(
  preview: AccountDeletionPreview,
  signal: AbortSignal,
): Promise<AccountDeletionPollResult> {
  const query = new URLSearchParams({
    requestId: preview.requestId,
    previewHash: preview.previewHash,
    sourceManifestHash: preview.sourceManifestHash,
  });
  const response = await fetch(`/api/account/delete?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const payload = await response.json().catch(() => null);
  const result = parseAccountDeletionStatusResponse(payload, preview);
  if (!result) return { kind: "unavailable" };

  if (
    (result.kind === "applied" && response.status === 200)
    || (result.kind === "in_progress" && response.status === 202)
    || ((result.kind === "partial" || result.kind === "failed") && response.status === 409)
  ) {
    return result;
  }

  return { kind: "unavailable" };
}

function waitForAccountDeletionPoll(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(false);
    };
    timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollAccountDeletionReadback(
  preview: AccountDeletionPreview,
  signal: AbortSignal,
): Promise<AccountDeletionPollResult> {
  if (signal.aborted) return { kind: "aborted" };

  const pollController = new AbortController();
  let deadlineReached = false;
  const abortPoll = () => pollController.abort();
  signal.addEventListener("abort", abortPoll, { once: true });
  const deadlineTimer = window.setTimeout(() => {
    deadlineReached = true;
    pollController.abort();
  }, ACCOUNT_DELETION_POLL_DEADLINE_MS);
  const deadline = Date.now() + ACCOUNT_DELETION_POLL_DEADLINE_MS;

  try {
    for (let attempt = 0; Date.now() < deadline; attempt += 1) {
      const remaining = deadline - Date.now();
      const delay = Math.min(
        ACCOUNT_DELETION_POLL_BACKOFF_MS[
          Math.min(attempt, ACCOUNT_DELETION_POLL_BACKOFF_MS.length - 1)
        ],
        remaining,
      );
      if (!await waitForAccountDeletionPoll(delay, pollController.signal)) {
        return deadlineReached ? { kind: "timeout" } : { kind: "aborted" };
      }

      const result = await readAccountDeletionStatus(preview, pollController.signal);
      if (result.kind !== "in_progress") return result;
    }
  } catch {
    return deadlineReached
      ? { kind: "timeout" }
      : signal.aborted
        ? { kind: "aborted" }
        : { kind: "unavailable" };
  } finally {
    window.clearTimeout(deadlineTimer);
    signal.removeEventListener("abort", abortPoll);
  }

  return { kind: "timeout" };
}

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


  // 계정 완전 삭제
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deletionSession, setDeletionSession] = useState<Readonly<{
    preview: AccountDeletionPreview;
    proofId: string;
    expiresAt: string;
    bearerToken: string;
  }> | null>(null);
  const [deletionProgressMessage, setDeletionProgressMessage] = useState<string | null>(null);
  const accountDeletionPollController = useRef<AbortController | null>(null);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [showDeletionPassword, setShowDeletionPassword] = useState(false);

  const [consentSettings, setConsentSettings] = useState<ConsentSettings | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentSaving, setConsentSaving] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [failedConsentAction, setFailedConsentAction] = useState<ConsentAction | null>(null);
  const [failedConsentRequest, setFailedConsentRequest] = useState<ConsentRequest | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user) return;

    try {
      const data = await readPublicProfileSummaries(supabase, [user.id]);

      if (data && data.length > 0) {
        setProfile(data[0]);
      } else {
        setProfile(null);
      }
    } catch {
      toast.error("프로필 정보를 불러오는데 실패했습니다");
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user, loadProfile]);

  const loadConsentSettings = useCallback(async () => {
    if (!user) {
      setConsentSettings(null);
      return;
    }

    setConsentLoading(true);
    try {
      const response = await fetch("/api/privacy/consents", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = parseConsentSettings(payload);
      if (!response.ok || !parsed) throw new Error("consent_settings_unavailable");

      setConsentSettings(parsed);
      setConsentError(null);
      setFailedConsentAction(null);
      setFailedConsentRequest(null);
    } catch {
      setConsentSettings(null);
      setConsentError("수신 동의 설정을 불러오지 못했습니다.");
    } finally {
      setConsentLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void loadConsentSettings();
  }, [user, loadConsentSettings]);

  const displayName =
    profile?.nickname || userProfile?.nickname || profileNickname || "사용자";
  const currentAvatarReference = profile !== null
    ? profile.avatar_url ?? null
    : userProfile?.avatarUrl ?? null;

  useEffect(() => {
    if (!isMobileNicknameEditing) {
      setMobileNicknameInput(displayName);
    }
  }, [displayName, isMobileNicknameEditing]);
  useEffect(() => () => {
    accountDeletionPollController.current?.abort();
    setDeletionSession(null);
  }, []);

  const refreshProfileAvatarQueries = async () => {
    if (!user) return;
    await invalidateProfileDisplayQueries(queryClient, user.id);
  };

  const refreshLocalProfileState = async () => {
    if (!user) return;
    const [latestProfile] = await readPublicProfileSummaries(supabase, [user.id]);
    setProfile(latestProfile ?? null);
  };

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
      const receipt = await updateCurrentProfileNickname(
        supabase,
        user.id,
        nextNickname,
      );

      setProfile({
        nickname: receipt.profile.nickname,
        avatar_url: receipt.profile.avatarReference,
      });
      await refreshProfileAvatarQueries();
      setIsMobileNicknameEditing(false);
      router.refresh();
      toast.success("닉네임이 변경되었습니다");
    } catch {
      toast.error("닉네임 변경에 실패했습니다");
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
      const result = await uploadCurrentProfileAvatar(
        supabase,
        user.id,
        currentAvatarReference,
        compressedBlob,
      );

      setProfile((prev) => ({
        nickname: prev?.nickname || displayName,
        avatar_url: result.receipt.profile.avatarReference,
      }));
      await refreshProfileAvatarQueries();
      router.refresh();
      if (result.cleanup.status === "pending") {
        toast.warning("프로필 사진은 변경되었지만 이전 사진 정리가 지연되고 있습니다");
      } else {
        toast.success("프로필 사진이 변경되었습니다");
      }
    } catch {
      try {
        await Promise.all([
          refreshLocalProfileState(),
          refreshProfileAvatarQueries(),
        ]);
      } catch {
        // The fixed failure remains fail closed when authoritative refresh is unavailable.
      }
      toast.error("프로필 사진 업로드에 실패했습니다");
    } finally {
      setMobileAvatarUploading(false);
      event.target.value = "";
    }
  };

  const handleMobileAvatarDelete = async () => {
    if (!user || currentAvatarReference === null) return;
    if (!confirm("프로필 사진을 삭제하시겠습니까?")) return;

    setMobileAvatarUploading(true);
    try {
      const result = await clearCurrentProfileAvatar(
        supabase,
        user.id,
        currentAvatarReference,
      );

      setProfile((prev) => ({
        nickname: prev?.nickname || displayName,
        avatar_url: null,
      }));
      await refreshProfileAvatarQueries();
      router.refresh();
      if (result.cleanup.status === "pending") {
        toast.warning("프로필 사진은 삭제되었지만 이전 사진 정리가 지연되고 있습니다");
      } else {
        toast.success("프로필 사진이 삭제되었습니다");
      }
    } catch {
      try {
        await Promise.all([
          refreshLocalProfileState(),
          refreshProfileAvatarQueries(),
        ]);
      } catch {
        // The fixed failure remains fail closed when authoritative refresh is unavailable.
      }
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
    } catch {
      toast.error("비밀번호 변경에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };


  // A fresh password session owns preview, proof, and apply; it never reaches storage.
  const handleAccountPermanentDelete = async () => {
    if (!user?.email) return;

    if (deleteConfirmationText !== ACCOUNT_DELETION_CONFIRMATION_TEXT) {
      toast.error(`확인 문구 ${ACCOUNT_DELETION_CONFIRMATION_TEXT}를 정확히 입력해 주세요.`);
      return;
    }
    if (!deletionSession && !deletionPassword) {
      toast.error("계정 삭제를 위해 비밀번호를 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      if (!deletionSession) {
        const freshSession = await createAccountDeletionReauthenticationSession({
          userId: user.id,
          email: user.email,
          password: deletionPassword,
        });
        if (!freshSession) throw new Error("reauthentication_failed");

        const previewResponse = await fetch("/api/account/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshSession.bearerToken}`,
          },
          body: JSON.stringify({ targetUserId: user.id }),
        });
        const previewPayload = await previewResponse.json().catch(() => null);
        const preview = parseAccountDeletionPreview(
          previewPayload && typeof previewPayload === "object" && "preview" in previewPayload
            ? previewPayload.preview
            : null,
        );
        if (!previewResponse.ok || !preview) throw new Error("preview_unavailable");

        const proof = await issueAccountDeletionReauthenticationProof(user.id);
        if (!proof) throw new Error("proof_unavailable");
        setDeletionSession({
          preview,
          proofId: proof.proofId,
          expiresAt: proof.expiresAt,
          bearerToken: freshSession.bearerToken,
        });
        setDeletionPassword("");
        setShowDeletionPassword(false);
        toast.success("삭제 범위를 확인했습니다. 같은 확인 문구로 한 번 더 적용해 주세요.");
        return;
      }

      if (Date.parse(deletionSession.expiresAt) <= Date.now()) {
        setDeletionSession(null);
        throw new Error("proof_expired");
      }

      const idempotencyKey = createAccountDeletionIdempotencyKey();
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deletionSession.bearerToken}`,
        },
        body: JSON.stringify({
          userId: user.id,
          proofId: deletionSession.proofId,
          requestId: deletionSession.preview.requestId,
          previewHash: deletionSession.preview.previewHash,
          confirmationText: deleteConfirmationText,
          idempotencyKey,
          sourceManifestHash: deletionSession.preview.sourceManifestHash,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (
        response.status !== 202
        || !isConsentRecord(payload)
        || !hasExactKeys(payload, ["status", "begin"])
        || payload.status !== "accepted"
      ) {
        throw new Error(accountDeletionFailureMessage(payload));
      }

      accountDeletionPollController.current?.abort();
      const pollController = new AbortController();
      accountDeletionPollController.current = pollController;
      setDeletionProgressMessage("계정 삭제 완료 확인 중입니다. 이 창을 닫지 마세요.");
      const readback = await pollAccountDeletionReadback(deletionSession.preview, pollController.signal);
      accountDeletionPollController.current = null;
      if (readback.kind !== "applied") {
        setDeletionProgressMessage("계정 삭제 완료를 확인하지 못했습니다. 브라우저 데이터는 유지됩니다.");
        throw new Error(`account_deletion_${readback.kind}`);
      }

      const receipt = readback.receipt;
      setDeletionSession(null);
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      const browserCleanup = await clearAccountDeletionBrowserStores(user.id, receipt);
      if (signOutError || browserCleanup.status !== "complete") {
        window.location.replace("/data-deletion?browserCleanup=required");
        return;
      }
      window.location.replace("/");
    } catch {
      setDeletionSession(null);
      toast.error("계정 삭제를 완료하지 못했습니다. 최근 로그인 상태와 삭제 미리보기를 다시 확인해 주세요.");
    } finally {
      setDeletionPassword("");
      setShowDeletionPassword(false);
      setLoading(false);
    }
  };

  const handleConsentChange = async (
    action: ConsentAction,
    retryRequest: ConsentRequest | null = null,
  ) => {
    if (!consentSettings || consentSaving) return;

    const replayRequest = retryRequest !== null
      && retryRequest.purpose === action.purpose
      && retryRequest.channel === action.channel
      && retryRequest.decision === action.decision
      && retryRequest.policyVersionId === consentSettings.policy.policyVersionId
      && retryRequest.noticeSha256 === consentSettings.policy.contentSha256
      ? retryRequest
      : null;
    const requestIds = replayRequest ?? createConsentRequestIds();
    if (!requestIds) {
      setFailedConsentAction(action);
      setFailedConsentRequest(null);
      setConsentError("수신 동의 변경을 시작하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    const request: ConsentRequest = replayRequest
      ? replayRequest
      : {
        ...action,
        policyVersionId: consentSettings.policy.policyVersionId,
        noticeSha256: consentSettings.policy.contentSha256,
        idempotencyKey: requestIds.idempotencyKey,
        correlationId: requestIds.correlationId,
      };
    const savingKey = `${request.purpose}:${request.channel}`;
    setConsentSaving(savingKey);
    setConsentError(null);
    setFailedConsentAction(null);
    setFailedConsentRequest(null);
    try {
      const response = await fetch("/api/privacy/consents", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          purpose: request.purpose,
          channel: request.channel,
          decision: request.decision,
          policyVersionId: request.policyVersionId,
          noticeSha256: request.noticeSha256,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !hasConsentReadback(payload, action)) {
        if (isConsentRecord(payload) && payload.code === "PRIVACY_POLICY_STALE") {
          await loadConsentSettings();
        }
        throw new Error("consent_update_unavailable");
      }

      setConsentSettings((current) => {
        if (!current) return current;
        const granted = action.decision === "granted";
        if (action.purpose === "night_marketing") {
          return {
            ...current,
            consents: {
              ...current.consents,
              night: { ...current.consents.night, [action.channel]: granted },
            },
          };
        }
        return {
          ...current,
          consents: {
            ...current.consents,
            ordinary: { ...current.consents.ordinary, [action.channel]: granted },
          },
        };
      });
      toast.success(action.decision === "granted" ? "수신 동의를 확인했습니다." : "수신 동의 철회를 확인했습니다.");
    } catch {
      setFailedConsentAction(action);
      setFailedConsentRequest(request);
      setConsentError("수신 동의 변경을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setConsentSaving(null);
    }
  };

  if (!user) return null;

  // Render only a canonical avatar URL bound to the signed-in user.
  const avatarUrl =
    resolveProfileAvatarUrl(currentAvatarReference, user.id);
  const hasAvatarReference = currentAvatarReference !== null;
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
      icon: YouTubeIcon,
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
      className="grid min-w-0 gap-3 sm:gap-5 md:h-full md:min-h-0 md:grid-cols-2 md:grid-rows-2 md:auto-rows-auto md:content-stretch md:items-stretch lg:gap-3"
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
              {hasAvatarReference && (
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
          className="min-w-0 border-border/70 md:order-5 md:col-span-2 md:row-start-3 md:rounded-3xl md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"
          data-privacy-consent-settings="true"
        >
          <CardHeader className="pb-3 lg:p-4 lg:pb-2">
            <CardTitle className="text-base">선택 마케팅 수신 설정</CardTitle>
            <CardDescription>
              일반 수신과 야간 수신은 채널별 선택 항목입니다. 연락처는 이 화면에서 입력하거나 변경하지 않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 lg:p-4 lg:pt-1">
            {consentLoading && !consentSettings && (
              <p className="text-sm text-muted-foreground" role="status">
                수신 동의 설정을 확인하는 중입니다.
              </p>
            )}
            {consentError && (
              <div
                className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
                data-privacy-consent-retry="true"
              >
                <span>{consentError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (failedConsentAction && consentSettings) {
                      void handleConsentChange(failedConsentAction, failedConsentRequest);
                    } else {
                      void loadConsentSettings();
                    }
                  }}
                  disabled={consentSaving !== null || consentLoading}
                >
                  다시 시도
                </Button>
              </div>
            )}

            <section
              className="rounded-2xl border border-border/70 bg-muted/20 p-3"
              aria-labelledby="ordinary-marketing-consent-title"
              data-privacy-consent-group="ordinary"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h2 id="ordinary-marketing-consent-title" className="text-sm font-semibold">
                    일반 마케팅 수신
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    새 소식과 혜택 안내를 받을 채널을 선택합니다.
                  </p>
                </div>
                <Badge variant="secondary">선택</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {CONSENT_CHANNEL_OPTIONS.map((channel) => {
                  const enabled = consentSettings?.consents.ordinary[channel.id] === true;
                  const action: ConsentAction = {
                    purpose: ORDINARY_PURPOSE_BY_CHANNEL[channel.id],
                    channel: channel.id,
                    decision: enabled ? "withdrawn" : "granted",
                  };
                  const actionKey = `${action.purpose}:${action.channel}`;
                  const unknown = !consentSettings;
                  return (
                    <div
                      key={channel.id}
                      className="flex min-h-24 flex-col justify-between rounded-xl border border-border/70 bg-background p-3"
                      data-privacy-consent-row={`ordinary-${channel.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{channel.label}</span>
                        <Badge variant={enabled ? "default" : "secondary"}>
                          {unknown ? "확인 전" : enabled ? "동의함" : "동의 안 함"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant={enabled ? "outline" : "default"}
                        size="sm"
                        className="mt-3 w-full"
                        aria-pressed={enabled}
                        onClick={() => void handleConsentChange(action)}
                        disabled={unknown || consentLoading || consentSaving !== null}
                      >
                        {consentSaving === actionKey
                          ? "저장 중…"
                          : enabled
                            ? "수신 철회"
                            : "수신 동의"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              className="rounded-2xl border border-amber-500/60 bg-amber-50/60 p-3 dark:bg-amber-950/20"
              aria-labelledby="night-marketing-consent-title"
              data-privacy-consent-group="night"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h2 id="night-marketing-consent-title" className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                    야간 마케팅 수신
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">
                    일반 수신과 별도로, 야간 안내를 받을 채널을 직접 선택합니다.
                  </p>
                </div>
                <Badge className="bg-amber-600 text-white hover:bg-amber-600">별도 선택</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {CONSENT_CHANNEL_OPTIONS.map((channel) => {
                  const enabled = consentSettings?.consents.night[channel.id] === true;
                  const action: ConsentAction = {
                    purpose: "night_marketing",
                    channel: channel.id,
                    decision: enabled ? "withdrawn" : "granted",
                  };
                  const actionKey = `${action.purpose}:${action.channel}`;
                  const unknown = !consentSettings;
                  return (
                    <div
                      key={channel.id}
                      className="flex min-h-24 flex-col justify-between rounded-xl border border-amber-500/40 bg-background/90 p-3"
                      data-privacy-consent-row={`night-${channel.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{channel.label}</span>
                        <Badge variant={enabled ? "default" : "secondary"}>
                          {unknown ? "확인 전" : enabled ? "동의함" : "동의 안 함"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant={enabled ? "outline" : "default"}
                        size="sm"
                        className="mt-3 w-full"
                        aria-pressed={enabled}
                        onClick={() => void handleConsentChange(action)}
                        disabled={unknown || consentLoading || consentSaving !== null}
                      >
                        {consentSaving === actionKey
                          ? "저장 중…"
                          : enabled
                            ? "수신 철회"
                            : "수신 동의"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          </CardContent>
        </Card>

        <Card
          id="account-deletion"
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
                <span>계정 삭제 옵션 보기</span>
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
                  완전 삭제는 복구할 수 없으며, 서버 미리보기와 읽기검증을 거칩니다.
                </p>
                {deletionProgressMessage && (
                  <p
                    className="rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
                    data-account-deletion-status="recoverable"
                    role="status"
                  >
                    {deletionProgressMessage}
                  </p>
                )}

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
                        삭제 범위를 먼저 확인한 뒤 적용합니다. 모든 시스템의 삭제를 보장하지 않으며,
                        보존 또는 분리 대상은 현재 승인된 처리 기준에 따라 별도로 처리됩니다.
                        최근 로그인 후 확인 문구를 정확히 입력해 주세요.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-3 py-4">
                      {deletionSession && (
                        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                          삭제 미리보기: 삭제 {deletionSession.preview.counts.delete}건, 익명화{" "}
                          {deletionSession.preview.counts.anonymize}건, 분리{" "}
                          {deletionSession.preview.counts.separate}건, 유지{" "}
                          {deletionSession.preview.counts.retain}건
                        </p>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="account-deletion-password">현재 비밀번호</Label>
                        <div className="relative">
                          <Input
                            id="account-deletion-password"
                            type={showDeletionPassword ? "text" : "password"}
                            value={deletionPassword}
                            onChange={(e) => setDeletionPassword(e.target.value)}
                            autoComplete="current-password"
                            aria-label="계정 삭제 재인증 비밀번호"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full"
                            onClick={() => setShowDeletionPassword((visible) => !visible)}
                            aria-label={showDeletionPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                          >
                            {showDeletionPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          비밀번호 로그인 계정만 재인증할 수 있습니다. OAuth 계정은 고객 지원으로 문의해 주세요.
                        </p>
                      </div>
                      <Input
                        value={deleteConfirmationText}
                        onChange={(e) => setDeleteConfirmationText(e.target.value)}
                        placeholder={ACCOUNT_DELETION_CONFIRMATION_TEXT}
                        className="text-center"
                        aria-label="계정 삭제 확인 문구"
                        name="delete-confirmation-text"
                        autoComplete="off"
                      />
                      {deleteConfirmationText
                        && deleteConfirmationText !== ACCOUNT_DELETION_CONFIRMATION_TEXT && (
                          <p className="text-sm text-destructive text-center">
                            {ACCOUNT_DELETION_CONFIRMATION_TEXT}를 정확히 입력해 주세요
                          </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        onClick={() => {
                          accountDeletionPollController.current?.abort();
                          setDeleteConfirmationText("");
                          setDeletionPassword("");
                          setShowDeletionPassword(false);
                          setDeletionSession(null);
                        }}
                      >
                        취소
                      </AlertDialogCancel>
                      <Button
                        type="button"
                        onClick={handleAccountPermanentDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={
                          loading
                          || deleteConfirmationText !== ACCOUNT_DELETION_CONFIRMATION_TEXT
                          || (!deletionSession && !deletionPassword)
                        }
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            처리 중…
                          </>
                        ) : deletionSession ? (
                          "계정 삭제 적용"
                        ) : (
                          "삭제 범위 확인"
                        )}
                      </Button>
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
