# BMAD Dashboard Workspace (Tzuyang)

이 폴더는 BMAD 방식으로 쯔양 데이터 대시보드를 개발하기 위한 실행 문서 세트입니다.

- 기준 시점: 2026-02-13 (로컬 워크스페이스 데이터 스냅샷)
- 개발 대상: `apps/web` (Next.js App Router)
- 데이터 원천: `backend/restaurant-crawling`, `backend/restaurant-evaluation`

## 문서 구성

- `docs/bmad/PRD.md`
  - 제품 목표, 역할 분리(일반/관리자), 데이터 현황 KPI, 성공 지표
- `docs/bmad/DB-INVENTORY.md`
  - Supabase DB 스키마/테이블 인벤토리(backup + CLI 확인 흐름)
- `docs/bmad/IA-ROUTES.md`
  - 현재 라우트 인벤토리, 목표 IA, URL/권한/기능 매핑
- `docs/bmad/WIREFRAME-TEXT.md`
  - 화면별 텍스트 와이어프레임(데스크톱/모바일)
- `docs/bmad/EPICS-STORIES.md`
  - BMAD 실행용 에픽/스토리/수용조건/완료기준
- `docs/bmad/SUPABASE-REMOTE-CLI.md`
  - 로컬 Supabase 없이 원격 DB 상태 확인/타입 생성 워크플로우
- `docs/bmad/STACK-RESEARCH.md`
  - 실무에서 많이 쓰는 대시보드 프레임워크/라이브러리 조사 + 이 레포 추천 스택

## BMAD 실행 순서 (Codex 5.3 spark 기준)

1. Brief/PRD 확정
2. IA/와이어프레임 동결
3. 에픽 우선순위 확정
4. 에픽 단위 구현 + AC 검증
5. 회귀 테스트 + 운영 지표 확인

## 이번 사이클의 핵심 결정

- 평가 데이터 SSOT는 `backend/restaurant-evaluation/data/tzuyang/evaluation`로 고정
- `backend/restaurant-crawling/data/tzuyang/evaluation`는 원천 비교용으로만 사용
- 관리자 화면은 기존 `/admin/insight`, `/admin/evaluations`를 확장
- 일반 사용자용 읽기 전용 대시보드는 `/insights` 신규 경로로 분리

## 즉시 실행 체크리스트

1. `PRD.md`의 범위(MVP/Next) 확정
2. `IA-ROUTES.md`의 신규 경로(`/insights`, `/api/dashboard/*`) 승인
3. `EPICS-STORIES.md`의 Epic 1부터 개발 시작
