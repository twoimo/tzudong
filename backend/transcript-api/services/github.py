#!/usr/bin/env python3
"""
GitHub 커밋/푸시 서비스

수집된 Transcript 파일을 GitHub에 자동으로 커밋하고 푸시합니다.
"""

import subprocess
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# 프로젝트 경로
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent  # tzudong 루트
CRAWLING_DATA_DIR = PROJECT_ROOT / "backend" / "geminiCLI-restaurant-crawling" / "data"

# 타겟 브랜치
TARGET_BRANCH = "github-actions-restaurant"


def run_git_command(command: list, cwd: Path = None) -> tuple[bool, str]:
    """Git 명령어 실행"""
    try:
        result = subprocess.run(
            command,
            cwd=cwd or PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=True
        )
        return True, result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return False, e.stderr.strip()


def commit_and_push_transcripts(
    date_folder: str,
    transcript_count: int = 0
) -> Dict[str, Any]:
    """
    Transcript 파일을 GitHub에 커밋하고 푸시
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
        transcript_count: 수집된 transcript 수 (커밋 메시지용)
    
    Returns:
        결과 딕셔너리
    """
    # 현재 브랜치 확인
    success, current_branch = run_git_command(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if not success:
        return {
            "success": False,
            "message": f"현재 브랜치 확인 실패: {current_branch}"
        }
    
    # 타겟 브랜치가 아니면 경고
    if current_branch != TARGET_BRANCH:
        print(f"⚠️ 현재 브랜치: {current_branch} (타겟: {TARGET_BRANCH})")
        # 브랜치 전환 시도
        success, msg = run_git_command(["git", "checkout", TARGET_BRANCH])
        if not success:
            return {
                "success": False,
                "message": f"브랜치 전환 실패: {msg}"
            }
        print(f"✅ 브랜치 전환: {TARGET_BRANCH}")
    
    # Transcript 파일 경로
    transcript_file = CRAWLING_DATA_DIR / date_folder / "tzuyang_restaurant_transcripts.json"
    error_file = CRAWLING_DATA_DIR / date_folder / "tzuyang_transcript_errors.json"
    
    if not transcript_file.exists():
        return {
            "success": False,
            "message": f"Transcript 파일이 없습니다: {transcript_file}"
        }
    
    # 파일 추가
    files_to_add = [str(transcript_file.relative_to(PROJECT_ROOT))]
    if error_file.exists():
        files_to_add.append(str(error_file.relative_to(PROJECT_ROOT)))
    
    for file_path in files_to_add:
        success, msg = run_git_command(["git", "add", file_path])
        if not success:
            print(f"⚠️ git add 실패: {file_path} - {msg}")
    
    # 변경사항 확인
    success, diff_output = run_git_command(["git", "diff", "--staged", "--name-only"])
    if not diff_output:
        return {
            "success": True,
            "message": "변경사항 없음 (이미 커밋됨)"
        }
    
    # 커밋
    now = datetime.now(KST)
    commit_msg = f"📝 Transcript 수집: {date_folder}"
    if transcript_count > 0:
        commit_msg += f" ({transcript_count}개)"
    
    # Git 설정 (커밋용)
    run_git_command(["git", "config", "user.name", "Transcript API"])
    run_git_command(["git", "config", "user.email", "transcript-api@local"])
    
    success, msg = run_git_command(["git", "commit", "-m", commit_msg])
    if not success:
        return {
            "success": False,
            "message": f"커밋 실패: {msg}"
        }
    
    print(f"✅ 커밋 완료: {commit_msg}")
    
    # 푸시
    success, msg = run_git_command(["git", "push", "origin", TARGET_BRANCH])
    if not success:
        return {
            "success": False,
            "message": f"푸시 실패: {msg}. 수동으로 'git push origin {TARGET_BRANCH}' 실행하세요."
        }
    
    print(f"✅ 푸시 완료: origin/{TARGET_BRANCH}")
    
    return {
        "success": True,
        "message": f"커밋 및 푸시 완료: {commit_msg}",
        "commit_message": commit_msg,
        "branch": TARGET_BRANCH,
        "files": files_to_add
    }


def check_git_status() -> Dict[str, Any]:
    """Git 상태 확인"""
    # 현재 브랜치
    success, branch = run_git_command(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    
    # 변경사항
    success, status = run_git_command(["git", "status", "--short"])
    
    # 원격 저장소 연결 상태
    success, remote = run_git_command(["git", "remote", "-v"])
    
    return {
        "current_branch": branch,
        "target_branch": TARGET_BRANCH,
        "is_target_branch": branch == TARGET_BRANCH,
        "has_changes": bool(status),
        "status": status.split('\n') if status else [],
        "remote": remote.split('\n') if remote else []
    }


# CLI 실행
if __name__ == "__main__":
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description="GitHub 커밋/푸시")
    parser.add_argument("--date", "-d", help="날짜 폴더 (예: 25-12-02)")
    parser.add_argument("--status", "-s", action="store_true", help="Git 상태 확인")
    
    args = parser.parse_args()
    
    if args.status:
        result = check_git_status()
    else:
        date_folder = args.date or datetime.now(KST).strftime("%y-%m-%d")
        result = commit_and_push_transcripts(date_folder=date_folder)
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
