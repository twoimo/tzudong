import { useState, useEffect, useCallback, memo, type CSSProperties } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/no-toast";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, X } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MOBILE_FULL_FORM_SHEET, MobileSheetHeader, mobileSheetStyles } from "@/components/ui/mobile-sheet-frame";
import { useImmediateMobileOrTablet } from "@/hooks/useDeviceType";
import { dispatchHomeAuthSessionUpdated } from "@/lib/home-auth-events";
import {
  AUTH_PRIVACY_ONBOARDING_REASON,
  getSafeAuthNextPath,
  isAdminAuthRedirect,
} from "@/lib/auth/auth-redirect";
import {
  beginExistingAccountPrivacyRecovery,
  endExistingAccountPrivacyRecovery,
} from "@/lib/auth/existing-account-recovery";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";
import {
  getCurrentPrivacyEligibility,
  hasLivePrivacyEligibilityReceipt,
  privacyEligibilityGuidance,
  signOutRejectedPrivacySession,
} from "@/lib/privacy/eligibility";

// 쯔양 테마 랜덤 닉네임 생성
const generateRandomNickname = (): string => {
  const prefixes = [
    '위장이2개', '블랙홀위장', '쯔동민턴', '냉면빨대', '짜장면통째로',
    '라면8봉', '삼겹살산맥', '치킨흡입기', '쩝쩝박사', '대왕카스테라',
    '국밥말아먹어', '쯔양제자', '먹방견습생', '위장무한대', '풀코스다먹어',
    '5인분혼밥러', '배터지기직전', '밥도둑잡아라', '냠냠폭격기', '칼로리는숫자',
    '야식은기본', '다이어트내일부터'
  ];
  const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const randomSuffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${randomPrefix}_${randomSuffix}`;
};

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
  redirectTo?: string | null;
  reason?: string | null;
  initialAuthTab?: "login" | "signup";
}

const AUTH_MODAL_DESKTOP_CONTENT_CLASS_NAME = "max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]";
const AUTH_MODAL_DESKTOP_CONTENT_STYLE: CSSProperties = {
  width: "min(calc(100vw - 2rem), 28rem)",
  maxWidth: "calc(100vw - 2rem)",
};

// Google 아이콘을 별도 컴포넌트로 분리하여 재사용
const GoogleIcon = memo(() => (
  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
));
GoogleIcon.displayName = "GoogleIcon";
type AgeBand = "" | "age_14_plus" | "under_14";
type MarketingConsent = {
  email: boolean;
  sms: boolean;
  push: boolean;
  night_email: boolean;
  night_sms: boolean;
  night_push: boolean;
};

const EMPTY_MARKETING_CONSENT: MarketingConsent = {
  email: false,
  sms: false,
  push: false,
  night_email: false,
  night_sms: false,
  night_push: false,
};
const UNDER_14_SIGNUP_UNAVAILABLE_CODE = "UNDER_14_SIGNUP_UNAVAILABLE";
const UNDER_14_SIGNUP_UNAVAILABLE_MESSAGE = "만 14세 미만 이용자의 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.";
const POLICY_VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_CONTENT_SHA256_PATTERN = /^[a-f0-9]{64}$/;

function OnboardingConsentFields({
  ageBand,
  onAgeBandChange,
  privacyAgreed,
  onPrivacyAgreedChange,
  onPrivacyPolicyOpen,
  marketingConsent,
  onMarketingConsentChange,
  policyVersionReady,
}: {
  ageBand: AgeBand;
  onAgeBandChange: (value: AgeBand) => void;
  privacyAgreed: boolean;
  onPrivacyAgreedChange: (value: boolean) => void;
  onPrivacyPolicyOpen: () => void;
  marketingConsent: MarketingConsent;
  onMarketingConsentChange: (key: keyof MarketingConsent, value: boolean) => void;
  policyVersionReady: boolean;
}) {
  const marketingControls: Array<{ key: keyof MarketingConsent; label: string }> = [
    { key: "email", label: "이메일 마케팅 수신" },
    { key: "sms", label: "문자 마케팅 수신" },
    { key: "push", label: "푸시 마케팅 수신" },
    { key: "night_email", label: "야간 이메일 마케팅 수신" },
    { key: "night_sms", label: "야간 문자 마케팅 수신" },
    { key: "night_push", label: "야간 푸시 마케팅 수신" },
  ];

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">연령대 확인 (필수)</legend>
        <p className="text-xs text-muted-foreground">
          생년월일이나 주민등록번호를 받지 않습니다. 만 14세 미만 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="signup-age-band"
            value="age_14_plus"
            checked={ageBand === "age_14_plus"}
            onChange={() => onAgeBandChange("age_14_plus")}
          />
          만 14세 이상입니다
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="signup-age-band"
            value="under_14"
            checked={ageBand === "under_14"}
            onChange={() => onAgeBandChange("under_14")}
          />
          만 14세 미만입니다
        </label>
      </fieldset>

      <div className="flex items-start space-x-2">
        <Checkbox
          id="privacy-agree"
          checked={privacyAgreed}
          onCheckedChange={(checked) => onPrivacyAgreedChange(checked === true)}
        />
        <div className="grid gap-1.5 leading-none">
          <label
            htmlFor="privacy-agree"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            <button
              type="button"
              className="inline-flex min-h-6 items-center text-primary underline hover:text-primary/80"
              onClick={onPrivacyPolicyOpen}
            >
              개인정보 처리방침
            </button>
            에 동의합니다 (필수)
          </label>
          {!policyVersionReady && (
            <p className="text-xs text-muted-foreground" role="status">
              최신 개인정보 처리방침을 확인하는 중입니다.
            </p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">마케팅 수신 동의 (선택)</legend>
        <p className="text-xs text-muted-foreground">
          일반 수신과 야간 수신은 각각 선택할 수 있으며, 선택하지 않아도 가입할 수 있습니다.
        </p>
        {marketingControls.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`marketing-${key}`}
              checked={marketingConsent[key]}
              disabled={key.startsWith("night_") && !marketingConsent[key.slice(6) as keyof MarketingConsent]}
              onCheckedChange={(checked) => onMarketingConsentChange(key, checked === true)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

const AuthModal = memo(({ isOpen, onClose, onAuthSuccess, redirectTo, reason, initialAuthTab = "login" }: AuthModalProps) => {
  const isMobileOrTablet = useImmediateMobileOrTablet();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [ageBand, setAgeBand] = useState<AgeBand>("");
  const [marketingConsent, setMarketingConsent] = useState<MarketingConsent>(EMPTY_MARKETING_CONSENT);
  const [policyVersion, setPolicyVersion] = useState<string | null>(null);
  const [policyContentSha256, setPolicyContentSha256] = useState<string | null>(null);
  const [authTab, setAuthTab] = useState<"login" | "signup">(initialAuthTab);
  const [isExistingAccountRecovery, setIsExistingAccountRecovery] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const safeRedirectTo = getSafeAuthNextPath(redirectTo);
  const isAdminRedirect = isAdminAuthRedirect(reason, safeRedirectTo);

  useEffect(() => {
    if (!isOpen) return;
    setAuthTab(initialAuthTab);

    setUsername((currentUsername) => currentUsername || generateRandomNickname());

    let cancelled = false;
    void fetch("/api/privacy/onboarding", { cache: "no-store" })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

        const policy = payload as { id?: unknown; contentSha256?: unknown };
        if (
          typeof policy.id !== "string"
          || !POLICY_VERSION_ID_PATTERN.test(policy.id)
          || typeof policy.contentSha256 !== "string"
          || !POLICY_CONTENT_SHA256_PATTERN.test(policy.contentSha256)
        ) {
          return null;
        }

        return { id: policy.id, contentSha256: policy.contentSha256 };
      })
      .then((currentPolicy) => {
        if (!cancelled) {
          setPolicyVersion(currentPolicy?.id ?? null);
          setPolicyContentSha256(currentPolicy?.contentSha256 ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPolicyVersion(null);
          setPolicyContentSha256(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialAuthTab, isOpen]);

  const resetForm = useCallback(() => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setUsername(generateRandomNickname());
    setPrivacyAgreed(false);
    setAgeBand("");
    setMarketingConsent(EMPTY_MARKETING_CONSENT);
    setAuthTab("login");
    setIsExistingAccountRecovery(false);
  }, []);

  const refreshNickname = useCallback(() => {
    setUsername(generateRandomNickname());
  }, []);

  const startOnboardingChallenge = useCallback(async (intent: "password" | "oauth") => {
    if (!privacyAgreed || !ageBand || !policyVersion || !policyContentSha256) {
      toast.error("연령대와 최신 개인정보 처리방침 동의를 확인해주세요");
      return null;
    }

    try {
      const response = await fetch("/api/privacy/onboarding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyVersion,
          ageBand,
          intent,
          policyAcknowledged: true,
          marketing: {
            email: marketingConsent.email,
            sms: marketingConsent.sms,
            push: marketingConsent.push,
            nightByChannel: {
              email: marketingConsent.night_email,
              sms: marketingConsent.night_sms,
              push: marketingConsent.night_push,
            },
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        toast.error("가입 정보를 확인할 수 없습니다. 다시 시도해주세요.");
        return null;
      }

      const result = payload as { code?: unknown; oauthNonce?: unknown };
      if (result.code === UNDER_14_SIGNUP_UNAVAILABLE_CODE) {
        toast.error(UNDER_14_SIGNUP_UNAVAILABLE_MESSAGE);
        return null;
      }
      if (!response.ok) {
        toast.error("가입 정보를 확인할 수 없습니다. 다시 시도해주세요.");
        return null;
      }
      if (intent === "oauth" && (typeof result.oauthNonce !== "string" || !/^[0-9a-f]{64}$/i.test(result.oauthNonce))) {
        toast.error("가입 정보를 확인할 수 없습니다. 다시 시도해주세요.");
        return null;
      }
      return {
        oauthNonce: typeof result.oauthNonce === "string" ? result.oauthNonce : null,
        policyVersionId: policyVersion,
        contentSha256: policyContentSha256,
      };
    } catch {
      toast.error("가입 정보를 확인할 수 없습니다. 다시 시도해주세요.");
      return null;
    }
  }, [ageBand, marketingConsent, policyContentSha256, policyVersion, privacyAgreed]);

  const handleGoogleLogin = useCallback(async () => {
    setIsGoogleLoading(true);
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (isAdminRedirect) {
        callbackUrl.searchParams.set("next", safeRedirectTo);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      if (error) throw new Error("oauth_start_failed");
    } catch {
      toast.error("Google 로그인에 실패했습니다");
      setIsGoogleLoading(false);
    }
  }, [isAdminRedirect, safeRedirectTo]);

  const handleGoogleSignup = useCallback(async () => {
    setIsGoogleLoading(true);
    const challenge = await startOnboardingChallenge("oauth");
    if (!challenge?.oauthNonce) {
      setIsGoogleLoading(false);
      return;
    }

    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (isAdminRedirect) {
        callbackUrl.searchParams.set("next", safeRedirectTo);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      if (error) throw new Error("oauth_start_failed");
    } catch {
      toast.error("Google 가입을 시작할 수 없습니다");
      setIsGoogleLoading(false);
    }
  }, [isAdminRedirect, safeRedirectTo, startOnboardingChallenge]);

  const redirectAfterAdminLogin = useCallback(() => {
    if (!isAdminRedirect) return false;
    window.location.assign(safeRedirectTo);
    return true;
  }, [isAdminRedirect, safeRedirectTo]);
  const closeAfterAuthSuccess = useCallback(() => {
    if (onAuthSuccess) {
      onAuthSuccess();
      return;
    }
    onClose();
  }, [onAuthSuccess, onClose]);
  const rejectPrivacyIneligibleSession = useCallback(async (userId: string) => {
    await signOutRejectedPrivacySession(supabase);
    try {
      const { clearBrowserDraftsForUser } = await import("@/lib/privacy/browser-draft-cleanup");
      await clearBrowserDraftsForUser(userId);
    } catch {
      // Rejecting an ineligible session must not retain published auth state.
    }
  }, []);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("이메일과 비밀번호를 입력해주세요");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const signedInUserId = data.session?.user?.id;
      if (error || !signedInUserId) {
        if (signedInUserId) await rejectPrivacyIneligibleSession(signedInUserId);
        throw new Error("password_login_failed");
      }

      const eligibility = await getCurrentPrivacyEligibility(supabase);
      if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
        setAuthTab("signup");
        setIsExistingAccountRecovery(true);
        toast.error("현재 개인정보 처리방침과 연령 확인을 완료해주세요.");
        return;
      }

      toast.success("로그인 성공!");
      dispatchHomeAuthSessionUpdated({
        hasSession: true,
        source: 'auth-modal-password-login',
      });
      resetForm();
      if (redirectAfterAdminLogin()) {
        return;
      }
      closeAfterAuthSuccess();
    } catch {
      toast.error("로그인에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, redirectAfterAdminLogin, resetForm, closeAfterAuthSuccess, rejectPrivacyIneligibleSession]);

  const handleSignup = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (!isExistingAccountRecovery && !username)) {
      toast.error("모든 필드를 입력해주세요");
      return;
    }
    if (!privacyAgreed || !ageBand || !policyVersion || !policyContentSha256) {
      toast.error("연령대와 최신 개인정보 처리방침 동의를 확인해주세요");
      return;
    }
    if (!isExistingAccountRecovery && (username.length < 2 || username.length > 20)) {
      toast.error("닉네임은 2-20자 사이여야 합니다");
      return;
    }
    if (password.length < 8 || password.length > 12) {
      toast.error("비밀번호는 8자 이상 12자 이하여야 합니다");
      return;
    }
    if (!isExistingAccountRecovery && password !== confirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다");
      return;
    }

    setIsLoading(true);
    let recoveryToken: number | null = null;
    try {
      const challenge = await startOnboardingChallenge("password");
      if (!challenge) return;

      if (isExistingAccountRecovery) recoveryToken = beginExistingAccountPrivacyRecovery(email);
      const { data: existingSession, error: existingSessionError } = await supabase.auth.signInWithPassword({ email, password });
      const existingUserId = existingSession.session?.user?.id;
      if (isExistingAccountRecovery && (existingSessionError || !existingUserId)) {
        if (existingUserId) await rejectPrivacyIneligibleSession(existingUserId);
        toast.error("기존 계정 확인에 실패했습니다. 이메일과 비밀번호를 다시 확인해주세요.");
        return;
      }
      if (!existingSessionError && existingUserId) {
        const response = await fetch("/api/privacy/onboarding", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "existing_account" }),
        });
        const eligibility = response.ok ? await getCurrentPrivacyEligibility(supabase) : null;
        if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
          await rejectPrivacyIneligibleSession(existingUserId);
          toast.error("개인정보 처리 확인을 완료할 수 없습니다. 다시 시도해주세요.");
          return;
        }

        const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || refreshedSession.session?.user?.id !== existingUserId) {
          await rejectPrivacyIneligibleSession(existingUserId);
          toast.error("개인정보 처리 확인을 완료하지 못했습니다. 다시 시도해주세요.");
          return;
        }
        toast.success("개인정보 처리 확인이 완료되었습니다.");
        dispatchHomeAuthSessionUpdated({
          hasSession: true,
          source: 'auth-modal-existing-account-onboarding',
        });
        resetForm();
        if (redirectAfterAdminLogin()) return;
        closeAfterAuthSuccess();
        return;
      }

      const response = await fetch("/api/privacy/onboarding", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password_signup",
          email,
          password,
          nickname: username.trim(),
        }),
      });
      if (!response.ok) {
        toast.error("회원가입을 완료할 수 없습니다. 다시 시도해주세요.");
        return;
      }
      const onboardingResult = await response.json().catch(() => null) as {
        emailConfirmationRequired?: unknown;
      } | null;
      if (onboardingResult?.emailConfirmationRequired === true) {
        toast.success("회원가입이 완료되었습니다. 이메일의 확인 링크를 열어주세요.");
        resetForm();
        closeAfterAuthSuccess();
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const signedInUserId = data.session?.user?.id;
      if (error || !signedInUserId) {
        if (signedInUserId) await rejectPrivacyIneligibleSession(signedInUserId);
        toast.error("가입은 완료되었지만 로그인에 실패했습니다. 로그인 탭에서 다시 시도해주세요.");
        return;
      }

      const eligibility = await getCurrentPrivacyEligibility(supabase);
      if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
        await rejectPrivacyIneligibleSession(signedInUserId);
        toast.error(privacyEligibilityGuidance(eligibility.reasonCode));
        return;
      }

      toast.success("회원가입 완료! 환영합니다.");
      dispatchHomeAuthSessionUpdated({
        hasSession: true,
        source: 'auth-modal-signup',
      });
      resetForm();
      if (redirectAfterAdminLogin()) return;
      closeAfterAuthSuccess();
    } catch {
      toast.error("회원가입을 완료할 수 없습니다. 다시 시도해주세요.");
    } finally {
      if (recoveryToken !== null) endExistingAccountPrivacyRecovery(recoveryToken);
      setIsLoading(false);
    }
  }, [ageBand, closeAfterAuthSuccess, confirmPassword, email, isExistingAccountRecovery, password, policyContentSha256, policyVersion, privacyAgreed, redirectAfterAdminLogin, rejectPrivacyIneligibleSession, resetForm, startOnboardingChallenge, username]);

  const handleForgotPassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotPasswordEmail) {
      toast.error("이메일을 입력해주세요");
      return;
    }
    setIsSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotPasswordEmail, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw new Error("password_reset_failed");
      toast.success("비밀번호 재설정 링크를 이메일로 발송했습니다");
      setShowForgotPassword(false);
      setForgotPasswordEmail("");
    } catch {
      toast.error("이메일 발송에 실패했습니다");
    } finally {
      setIsSendingReset(false);
    }
  }, [forgotPasswordEmail]);

  const handlePrivacyAgree = useCallback(() => {
    setPrivacyAgreed(true);
    setIsPrivacyModalOpen(false);
  }, []);

  const handleMarketingConsentChange = useCallback((key: keyof MarketingConsent, value: boolean) => {
    setMarketingConsent((current) => {
      const next = { ...current, [key]: value };
      if (key === "email" && !value) next.night_email = false;
      if (key === "sms" && !value) next.night_sms = false;
      if (key === "push" && !value) next.night_push = false;
      return next;
    });
  }, []);
  const isPrivacyOnboarding = reason === AUTH_PRIVACY_ONBOARDING_REASON;
  const privacyOnboardingContent = (
    <div className="space-y-4" data-testid="privacy-onboarding-modal">
      <p className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm leading-6" role="status">
        Google 로그인은 완료되었습니다. 서비스 이용에 필요한 항목만 확인해주세요.
      </p>
      <OnboardingConsentFields
        ageBand={ageBand}
        onAgeBandChange={setAgeBand}
        privacyAgreed={privacyAgreed}
        onPrivacyAgreedChange={setPrivacyAgreed}
        onPrivacyPolicyOpen={() => setIsPrivacyModalOpen(true)}
        marketingConsent={marketingConsent}
        onMarketingConsentChange={handleMarketingConsentChange}
        policyVersionReady={Boolean(policyVersion && policyContentSha256)}
      />
      <Button
        type="button"
        className="h-11 w-full bg-gradient-primary text-sm hover:opacity-90 sm:text-base"
        onClick={handleGoogleSignup}
        disabled={isGoogleLoading || !privacyAgreed || !ageBand || !policyVersion || !policyContentSha256}
      >
        <GoogleIcon />
        {isGoogleLoading ? "연결 중..." : "Google로 개인정보 확인 완료하기"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        선택 항목에 동의하지 않아도 계속할 수 있습니다.
      </p>
    </div>
  );

  // 모달이 닫혀있으면 아무것도 렌더링하지 않음 (성능 최적화)
  if (!isOpen) return null;

  return (
    <>
      {isMobileOrTablet && (
        <BottomSheet
          isOpen={isOpen}
          onClose={onClose}
          {...MOBILE_FULL_FORM_SHEET}
          layoutSource="auth-modal"
          className="z-[110]"
          ariaLabelledBy="auth-sheet-title"
          ariaDescribedBy="auth-sheet-description"
        >
          <div className={mobileSheetStyles.frame}>
          <MobileSheetHeader
            title={isPrivacyOnboarding ? "개인정보 확인" : "쯔동여지도"}
            description={isPrivacyOnboarding ? "Google 로그인 후 필수 정보를 확인해주세요" : "쯔양의 맛집을 리뷰하고 공유하세요"}
            titleId="auth-sheet-title"
            descriptionId="auth-sheet-description"
            icon={<span className="text-xl">🔥</span>}
            action={(
              <Button type="button" variant="ghost" size="icon" aria-label="로그인 바텀시트 닫기" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            )}
          />

          {isPrivacyOnboarding && (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {privacyOnboardingContent}
            </div>
          )}
          {!isPrivacyOnboarding && (
          <Tabs value={authTab} onValueChange={(value) => setAuthTab(value as "login" | "signup")} className="w-full flex-1 px-4 py-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">로그인</TabsTrigger>
              <TabsTrigger value="signup">회원가입</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-sm">이메일</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-sm">비밀번호</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    enterKeyHint="done"
                    className="h-10 sm:h-11"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-10 sm:h-11 bg-gradient-primary hover:opacity-90 text-sm sm:text-base"
                  disabled={isLoading}
                >
                  {isLoading ? "로그인 중..." : "로그인"}
                </Button>
                <button
                  type="button"
                  className="min-h-6 w-full py-1 text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                  onClick={() => setShowForgotPassword(true)}
                >
                  비밀번호를 잊으셨나요?
                </button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    또는
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-10 sm:h-11"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
              >
                <GoogleIcon />
                {isGoogleLoading ? "연결 중..." : "Google로 계속하기"}
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-2">
                기존 Google 계정으로 로그인합니다
              </p>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                {isExistingAccountRecovery && (
                  <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
                    기존 계정의 개인정보 처리 확인을 완료합니다. 연령대와 최신 개인정보 처리방침을 선택해주세요.
                  </p>
                )}
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <Label htmlFor="signup-username" className="text-sm">닉네임</Label>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="signup-username"
                      placeholder="닉네임을 입력하세요"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      enterKeyHint="next"
                      className="h-10 sm:h-11 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={refreshNickname}
                      className="h-10 sm:h-11 w-10 sm:w-11 shrink-0"
                      title="다른 랜덤 닉네임"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-sm">이메일</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <Label htmlFor="signup-password" className="text-sm">비밀번호</Label>
                  </div>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm">비밀번호 확인</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="done"
                    className="h-10 sm:h-11"
                  />
                </div>

                <OnboardingConsentFields
                  ageBand={ageBand}
                  onAgeBandChange={setAgeBand}
                  privacyAgreed={privacyAgreed}
                  onPrivacyAgreedChange={setPrivacyAgreed}
                  onPrivacyPolicyOpen={() => setIsPrivacyModalOpen(true)}
                  marketingConsent={marketingConsent}
                  onMarketingConsentChange={handleMarketingConsentChange}
                  policyVersionReady={Boolean(policyVersion && policyContentSha256)}
                />

                <Button
                  type="submit"
                  className="w-full h-10 sm:h-11 bg-gradient-primary hover:opacity-90 text-sm sm:text-base"
                  disabled={isLoading || !privacyAgreed || !ageBand || !policyVersion || !policyContentSha256}
                >
                  {isLoading ? "가입 중..." : "회원가입"}
                </Button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    또는
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-10 sm:h-11"
                onClick={handleGoogleSignup}
                disabled={isGoogleLoading || !privacyAgreed || !ageBand || !policyVersion || !policyContentSha256}
              >
                <GoogleIcon />
                {isGoogleLoading ? "연결 중..." : "Google 개인정보 확인 계속하기"}
              </Button>
            </TabsContent>
          </Tabs>
          )}

          {!isPrivacyOnboarding && (
            <div className={`${mobileSheetStyles.footer} text-center text-xs text-muted-foreground`}>
            <button
              type="button"
              className="inline-flex min-h-6 items-center text-primary underline hover:text-primary/80"
              onClick={() => setIsPrivacyModalOpen(true)}
            >
              개인정보 처리방침
            </button>
            을 확인해주세요
          </div>
          )}
          </div>
        </BottomSheet>
      )}

      {!isMobileOrTablet && (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={AUTH_MODAL_DESKTOP_CONTENT_CLASS_NAME} style={AUTH_MODAL_DESKTOP_CONTENT_STYLE}>
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-primary rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-xl sm:text-2xl">🔥</span>
              </div>
              <DialogTitle className="text-xl sm:text-2xl bg-gradient-primary bg-clip-text text-transparent">
                {isPrivacyOnboarding ? "개인정보 확인" : "쯔동여지도"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-sm text-left">
              {isPrivacyOnboarding ? "Google 로그인 후 필수 정보를 확인해주세요" : "쯔양의 맛집을 리뷰하고 공유하세요"}
            </DialogDescription>
          </DialogHeader>

          {isPrivacyOnboarding && privacyOnboardingContent}
          {!isPrivacyOnboarding && (
          <Tabs value={authTab} onValueChange={(value) => setAuthTab(value as "login" | "signup")} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">로그인</TabsTrigger>
              <TabsTrigger value="signup">회원가입</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-sm">이메일</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-sm">비밀번호</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    enterKeyHint="done"
                    className="h-10 sm:h-11"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-10 sm:h-11 bg-gradient-primary hover:opacity-90 text-sm sm:text-base"
                  disabled={isLoading}
                >
                  {isLoading ? "로그인 중..." : "로그인"}
                </Button>
                <button
                  type="button"
                  className="min-h-6 w-full py-1 text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                  onClick={() => setShowForgotPassword(true)}
                >
                  비밀번호를 잊으셨나요?
                </button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    또는
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-10 sm:h-11"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
              >
                <GoogleIcon />
                {isGoogleLoading ? "연결 중..." : "Google로 계속하기"}
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-2">
                기존 Google 계정으로 로그인합니다
              </p>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                {isExistingAccountRecovery && (
                  <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
                    기존 계정의 개인정보 처리 확인을 완료합니다. 연령대와 최신 개인정보 처리방침을 선택해주세요.
                  </p>
                )}
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <Label htmlFor="signup-username" className="text-sm">닉네임</Label>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="signup-username"
                      placeholder="닉네임을 입력하세요"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      enterKeyHint="next"
                      className="h-10 sm:h-11 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={refreshNickname}
                      className="h-10 sm:h-11 w-10 sm:w-11 shrink-0"
                      title="다른 랜덤 닉네임"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-sm">이메일</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <Label htmlFor="signup-password" className="text-sm">비밀번호</Label>
                  </div>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="next"
                    className="h-10 sm:h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm">비밀번호 확인</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    enterKeyHint="done"
                    className="h-10 sm:h-11"
                  />
                </div>

                <OnboardingConsentFields
                  ageBand={ageBand}
                  onAgeBandChange={setAgeBand}
                  privacyAgreed={privacyAgreed}
                  onPrivacyAgreedChange={setPrivacyAgreed}
                  onPrivacyPolicyOpen={() => setIsPrivacyModalOpen(true)}
                  marketingConsent={marketingConsent}
                  onMarketingConsentChange={handleMarketingConsentChange}
                  policyVersionReady={Boolean(policyVersion && policyContentSha256)}
                />

                <Button
                  type="submit"
                  className="w-full h-10 sm:h-11 bg-gradient-primary hover:opacity-90 text-sm sm:text-base"
                  disabled={isLoading || !privacyAgreed || !ageBand || !policyVersion || !policyContentSha256}
                >
                  {isLoading ? "가입 중..." : "회원가입"}
                </Button>
              </form>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    또는
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-10 sm:h-11"
                onClick={handleGoogleSignup}
                disabled={isGoogleLoading || !privacyAgreed || !ageBand || !policyVersion || !policyContentSha256}
              >
                <GoogleIcon />
                {isGoogleLoading ? "연결 중..." : "Google 개인정보 확인 계속하기"}
              </Button>
            </TabsContent>
          </Tabs>
          )}

          {!isPrivacyOnboarding && (
            <div className="text-xs text-center text-muted-foreground">
            <button
              type="button"
              className="inline-flex min-h-6 items-center text-primary underline hover:text-primary/80"
              onClick={() => setIsPrivacyModalOpen(true)}
            >
              개인정보 처리방침
            </button>
            을 확인해주세요
          </div>
          )}
        </DialogContent>
      </Dialog>
      )}

      {/* 개인정보 처리방침 모달 */}
      <Dialog open={isPrivacyModalOpen} onOpenChange={setIsPrivacyModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <DialogHeader>
            <DialogTitle>개인정보 처리방침</DialogTitle>
            <DialogDescription>
              쯔동여지도 서비스의 개인정보 처리방침입니다.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[50vh] sm:h-[55vh] pr-4">
            <PrivacyPolicyContent />
          </ScrollArea>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setIsPrivacyModalOpen(false)}>
              닫기
            </Button>
            <Button onClick={handlePrivacyAgree}>
              동의하기
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 비밀번호 찾기 모달 */}
      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 rounded-xl pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button.absolute]:hidden">
          <DialogHeader>
            <DialogTitle>비밀번호 찾기</DialogTitle>
            <DialogDescription>
              가입하신 이메일 주소를 입력하시면 <br />비밀번호 재설정 링크를 보내드립니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email" className="text-sm">이메일</Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="your@email.com"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                autoComplete="email"
                className="h-10 sm:h-11"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-10 sm:h-11"
                onClick={() => {
                  setShowForgotPassword(false);
                  setForgotPasswordEmail("");
                }}
              >
                취소
              </Button>
              <Button
                type="submit"
                className="flex-1 h-10 sm:h-11 bg-gradient-primary hover:opacity-90"
                disabled={isSendingReset}
              >
                {isSendingReset ? "발송 중..." : "재설정 링크 발송"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
});
AuthModal.displayName = "AuthModal";

export default AuthModal;
