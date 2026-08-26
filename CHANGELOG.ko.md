# 변경 기록

쯔동여지도 제품 변경을 날짜 역순으로 적는다.

승격 경로는 `develop -> data -> main`이다. 아래 SHA는 따로 적지 않으면 `origin/main` 머지 커밋이다. 이 파일은 법령 준수, 승인된 가게 hosted 덮어쓰기, 맥이 켜져 있었다는 주장을 하지 않는다.

English: [CHANGELOG.md](CHANGELOG.md).

---
## 2026-08-26 — 문서 배치

### 변경

- 공통 문서는 `docs/product/`, `docs/operations/`, `docs/archive/handoffs/`로 나눈다. 루트에는 README, LICENSE, AGENTS, SECURITY, 변경 기록만 둔다. 색인: `docs/README.md`.


## 2026-08-25 — 호스티드 새 영상 파이프라인

**main 팁:** `64d669f6e1a3`  
**Production (Vercel `tzudong`):** `64d669f6e1` 성공, 2026-08-25 19:43 KST.  
**라이브:** https://tzudong.app

### 추가

- 매일 `hosted-pending-apply`가 호스티드에 없는 쯔양 유튜브 ID를 최대 1개 평가한 뒤 **pending만** 넣는다 (`run_hosted_new_video_pipeline.py`).
- 맥 LaunchAgent `dev.tzudong.hosted-new-video` (로컬 05:00)가 GitHub Actions와 같은 엔트리를 쓴다. 설치: `backend/bin/install_mac_hosted_pipeline_launchd.sh`.
- 관리자 크롤러 화면은 `127.0.0.1:8091`이 없으면 `main` 최근 Crawler 런으로 폴백한다.

### 변경

- 라이트 스케줄 크롤러는 Gemini 인증 실패(exit 43)나 워커 `exit_code` 공백/비0으로 잡을 죽이지 않는다.
- `hosted-pending-apply`는 `daily-compute` 성공에 묶이지 않는다.
- 자막 문맥(로컬 OpenAI)은 선택이다. 죽어도 청크/평가는 계속한다.
- LAAJ는 절대 평가 경로를 다시 붙이지 않고, Gemini CLI 없이 Node Gemini API로 계속하며 `--video-id`를 받는다.
- 09/10은 `--video-id`를 받고, 그 ID의 옛 selection/rule 파일을 다시 쓴다.

### 수정

- Production 빌드: `apps/web/app/api/admin/pipeline/route.ts`에서 GET 앞에 함수를 닫음 (#2735).
- 호스티드 평가 잡에 크롤 PyYAML + `backend` `npm ci` (#2732–#2739).
- apply 전에 `backend/log/cron/` 생성.
- 나이트리 로컬 publication 검증기/빌더 원장 개수 78 → 82 (`backend/supabase/migrations`와 일치, 이슈 #2592).

### 운영 (깃에 없음)

- GitHub Actions 변수 `TZUDONG_HOSTED_DATA_PLANE_APPROVED=1`.
- 시크릿 `GEMINI_API_KEY`를 AI Studio 무료 키 `tzudong-gemini-free`(프로젝트 `tzudong-free-zero`)로 갱신. 값은 여기에 적지 않는다.

### 아직 자동이 아닌 것

- 지도 공개는 사람 승인. `PIPELINE_HOSTED_APPLY_ENABLED`는 꺼둔다.
- 정육왕, 프레임 추출, 시각 위치, 여러 영상은 이 매일 잡에 없다.
- 맥이 꺼져 있으면 05:00은 안 돈다. 무인 스케줄 정본은 GitHub 04:00 KST.
- 최근 Crawler `32838239191` (`64d669f6`): `pipeline=ok`, `evaluate_exit=1`, `applyCandidateCount=0`. 발견은 됨. 새 pending은 09/10이 새 청크 파일을 보기 전엔 보장되지 않는다.

### 이날 main 머지 (`develop -> data -> main`, 핫픽스 제외)

| KST | PR | SHA | 제목 |
| --- | --- | --- | --- |
| 19:43 전후 | #2754 | `64d669f6` | 맥·GHA 호스티드 새 영상 파이프 통합 |
| ~19:15 | #2751 | `2f5aa570` | LAAJ `--video-id`만 |
| ~19:05 | #2748 | `6ab3e113` | Gemini CLI 없어도 LAAJ 계속 |
| ~18:55 | #2745 | `4ccc0595` | LAAJ 절대 평가 경로 |
| 18:48 | #2742 | `a3d68630` | 자막 문맥 선택 |
| 18:18 | #2739 | `fb2e4821` | 평가 잡 Node 의존성 |
| 18:15 | #2735 | `07505d4f` | 파이프라인 라우트 중괄호 (main 핫픽스) |
| 18:03 | #2734 | `01857a3a` | 평가 잡 PyYAML |
| 17:08 | #2731 | `5edccbf2` | 새 유튜브 1개 평가 + 관리자 GitHub 폴백 |
| 15:50 | #2728 | `e7ee55e4` | apply 프리뷰 디렉터리 |
| 15:45 | #2725 | `ce34b0e0` | 라이트 컴퓨트 유지, apply 독립 |
| 15:37 | #2722 | `a18354ec` | hosted pending-apply 잡 |

같은 날 경로상의 기능 PR: #2720 / #2723 / #2726 / #2729 / #2732 / #2737 / #2740 / #2743 / #2746 / #2749 / #2752.

---

## 항목 추가 방법

1. `## YYYY-MM-DD — 짧은 제목` (또는 `## Unreleased`) 아래에 적는다.
2. 추가 / 변경 / 수정 / 운영 / 아직 자동이 아닌 것으로 나눈다.
3. `origin/main` SHA와 Production 배포 SHA가 다르면 따로 적는다.
4. 같은 날짜 블록을 [CHANGELOG.md](CHANGELOG.md)에도 맞춘다.
5. 시크릿, 쿠키, 공급자 오류 본문은 붙이지 않는다.
