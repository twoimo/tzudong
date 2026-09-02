export const CONSOLE_FIXED_MESSAGES = {
  dataFetchFailed: "데이터를 불러오지 못했습니다. 다시 시도해 주세요.",
  sessionExpired: "관리자 세션 확인이 필요합니다. 다시 로그인해 주세요.",
  modulePanelMissing:
    "이 메뉴의 작업 화면을 준비하지 못했습니다. 다른 메뉴를 선택해 주세요.",
  orderLoadFailed: "저장된 메뉴 순서를 불러오지 못해 처음 상태로 표시합니다.",
  orderSaveFailed:
    "저장하지 못했습니다. 화면에는 임시 순서가 반영되어 있습니다.",
  orderSaved: "메뉴 순서를 저장했습니다.",
  orderReset: "메뉴 구성이 바뀌어 메뉴 순서를 처음 상태로 되돌렸습니다.",
  legacyLinkNormalized: "기존 검수 링크를 새 관리자 경로로 정리했습니다.",
  unknownModule:
    "알 수 없는 관리자 화면 요청을 대시보드 (KPI)로 되돌렸습니다.",
  vizEmpty: "표시할 데이터가 없습니다.",
  vizFailed: "도표 데이터를 읽지 못했습니다.",
  vizInsufficient: "도형을 그리기에 데이터 점이 부족합니다.",
  reviewTargetUnapproved:
    "리뷰 검수 목표 기준값이 승인되지 않아 목표 표식을 표시하지 않습니다.",
  generationUnavailable:
    "생성 준비 상태를 확인하지 못해 생성 제어를 사용할 수 없습니다.",
  gridEmpty: "조건에 맞는 메뉴가 없습니다.",
} as const;
