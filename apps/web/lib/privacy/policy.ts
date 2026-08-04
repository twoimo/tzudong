import { PROCESSING_INVENTORY } from './processing-inventory';

export type PrivacyPolicyPublicationStatus = 'draft' | 'published' | 'retired';

export type PrivacyPolicyDatabaseRecord = Readonly<{
  id: string;
  version: string;
  locale: 'ko-KR';
  status: PrivacyPolicyPublicationStatus;
  content_sha256: string;
  effective_at: string | null;
  published_at: string | null;
  operator_approval_ref: string | null;
}>;

export type PrivacyPolicySection = Readonly<{
  id: string;
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}>;

export type OfficialPrivacyAuthorityLink = Readonly<{
  label: string;
  href: string;
  description: string;
}>;

export const PRIVACY_POLICY_VERSION = '2026-08-04.1' as const;
export const PRIVACY_POLICY_LOCALE = 'ko-KR' as const;
export const PRIVACY_POLICY_TITLE = '개인정보 처리방침' as const;

/**
 * This is the only database shape allowed to mark a rendered policy as public.
 * `operator_approval_ref` is internal evidence, not a legal-sufficiency flag.
 */
export const PRIVACY_POLICY_DATABASE_BINDING = {
  table: 'privacy_policy_versions',
  versionColumn: 'version',
  localeColumn: 'locale',
  statusColumn: 'status',
  contentHashColumn: 'content_sha256',
  effectiveAtColumn: 'effective_at',
  publishedAtColumn: 'published_at',
  operatorApprovalRefColumn: 'operator_approval_ref',
  requiredStatus: 'published',
} as const;

export const OFFICIAL_PRIVACY_AUTHORITY_LINKS = [
  {
    label: '국가법령정보센터 개인정보 보호법',
    href: 'https://www.law.go.kr/LSW/lsInfoP.do?lsId=011357',
    description: '개인정보 처리와 정보주체 권리의 공식 법령 확인',
  },
  {
    label: '개인정보보호위원회 개인정보 처리방침 작성지침',
    href: 'https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018',
    description: '처리방침 문언과 실제 처리의 대조를 위한 공식 안내',
  },
  {
    label: '개인정보침해 신고센터',
    href: 'https://privacy.kisa.or.kr/',
    description: '개인정보 침해 관련 공식 상담·신고 안내',
  },
  {
    label: '개인정보분쟁조정위원회',
    href: 'https://www.kopico.go.kr/',
    description: '개인정보 분쟁조정 관련 공식 안내',
  },
  {
    label: '위치정보지원센터 사업 신고 안내',
    href: 'https://www.lbsc.kr/front/content/contentViewer.do?contentId=CONTENT_0000081',
    description: '개인위치정보 대상 여부와 사업 신고 절차를 확인하는 공식 안내',
  },
  {
    label: '한국인터넷진흥원 불법스팸 방지 안내',
    href: 'https://www.kisa.or.kr/401/form?lang_type=KO&page=1&postSeq=3608',
    description: '광고성 정보·야간 전송·수신 동의 운영을 확인하는 공식 안내',
  },
  {
    label: '국가법령정보센터 전자상거래법 기록 보존 조문',
    href: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900617247',
    description: '거래 기록 종류별 보존 의무와 적용 범위를 확인하는 공식 조문',
  },
] as const satisfies readonly OfficialPrivacyAuthorityLink[];

/** Korean is the primary language for both embedded and public policy views. */
export const PRIVACY_POLICY_SECTIONS = [
  {
    id: 'publication-status',
    title: '1. 이 문서의 상태와 배포 읽기검증',
    paragraphs: [
      '이 문서는 한국어를 우선으로 제공하는 공개 처리방침 원문입니다. 화면에 표시되는 공개 효력 발생일과 게시 시각은 배포된 읽기검증이 이 버전과 내용 SHA-256에 일치할 때만 표시합니다.',
      '이 문서는 실제 처리의 법적 충분성을 판단하거나, 확인되지 않은 처리·수탁·국외 이전·보존 기준 또는 권한을 확정하지 않습니다. 배포 읽기검증을 사용할 수 없거나 원문과 일치하지 않으면 공개 효력 발생일과 게시 시각을 표시하지 않습니다.',
    ],
    bullets: [
      '배포 읽기검증 조건: privacy_policy_versions의 published 상태, ko-KR 로캘, 같은 버전·내용 SHA-256, 유효일·게시 시각의 실제 읽기검증',
      '배포 레코드의 내부 증적은 이 화면에 표시하지 않으며, 법률 판단이나 기관의 판단을 뜻하지 않습니다.',
      '이전 공개본과 변경 이력은 배포된 정책 버전 레코드에서 확인합니다. 이 원문은 이전 공개본을 만들거나 추정하지 않습니다.',
    ],
  },
  {
    id: 'processing-scope',
    title: '2. 처리 항목과 목적',
    paragraphs: [
      '아래 처리 인벤토리는 현재 구현에서 확인된 데이터 흐름과 아직 확인되지 않은 운영 경계를 구분합니다. 각 항목의 목적·출처·저장 또는 전달 위치·보존·삭제·운영 상태를 함께 표시합니다.',
      '인벤토리에서 승인 대기 또는 배포 읽기검증 대기로 표시된 항목은 공개 처리 사실이나 보유기간으로 확정하지 않습니다.',
    ],
  },
  {
    id: 'age-consent-marketing',
    title: '3. 가입, 최소 연령대와 선택 동의',
    paragraphs: [
      '가입 흐름은 처리방침의 필수 확인과 선택 마케팅 수신을 분리합니다. 필수 확인은 선택 동의로 대체할 수 없고, 일반 마케팅과 야간 마케팅은 채널별로 분리된 선택과 철회 기록이 필요합니다.',
      '이 문서는 생년월일(DOB)이나 주민등록번호(RRN)를 수집 항목으로 두지 않습니다. 최소 데이터인 연령대만 사용합니다. 만 14세 미만 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.',
      '보호자 확인 제공자, 연령 산정 방식, 마케팅 채널·문구 및 실제 동의 원장은 운영자·법률 검토 승인과 배포 읽기검증 전 미확정입니다. 이 문서는 보호자 확인 경로가 현재 운영 중이거나 법적 충분하다고 주장하지 않습니다.',
    ],
  },
  {
    id: 'location-boundaries',
    title: '4. 기기 위치와 맛집·사업장 위치의 구분',
    paragraphs: [
      '기기 위치는 브라우저 권한 후 수집한 좌표·정확도·방향 정보로, 지도 화면 표시를 위해 브라우저 메모리에만 사용됩니다.',
      '지도 SDK 렌더링·뷰 이동 처리에서 단말 외 좌표 전달 경로가 생길 수 있으므로 별도 제공자 경계로 관리합니다. 현재 구현에서는 네트워크·URL·분석·로그·브라우저 저장소·Supabase로의 보존·전송 처리 확인이 없습니다.',
      '기기 위치는 위치 처리 증적(운영자 공식 판정/사실 확인)이 배포 읽기검증으로 확인될 때만 허용되며, 그 외에는 `unavailable` 상태로 간주합니다.',
      '맛집·사업장 위치는 이용자가 제보한 주소와 지오코딩된 좌표로, 지도 마커·경로·제보 검토에 쓰이는 별도 데이터입니다. 이는 기기 위치와 같은 종류로 취급하지 않습니다.',
      '기기 위치가 단말 밖으로 나가는 배포 경로, 위치 제공자, 적용 범위 또는 실제 저장이 확인되면 처리 범위와 운영 판단을 다시 확인해야 합니다.',
    ],
  },
  {
    id: 'providers-transfers',
    title: '5. 서비스 제공 경계와 외부 제공자',
    paragraphs: [
      '현재 구현에서 Supabase는 인증·데이터베이스·저장소 경계, Google은 OAuth 로그인 경계, Vercel은 웹 호스팅 경계로 확인됩니다. OCR 처리 경로와 지오코딩·알림 제공자의 실제 제공자, 처리 위치, 계약상 역할 및 국외 이전 사실은 이 문서에서 확정하지 않습니다.',
      '수탁자, 제3자 제공 여부, 국외 이전, 저장 위치, 백업·로그 삭제 가능 범위는 운영자 증적과 배포 환경 확인 후에만 공개 처리 범위에 반영합니다.',
    ],
  },
  {
    id: 'retention-deletion',
    title: '6. 보존, 분리 및 계정 삭제',
    paragraphs: [
      '이 문서는 확인되지 않은 보유기간을 숫자로 게시하지 않습니다. 보유 근거·기산점·기간·법적 보류·분리 저장·만료 처리와 제공자 백업 한계는 항목별 운영자 승인과 활성화된 실행 제어의 읽기검증이 있어야 합니다.',
      '계정 삭제는 미리보기에서 삭제·익명화·분리·보존 항목별 개수를 확인하고, 최근 재인증과 정확한 확인 문구 뒤에 적용해야 합니다. 데이터베이스, 저장소, 세션, Auth의 독립 읽기검증이 모두 통과한 영수증만 완료를 뜻합니다.',
      '보류, 법령상 분리 보존, 제공자 로그·백업, 외부 처리 경계 또는 읽기검증 실패가 있으면 모든 데이터의 삭제나 즉시 삭제를 말하지 않습니다. 해당 결과는 보류·부분·실패로 구분하여 표시하고 재처리 경로를 제공합니다.',
    ],
  },
  {
    id: 'incidents',
    title: '7. 사고 대응과 대외 통지',
    paragraphs: [
      '사고 대응 흐름은 내부 초안과 경보를 만들 수 있지만, 정보주체 또는 관계기관에 대한 통지·제출은 자동으로 수행하지 않습니다. 인지 시각, 사실관계, 영향 범위, 승인자와 제출자는 권한 있는 사람이 확인해야 합니다.',
      '사람이 기록한 외부 제출 참조는 수행 사실을 위한 내부 증적일 뿐, 기관의 판단이나 이 문서의 법적 충분성을 뜻하지 않습니다.',
    ],
  },
  {
    id: 'rights-contact',
    title: '8. 권리 행사와 문의',
    paragraphs: [
      '이용자는 열람, 정정, 삭제, 처리 정지, 동의 철회 등 요청을 서비스 내 권리 요청 경로 또는 아래 문의처로 전달할 수 있습니다. 요청 처리 전에는 최소한의 안전한 본인 확인과 권한 확인이 필요합니다.',
      '이메일 요청에는 비밀번호, 인증 토큰, 주민등록번호, 원시 OCR 결과, 이미지 원본 또는 정확한 위치를 보내지 마세요. 로그인할 수 없는 경우에도 요청 사실만 알려 주면 운영자가 최소 정보 확인이 가능한 안전한 후속 경로를 안내해야 합니다.',
    ],
  },
  {
    id: 'changes',
    title: '9. 버전·해시·변경 이력',
    paragraphs: [
      '새 문안은 새 버전과 내용 SHA-256을 가져야 합니다. 공개본 변경은 이전 버전을 지우거나 과거 동의 증적을 바꾸지 않으며, 배포된 정책 레코드의 유효일·게시 시각·읽기검증과 함께 확인되어야 합니다.',
      '고정된 시행일이나 고지 기간은 실제 처리 및 운영 기준에 따라 배포 읽기검증에서 확인합니다.',
    ],
  },
] as const satisfies readonly PrivacyPolicySection[];

/**
 * The content hash covers the Korean document and its machine-readable
 * inventory, not publication status or a confidential approval reference.
 */
export const privacyPolicyHashInput = () => JSON.stringify({
  version: PRIVACY_POLICY_VERSION,
  locale: PRIVACY_POLICY_LOCALE,
  title: PRIVACY_POLICY_TITLE,
  sections: PRIVACY_POLICY_SECTIONS,
  inventory: PROCESSING_INVENTORY,
  authorities: OFFICIAL_PRIVACY_AUTHORITY_LINKS,
});

/** SHA-256(UTF-8(privacyPolicyHashInput())). Recomputed whenever this source changes. */
export const PRIVACY_POLICY_CONTENT_SHA256 = '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' as const;

export const PRIVACY_POLICY_PUBLICATION = {
  version: PRIVACY_POLICY_VERSION,
  locale: PRIVACY_POLICY_LOCALE,
  contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
  previousVersion: null,
  changeSummary: '처리 인벤토리와 배포 읽기검증 경계를 반영한 공개 원문',
} as const;

export const hasNonEmptyOperatorApprovalReference = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * This validates a deployed row against this exact rendered source. It does
 * not assess legal sufficiency and intentionally fails closed.
 */
export const isApprovedPolicyPublication = (record: PrivacyPolicyDatabaseRecord | null | undefined) =>
  record?.status === PRIVACY_POLICY_DATABASE_BINDING.requiredStatus
  && record.version === PRIVACY_POLICY_VERSION
  && record.locale === PRIVACY_POLICY_LOCALE
  && record.content_sha256 === PRIVACY_POLICY_CONTENT_SHA256
  && typeof record.effective_at === 'string'
  && record.effective_at.trim().length > 0
  && typeof record.published_at === 'string'
  && record.published_at.trim().length > 0
  && hasNonEmptyOperatorApprovalReference(record.operator_approval_ref);

export type PrivacyPolicyPublicationReadback = Readonly<{
  id: string;
  version: typeof PRIVACY_POLICY_VERSION;
  contentSha256: typeof PRIVACY_POLICY_CONTENT_SHA256;
  effectiveAt: string;
  publishedAt: string;
}>;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parsePrivacyPolicyPublicationReadback = (
  value: unknown,
): PrivacyPolicyPublicationReadback | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 5
    || !['id', 'version', 'contentSha256', 'effectiveAt', 'publishedAt'].every((key) => keys.includes(key))
    || typeof record.id !== 'string'
    || !UUID_PATTERN.test(record.id)
    || record.version !== PRIVACY_POLICY_VERSION
    || record.contentSha256 !== PRIVACY_POLICY_CONTENT_SHA256
    || !isIsoTimestamp(record.effectiveAt)
    || !isIsoTimestamp(record.publishedAt)
  ) return null;

  return {
    id: record.id,
    version: record.version,
    contentSha256: record.contentSha256,
    effectiveAt: record.effectiveAt,
    publishedAt: record.publishedAt,
  };
};
