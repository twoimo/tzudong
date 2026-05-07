# Important Codex sessions before archive

Reactivation prompt:

> We are continuing from this handoff. Read this document first, inspect the relevant repo/workspace, verify what still applies, and continue from the next steps without relying on old Codex chat history.

## Purpose

This document records large/old Codex session themes that should be reviewed before archive. It intentionally avoids raw thread IDs. It is a safety index, not a full transcript export.

## Selection basis

- Source: read-only `$keep-codex-fast --details` scan on 2026-05-05.

- WSL Codex had about 4.714G sessions and 4043 old-session candidates.

- Windows Codex had about 2.699G sessions, only 5 tiny old-session candidates, and 6 config prune candidates.

- Only large-session aliases, sizes, source, and high-level titles are summarized here.

## Important candidate sessions

### Candidate 1: session_001

- Source: WSL Codex

- Approx size: 86.6 MB

- Theme: tzudong product/admin work

- Title cue: 다음 내용들을 빅테크 대기업들이 개발하는 방식으로 구현 진행해줘. 모바일/태블릿/데스크탑 모드에 사용자가 리뷰 페이지, 도장 

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 2: session_002

- Source: WSL Codex

- Approx size: 83.2 MB

- Theme: tzudong product/admin work

- Title cue: autopilot 관리자 /insights 챗봇 기능에 대해 /prompts:architect, /prompts:planner

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 3: session_003

- Source: WSL Codex

- Approx size: 79.1 MB

- Theme: tzudong product/admin work

- Title cue: autopilot 관리자 /insights 챗봇 기능에 대해 /prompts:architect, /prompts:planner

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 4: session_004

- Source: WSL Codex

- Approx size: 75.0 MB

- Theme: tzudong product/admin work

- Title cue: 모바일 모드에서 관리자 검수 페이지 리스트탭 좌우 스와이프 기능 추가해줘. 스와이프 하면 "전체, 미처리, 승인대기, 승인됨 

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 5: session_005

- Source: WSL Codex

- Approx size: 61.4 MB

- Theme: tzudong product/admin work

- Title cue: https://github.com/bmad-code-org/BMAD-METHOD 레포지토리 참고해서 BMAD 방식으로 쯔양과 

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 6: session_006

- Source: WSL Codex

- Approx size: 47.5 MB

- Theme: tzudong product/admin work

- Title cue: 관리자 계정으로 보이는 쯔동여지도 인사이트 있잖아? 그거 전면 개편할거야. C:\Users\twoimo\Desktop\open

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 7: session_007

- Source: WSL Codex

- Approx size: 46.8 MB

- Theme: LLM Wiki / knowledge-workspace work

- Title cue: 99_LLM Wiki 폴더 제외하고 나머지 폴더 모두 잘 정리해줘.

- Archive-before action: Create a workspace-local handoff in the relevant Drive/wiki workspace if continuing this work.



### Candidate 8: session_008

- Source: WSL Codex

- Approx size: 29.3 MB

- Theme: LLM Wiki / knowledge-workspace work

- Title cue: $deep-interview 우리는 지금 "AI를 위한 세컨드 브레인"을 만들고 있어.

- Archive-before action: Create a workspace-local handoff in the relevant Drive/wiki workspace if continuing this work.



### Candidate 9: session_009

- Source: WSL Codex

- Approx size: 28.8 MB

- Theme: tzudong product/admin work

- Title cue: ULTRATHINK, 관리자 계정으로 보이는 쯔동여지도 인사이트 있잖아? 그거 전면 개편할거야. C:\Users\twoimo\

- Archive-before action: Create or update a repo-specific handoff under this repo before archiving if this work is still active.



### Candidate 10: session_010

- Source: WSL Codex

- Approx size: 28.1 MB

- Theme: LLM Wiki / knowledge-workspace work

- Title cue: 해당 폴더에 있는 이미지를 모두 참고해서 모든 내용을 아우를 수 있게 마크다운으로 정리해줘. 참고로 해당 사진은 C:\User

- Archive-before action: Create a workspace-local handoff in the relevant Drive/wiki workspace if continuing this work.



### Candidate 11: session_001

- Source: Windows Codex

- Approx size: 0.5 MB

- Theme: miscellaneous or low-priority session

- Title cue: 아래 오류 해결해줘. 업데이트 하니까 발생한 것 같다? 다음 업데이트할 떄에도 발생하지 않도록 개선해줘.

- Archive-before action: Likely safe to archive after confirming no active dependency.



### Candidate 12: session_002

- Source: Windows Codex

- Approx size: 0.1 MB

- Theme: miscellaneous or low-priority session

- Title cue: $autopilot $plan $team 현재 프로젝트의 모든 파일(src 폴더)을 뒤져서 UX/UI적으로 구린 부분을 알아서

- Archive-before action: Likely safe to archive after confirming no active dependency.



## Handoff gaps

- This index does not prove the internal state of each old session. Before archiving a candidate that may still matter, inspect that session or reconstruct state from the target repo/workspace.

- Do not rely on the title alone for irreversible decisions.

## Next steps

1. For tzudong candidates, use repo state plus existing docs/tests to create focused handoffs when needed.

2. For LLM Wiki / Drive candidates, create handoffs in that workspace rather than this repo if the user wants to continue them.

3. After important sessions are protected by handoffs, run keep-codex-fast apply only after Codex is closed or with `--wait-for-codex-exit`.

4. Move resulting old archive/backup artifacts to the confirmed Google Drive backup folder only after verifying the folder exists and is private.
