#!/usr/bin/env python3
"""
GitHub 커밋/푸시 서비스

수집된 Transcript 파일을 GitHub에 자동으로 커밋하고 푸시합니다.
"""

import subprocess
import sys
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# 프로젝트 경로
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent  # tzudong 루트
CRAWLING_DATA_DIR = PROJECT_ROOT / "backend" / "geminiCLI-restaurant-crawling" / "data"
LOG_DIR = PROJECT_ROOT / "backend" / "log" / "geminiCLI-restaurant"

# 타겟 브랜치
TARGET_BRANCH = "github-actions-restaurant"

# 로거 임포트
sys.path.insert(0, str(PROJECT_ROOT / 'backend' / 'utils'))
try:
    from logger import PipelineLogger
except ImportError:
    # 로거를 찾지 못하면 간단한 대체 로거 사용
    class PipelineLogger:
        def __init__(self, phase, log_dir=None, **kwargs): 
            self.phase = phase
            self._timers = {}
        def info(self, msg, data=None, step=None): print(f"ℹ️ {msg}")
        def success(self, msg, data=None, step=None): print(f"✅ {msg}")
        def warning(self, msg, data=None, step=None): print(f"⚠️ {msg}")
        def error(self, msg, data=None, step=None): print(f"❌ {msg}")
        def debug(self, msg, data=None, step=None): print(f"🔍 {msg}")
        def add_stat(self, key, value): pass
        def add_stat(self, key, value): pass
        def increment_stat(self, key, amount=1): pass
        def timer(self, name): 
            from contextlib import contextmanager
            import time
            @contextmanager
            def _timer():
                start = time.time()
                try:
                    yield
                finally:
                    elapsed = time.time() - start
                    self._timers[name] = elapsed
            return _timer()
        def start_stage(self): pass
        def end_stage(self): pass
        def save_summary(self): return {}
        def save_json_log(self): pass
        def get_summary(self): return {}


def run_git_command(command: list, cwd: Path = None, logger: Optional[PipelineLogger] = None) -> tuple[bool, str]:
    """Git 명령어 실행"""
    try:
        result = subprocess.run(
            command,
            cwd=cwd or PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=True
        )
        if logger:
            logger.debug(f"git 명령 성공: {' '.join(command)}")
        return True, result.stdout.strip()
    except subprocess.CalledProcessError as e:
        if logger:
            logger.error(f"git 명령 실패: {' '.join(command)}", {"stderr": e.stderr.strip()})
        return False, e.stderr.strip()


def merge_transcripts(local: List[Dict], remote: List[Dict]) -> List[Dict]:
    """
    로컬과 원격 transcript 데이터를 merge (중복 제거)
    youtube_link를 기준으로 중복 제거, 로컬 데이터 우선
    """
    # youtube_link를 key로 사용
    merged = {}
    
    # 원격 데이터 먼저 추가
    for item in remote:
        link = item.get("youtube_link")
        if link:
            merged[link] = item
    
    # 로컬 데이터로 덮어쓰기 (로컬 우선)
    for item in local:
        link = item.get("youtube_link")
        if link:
            merged[link] = item
    
    return list(merged.values())


def commit_and_push_transcripts(
    date_folder: str,
    transcript_count: int = 0,
    logger: Optional[PipelineLogger] = None
) -> Dict[str, Any]:
    """
    Transcript 파일을 GitHub에 커밋하고 푸시
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
        transcript_count: 수집된 transcript 수 (커밋 메시지용)
        logger: PipelineLogger 인스턴스 (None이면 새로 생성)
    
    Returns:
        결과 딕셔너리
    """
    # 로거 생성 (없으면 새로 생성)
    if logger is None:
        logger = PipelineLogger(phase="transcript-commit", log_dir=LOG_DIR)
    
    logger.start_stage()
    logger.info(f"📅 날짜 폴더: {date_folder}")
    logger.info(f"🎯 타겟 브랜치: {TARGET_BRANCH}")
    
    # 현재 브랜치 확인
    success, current_branch = run_git_command(["git", "rev-parse", "--abbrev-ref", "HEAD"], logger=logger)
    if not success:
        logger.error(f"현재 브랜치 확인 실패: {current_branch}")
        logger.end_stage()
        logger.save_json_log()
        return {
            "success": False,
            "message": f"현재 브랜치 확인 실패: {current_branch}"
        }
    
    logger.add_stat("current_branch", current_branch)
    
    # 타겟 브랜치가 아니면 경고
    if current_branch != TARGET_BRANCH:
        logger.warning(f"현재 브랜치: {current_branch} (타겟: {TARGET_BRANCH})")
        # 브랜치 전환 시도
        success, msg = run_git_command(["git", "checkout", TARGET_BRANCH], logger=logger)
        if not success:
            logger.error(f"브랜치 전환 실패: {msg}")
            logger.end_stage()
            logger.save_json_log()
            return {
                "success": False,
                "message": f"브랜치 전환 실패: {msg}"
            }
        logger.success(f"브랜치 전환 완료: {TARGET_BRANCH}")
    
    # Transcript 파일 경로
    transcript_file = CRAWLING_DATA_DIR / date_folder / "tzuyang_restaurant_transcripts.json"
    error_file = CRAWLING_DATA_DIR / date_folder / "tzuyang_transcript_errors.json"
    
    logger.info(f"📁 Transcript 파일: {transcript_file}")
    
    # Step 1: 로컬 데이터 백업 (pull 전에)
    local_transcripts: List[Dict] = []
    if transcript_file.exists():
        try:
            with open(transcript_file, 'r', encoding='utf-8') as f:
                local_transcripts = json.load(f)
            logger.info(f"📦 로컬 데이터 백업: {len(local_transcripts)}개")
        except Exception as e:
            logger.warning(f"로컬 데이터 백업 실패: {e}")
    
    # Step 2: 원격 변경사항 pull
    logger.info("📥 원격 변경사항 pull 중...")
    success, msg = run_git_command(["git", "pull", "--rebase", "origin", TARGET_BRANCH], logger=logger)
    if not success:
        logger.warning(f"pull 실패 (새 브랜치일 수 있음): {msg}")
    else:
        logger.success("pull 완료")
    
    # Step 3: 원격 데이터 로드 (pull 후)
    remote_transcripts: List[Dict] = []
    if transcript_file.exists():
        try:
            with open(transcript_file, 'r', encoding='utf-8') as f:
                remote_transcripts = json.load(f)
            logger.info(f"📥 원격 데이터 로드: {len(remote_transcripts)}개")
        except Exception as e:
            logger.warning(f"원격 데이터 로드 실패: {e}")
    
    # Step 4: 로컬 + 원격 데이터 merge (중복 제거)
    merged_transcripts = merge_transcripts(local_transcripts, remote_transcripts)
    logger.info(f"🔀 Merge 완료: 로컬 {len(local_transcripts)}개 + 원격 {len(remote_transcripts)}개 → {len(merged_transcripts)}개")
    
    # Step 5: merge된 데이터 저장
    if merged_transcripts:
        with open(transcript_file, 'w', encoding='utf-8') as f:
            json.dump(merged_transcripts, f, ensure_ascii=False, indent=2)
        logger.success(f"💾 Merge된 데이터 저장 완료: {len(merged_transcripts)}개")
    
    if not transcript_file.exists():
        logger.error(f"Transcript 파일이 없습니다: {transcript_file}")
        logger.end_stage()
        logger.save_json_log()
        return {
            "success": False,
            "message": f"Transcript 파일이 없습니다: {transcript_file}"
        }
    
    # 파일 추가
    files_to_add = [str(transcript_file.relative_to(PROJECT_ROOT))]
    if error_file.exists():
        files_to_add.append(str(error_file.relative_to(PROJECT_ROOT)))
    
    logger.add_stat("files_to_commit", files_to_add)
    
    for file_path in files_to_add:
        success, msg = run_git_command(["git", "add", file_path], logger=logger)
        if not success:
            logger.warning(f"git add 실패: {file_path} - {msg}")
    
    # 변경사항 확인
    success, diff_output = run_git_command(["git", "diff", "--staged", "--name-only"], logger=logger)
    if not diff_output:
        logger.info("변경사항 없음 (이미 커밋됨)")
        logger.add_stat("status", "no_changes")
        logger.end_stage()
        logger.save_json_log()
        return {
            "success": True,
            "message": "변경사항 없음 (이미 커밋됨)"
        }
    
    logger.info(f"📝 변경된 파일: {diff_output}")
    
    # 커밋
    commit_msg = f"📝 Transcript 수집: {date_folder}"
    if transcript_count > 0:
        commit_msg += f" ({transcript_count}개)"
    
    # Git 설정 (커밋용)
    run_git_command(["git", "config", "user.name", "Transcript API"], logger=logger)
    run_git_command(["git", "config", "user.email", "transcript-api@local"], logger=logger)
    
    with logger.timer("git_commit"):
        success, msg = run_git_command(["git", "commit", "-m", commit_msg], logger=logger)
    
    if not success:
        logger.error(f"커밋 실패: {msg}")
        logger.add_stat("status", "commit_failed")
        logger.end_stage()
        logger.save_json_log()
        return {
            "success": False,
            "message": f"커밋 실패: {msg}"
        }
    
    logger.success(f"커밋 완료: {commit_msg}")
    logger.add_stat("commit_message", commit_msg)
    
    # 푸시
    with logger.timer("git_push"):
        success, msg = run_git_command(["git", "push", "origin", TARGET_BRANCH], logger=logger)
    
    if not success:
        logger.error(f"푸시 실패: {msg}")
        logger.add_stat("status", "push_failed")
        logger.end_stage()
        logger.save_json_log()
        return {
            "success": False,
            "message": f"푸시 실패: {msg}. 수동으로 'git push origin {TARGET_BRANCH}' 실행하세요."
        }
    
    logger.success(f"푸시 완료: origin/{TARGET_BRANCH}")
    logger.add_stat("status", "success")
    logger.add_stat("branch", TARGET_BRANCH)
    
    logger.end_stage()
    logger.save_json_log()
    
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
