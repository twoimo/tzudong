export type ProcessingOperatorState =
  | 'observed_candidate_boundary'
  | 'pending_operator_approval'
  | 'blocked_until_deployed_readback';

export type ProcessingInventoryItem = Readonly<{
  dataClass: string;
  label: string;
  fields: readonly string[];
  purpose: string;
  source: string;
  sink: readonly string[];
  providerBoundary: string;
  retention: string;
  deletion: string;
  operatorState: ProcessingOperatorState;
  externalPrerequisite?: string;
}>;

/**
 * Candidate evidence only. A pending item is not a published processing fact:
 * its purpose, provider/transfer boundary, retention basis, and executable
 * readback must be approved by the operator before policy publication.
 */
export const PROCESSING_INVENTORY = [
  {
    dataClass: 'auth_identity',
    label: '계정·인증 정보',
    fields: ['이메일 주소', '인증 제공자 식별자', '세션 상태'],
    purpose: '회원 가입·로그인·계정 접근 관리',
    source: '이용자 입력 또는 Google OAuth 로그인 흐름',
    sink: ['Supabase Auth'],
    providerBoundary: '비밀번호와 인증 토큰은 Supabase Auth 경계에서 처리되며 애플리케이션 데이터베이스에 복사하지 않는 것을 전제로 합니다.',
    retention: '정확한 보유 근거·기산점·기간 및 Supabase의 실제 삭제·백업 경계는 운영자 승인과 배포 환경 읽기검증 전 미확정입니다.',
    deletion: '계정 삭제 미리보기에서 대상이 확인된 경우 세션 정리와 Auth 삭제를 마지막 단계로 적용하고, 독립 읽기검증이 모두 통과한 영수증이 있어야 완료로 표시합니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'profile',
    label: '프로필 정보',
    fields: ['사용자 ID', '사용자명·닉네임', '아바타 URL', '역할·생성/변경 시각'],
    purpose: '회원 식별, 프로필 표시, 권한 관리',
    source: '회원 가입·프로필 수정',
    sink: ['Supabase 데이터베이스', '프로필 이미지 저장소'],
    providerBoundary: 'Supabase 데이터베이스·저장소의 실제 RLS, 버킷 공개 범위 및 운영 권한은 별도 읽기검증이 필요합니다.',
    retention: '프로필별 보유 근거와 운영 환경의 보존 설정은 승인 전 미확정입니다.',
    deletion: '계정 삭제 항목별 미리보기 결과에 따라 삭제 또는 익명화하며, 저장소 객체는 별도 목록·읽기검증이 필요합니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'user_content',
    label: '리뷰·맛집 제보·이용자 작성 콘텐츠',
    fields: ['리뷰 제목·내용·방문 정보', '맛집명·주소·분류', 'YouTube URL', '첨부 사진·영수증 사진'],
    purpose: '맛집 정보 제공, 리뷰·제보 접수 및 운영 검토',
    source: '이용자 작성·업로드',
    sink: ['Supabase 데이터베이스', '첨부 파일 저장소', '운영 검토 경로'],
    providerBoundary: '저장소 객체, 검토 감사기록 및 공개 표시 범위는 배포 환경의 정책·권한 읽기검증이 필요합니다.',
    retention: '콘텐츠별 보존 근거, 기산점, 기간 및 법적 보류 적용 여부는 운영자 승인 전 미확정입니다.',
    deletion: '계정 삭제 미리보기에서 삭제·익명화·분리·보존 중 적용 항목을 확인하며, 보존 또는 보류 대상은 활성 서비스 경로에서 분리하는 제어와 읽기검증이 필요합니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'browser_drafts',
    label: '브라우저 임시 저장 초안',
    fields: ['제보·수정·리뷰 초안 필드', '초안 소유자 식별자', '작성·수정 시각'],
    purpose: '작성 중단 후 재개 지원',
    source: '이용자 브라우저 입력',
    sink: ['브라우저 IndexedDB'],
    providerBoundary: '브라우저 로컬 저장소는 Supabase·Vercel과 별개의 단말 경계입니다.',
    retention: '초안 정리의 실제 호출·기산점·기간은 운영자 승인 및 실행 읽기검증 전 미확정입니다.',
    deletion: '성공한 계정 삭제 영수증 후 알려진 초안 저장소를 정리하는 제어가 배포·읽기검증되어야 하며, 실패·부분 결과에서는 완료로 표시하지 않습니다.',
    operatorState: 'pending_operator_approval',
  },
  {
    dataClass: 'ocr_receipt_data',
    label: '영수증 이미지와 OCR 파생 정보',
    fields: ['영수증 이미지', '이미지 해시', 'OCR 추출 텍스트·처리 메타데이터'],
    purpose: '방문 인증 보조 및 운영 검토',
    source: '이용자 업로드',
    sink: ['OCR 처리 경로', 'Supabase 데이터베이스', '파일 저장소'],
    providerBoundary: 'OCR 제공자, 처리 위치, 수탁·국외 이전 사실, 원본·원시 OCR 결과의 실제 저장 여부는 승인 전 확정하지 않습니다.',
    retention: 'OCR 원본·파생 정보의 보유 근거·기간·삭제 작업은 승인된 실행 제어와 읽기검증 전 미확정입니다.',
    deletion: '계정 삭제 및 보존 작업은 이미지·파생 정보·저장소 객체를 각각 항목화하고, 원시 OCR 또는 이미지 내용을 영수증·감사기록에 복사하지 않아야 합니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'device_location',
    label: '기기 위치',
    fields: ['위도·경도', '정확도', '방향', '갱신 시각'],
    purpose: '현재 지도 화면에서 이용자 위치 표시·방향 보조',
    source: '브라우저 위치 권한 후 기기 센서',
    sink: ['현재 지도 React 메모리 상태'],
    providerBoundary: '기기 좌표는 지도 화면 표시를 위해 현재 브라우저 메모리에 반영되며, 지도 SDK 렌더링·뷰 이동 경로에서 단말 외 전송이 생길 수 있는 지점을 별도로 분리해 확인해야 합니다. 후보 코드 기준에서는 네트워크·URL·분석·로그·브라우저 저장소·Supabase로 직접 전달하거나 영구 저장하는 처리 확인이 없습니다.',
    retention: '기기 좌표는 런타임 메모리 상태만 유지되며 페이지 숨김·모드 종료·컴포넌트 정리 시 즉시 제거 대상입니다. 장기 보유 근거는 현재 별도 승인 전 미확정입니다.',
    deletion: '위치 모드 해제·화면 이탈·컴포넌트 정리 시 위치 감시를 중지하고, 현재 좌표 상태를 정리하는 제어의 배포 읽기검증이 필요합니다.',
    operatorState: 'blocked_until_deployed_readback',
    externalPrerequisite: '기기 위치 단말 외 처리(지도 제공자 처리 범위·위치정보 사업 요건·법적 근거)가 운영자 공식 증적으로 확인되고 배포 읽기검증이 통과되기 전에는 해당 표시 기능을 활성화하지 않습니다.',
  },
  {
    dataClass: 'business_location',
    label: '맛집·사업장 위치',
    fields: ['입력 주소', '지오코딩된 위도·경도', '주소 표기·지오코딩 상태'],
    purpose: '맛집 검색, 지도 마커·경로 표시, 제보 검토',
    source: '이용자 제보 주소 및 운영 지오코딩',
    sink: ['Supabase 데이터베이스', '지도 표시', '승인된 지오코딩 처리 경로'],
    providerBoundary: '이는 기기 위치와 다른 데이터 종류입니다. 지오코딩 제공자·전송 범위·수탁 또는 국외 이전 사실은 운영자 확인 전 미확정입니다.',
    retention: '사업장 위치의 보유 근거·기간과 정정 기준은 운영자 승인 전 미확정입니다.',
    deletion: '제보·사업장 데이터의 삭제 또는 익명화는 항목별 미리보기·권한 확인·읽기검증 결과에 따르며, 기기 위치 삭제와 같은 처리로 보지 않습니다.',
    operatorState: 'pending_operator_approval',
  },
  {
    dataClass: 'consent_age_marketing',
    label: '개인정보 확인·연령대·마케팅 선택',
    fields: ['처리방침 버전·내용 해시', '최소 연령대', '필수 확인', '일반·야간 마케팅 채널별 선택·철회'],
    purpose: '가입 자격 확인, 처리방침 확인 증적, 선택 마케팅 수신 관리',
    source: '가입·OAuth·설정·보호자 확인 흐름',
    sink: ['개인정보 동의 원장·파생 상태를 위한 Supabase 데이터베이스 계약'],
    providerBoundary: '배포된 스키마·RPC·RLS 및 보호자 확인 제공자는 아직 이 초안의 승인 사실이 아닙니다.',
    retention: '동의 원장·철회 이력의 보유 근거·기간은 운영자와 법률 검토 승인 전 미확정입니다.',
    deletion: '필수 처리방침 확인은 선택 마케팅 동의로 대체되지 않으며, 마케팅 철회는 계정 삭제와 별도로 발송 억제 읽기검증이 필요합니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'notifications',
    label: '알림·마케팅 메시지',
    fields: ['알림 분류', '채널', '읽음 상태', '수신 선택 연결 정보', '제한된 메시지 데이터'],
    purpose: '서비스성 알림 전달 및 별도 선택된 마케팅 발송 관리',
    source: '서비스 이벤트·운영 발송 요청·이용자 수신 선택',
    sink: ['Supabase 알림 데이터 계약', '승인된 발송 제공자'],
    providerBoundary: '알림 테이블·발송 제공자·채널별 처리와 국외 이전 사실은 실제 배포 계약·읽기검증 전 확정하지 않습니다.',
    retention: '알림·발송 결과의 보유 근거·기간과 정리 작업은 승인 전 미확정입니다.',
    deletion: '계정 삭제 미리보기의 알림 항목과 철회 직전 권한 재평가가 배포·읽기검증되어야 하며, 실패한 발송·삭제를 성공으로 표시하지 않습니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
  {
    dataClass: 'service_runtime_metadata',
    label: '세션·접속 및 최소 운영 메타데이터',
    fields: ['세션 쿠키', '접속·오류·권한 처리 메타데이터', '요청 식별자', '해시 또는 집계된 보안 정보'],
    purpose: '세션 유지, 보안 대응, 장애 조사, 권한·감사 확인',
    source: '브라우저·서비스 요청 및 관리자 작업',
    sink: ['Supabase·Vercel 운영 경계', '제한된 감사 경로'],
    providerBoundary: '호스팅 제공자의 실제 로그 내용·보관·백업·지역·접근권한은 저장소 증거만으로 확정할 수 없으며 운영자 확인이 필요합니다.',
    retention: '접속·감사 메타데이터의 적용 근거·분기·기간은 승인된 보존 클래스와 실행 읽기검증 전 미확정입니다.',
    deletion: '활성 경로에서의 계정 연결 정보 정리와 별도로, 승인된 분리 보존·법적 보류·제공자 백업 한계는 항목별 결과로 표시해야 합니다.',
    operatorState: 'pending_operator_approval',
  },
  {
    dataClass: 'privacy_requests_incidents',
    label: '권리 요청·삭제 영수증·사고 대응 기록',
    fields: ['요청·작업 식별자', '상태·사유 코드', '항목별 개수', '읽기검증 결과', '승인·제출 참조'],
    purpose: '권리 요청 처리, 삭제·보존 작업의 증적, 사고 대응 초안과 승인 흐름',
    source: '이용자 요청·서비스 감지·권한 있는 운영자 입력',
    sink: ['제한된 Supabase 개인정보 감사·사고 데이터 계약'],
    providerBoundary: '외부 통지·제출은 자동으로 수행하지 않으며, 외부 기관·제공자와의 실제 제출·수신 사실은 권한 있는 사람이 별도 기록·확인해야 합니다.',
    retention: '감사·사고 기록의 접근권한·보유 근거·기간은 운영자 승인 전 미확정입니다.',
    deletion: '삭제 영수증에는 삭제된 원문·이미지·토큰·정확한 위치를 넣지 않으며, 보류·실패·부분 결과는 재처리 전 완료로 표시하지 않습니다.',
    operatorState: 'blocked_until_deployed_readback',
  },
] as const satisfies readonly ProcessingInventoryItem[];

export const PROCESSING_INVENTORY_BY_CLASS = Object.fromEntries(
  PROCESSING_INVENTORY.map((item) => [item.dataClass, item]),
) as Readonly<Record<ProcessingInventoryItem['dataClass'], ProcessingInventoryItem>>;
