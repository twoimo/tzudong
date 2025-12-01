#!/usr/bin/env python3
"""
🍜 GeminiCLI 레스토랑 데이터 전체 파이프라인

Gemini CLI 기반으로 전체 프로세스를 자동 실행합니다:
1. 크롤링 파이프라인 (URL 수집 → Gemini 크롤링 → 메타데이터 추가)
2. 크롤링 에러 재처리 (에러 파일이 빌 때까지 반복)
3. 평가 파이프라인 (평가 대상 선정 → Rule 평가 → LAAJ 평가)
4. LAAJ 에러 재평가 (에러 파일이 빌 때까지 반복)
5. 데이터 변환 (Transform)
6. Supabase DB 삽입

GitHub Actions에서 자동화 가능하도록 설계되었습니다.

사용법:
    python geminiCLI-restaurant-pipeline.py
    
전제조건:
    - Python 3.8+
    - Node.js 20+ (Gemini CLI 설치 및 tsx 실행용)
    - Gemini CLI 설치 및 Google 계정 인증 완료
    - .env 파일 설정 완료 (API 키 등)
"""

import sys
import subprocess
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))
from typing import Tuple, List, Optional

# 최대 재처리 시도 횟수 (무한 루프 방지)
MAX_RETRY_ATTEMPTS = 5


class Colors:
    """터미널 색상 코드"""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(title: str):
    """메인 헤더 출력"""
    print("\n" + "=" * 90)
    print(f"  {Colors.BOLD}{Colors.HEADER}{title}{Colors.ENDC}")
    print("=" * 90 + "\n")


def print_phase(phase_num: int, total: int, title: str):
    """Phase 헤더 출력"""
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}{'▶' * 45}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  PHASE {phase_num}/{total}: {title}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}{'▶' * 45}{Colors.ENDC}\n")


def print_success(message: str):
    """성공 메시지"""
    print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")


def print_error(message: str):
    """에러 메시지"""
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")


def print_warning(message: str):
    """경고 메시지"""
    print(f"{Colors.WARNING}⚠️  {message}{Colors.ENDC}")


def print_info(message: str):
    """정보 메시지"""
    print(f"{Colors.OKBLUE}ℹ️  {message}{Colors.ENDC}")


def run_command(
    command: List[str],
    description: str,
    cwd: Path = None,
    check: bool = True
) -> Tuple[bool, int]:
    """
    명령어 실행
    
    Args:
        command: 실행할 명령어 리스트
        description: 작업 설명
        cwd: 작업 디렉토리
        check: 실패 시 예외 발생 여부
    
    Returns:
        (성공여부, 종료코드)
    """
    print(f"🚀 실행: {' '.join(command)}")
    if cwd:
        print(f"📂 작업 디렉토리: {cwd}")
    print()
    
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=check,
            capture_output=False,
            text=True
        )
        print()
        print_success(f"{description} 완료!")
        return True, 0
        
    except subprocess.CalledProcessError as e:
        print()
        print_error(f"{description} 실패! (종료 코드: {e.returncode})")
        return False, e.returncode
        
    except FileNotFoundError:
        print()
        print_error(f"명령어를 찾을 수 없습니다: {command[0]}")
        return False, -1
        
    except KeyboardInterrupt:
        print()
        print_warning("사용자에 의해 중단되었습니다.")
        return False, -2


def check_prerequisites() -> bool:
    """필수 조건 확인"""
    print_info("필수 조건 확인 중...")
    print()
    
    issues = []
    
    # Python 버전 확인
    if sys.version_info < (3, 8):
        issues.append(f"Python 3.8+ 필요 (현재: {sys.version})")
    else:
        print_success(f"Python 버전: {sys.version_info.major}.{sys.version_info.minor}")
    
    # Node.js 확인
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            check=True
        )
        print_success(f"Node.js 버전: {result.stdout.strip()}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        issues.append("Node.js가 설치되지 않았습니다")
    
    # Gemini CLI 확인
    try:
        result = subprocess.run(
            ["which", "gemini"],
            capture_output=True,
            text=True,
            check=True
        )
        print_success(f"Gemini CLI: {result.stdout.strip()}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print_warning("Gemini CLI가 설치되지 않았습니다.")
        print_info("설치 방법: npm install -g @google/generative-ai-cli")
        # 경고만 출력하고 계속 진행 (각 단계에서 다시 확인됨)
    
    # jq 확인 (shell 스크립트에서 사용)
    try:
        result = subprocess.run(
            ["which", "jq"],
            capture_output=True,
            text=True,
            check=True
        )
        print_success(f"jq: {result.stdout.strip()}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        issues.append("jq가 설치되지 않았습니다 (brew install jq)")
    
    print()
    
    if issues:
        print_error("필수 조건이 충족되지 않았습니다:")
        for issue in issues:
            print(f"  - {issue}")
        return False
    
    print_success("모든 필수 조건이 충족되었습니다!")
    return True


def count_jsonl_lines(file_path: Path) -> int:
    """JSONL 파일의 라인 수를 카운트"""
    if not file_path.exists():
        return 0
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def get_today_folder() -> str:
    """오늘 날짜 폴더명 반환 (PIPELINE_DATE 환경변수 우선)"""
    pipeline_date = os.environ.get('PIPELINE_DATE')
    if pipeline_date:
        return pipeline_date
    return datetime.now(KST).strftime('%y-%m-%d')


def get_date_folder_path(base_dir: Path, folder_name: str) -> Path:
    """날짜 폴더 경로 반환 (없으면 생성)"""
    folder_path = base_dir / "data" / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)
    return folder_path


def phase_1_crawling(backend_dir: Path) -> bool:
    """Phase 1: 크롤링 파이프라인 실행"""
    print_phase(1, 6, "데이터 크롤링 (Gemini CLI)")
    
    crawling_dir = backend_dir / "geminiCLI-restaurant-crawling"
    crawling_script = crawling_dir / "scripts" / "crawling-pipeline.py"
    
    if not crawling_script.exists():
        print_error(f"크롤링 스크립트를 찾을 수 없습니다: {crawling_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(crawling_script)],
        "크롤링 파이프라인",
        cwd=crawling_dir / "scripts"
    )
    
    return success


def phase_1b_crawling_retry(backend_dir: Path) -> bool:
    """Phase 1b: 크롤링 에러 재처리 (에러 파일이 빌 때까지 반복)"""
    print_phase(1, 6, "크롤링 에러 재처리")
    
    crawling_dir = backend_dir / "geminiCLI-restaurant-crawling"
    retry_script = crawling_dir / "scripts" / "retry_crawling_errors.sh"
    today_folder = get_today_folder()
    error_file = crawling_dir / "data" / today_folder / "tzuyang_crawling_errors.jsonl"
    
    # 에러 파일이 없거나 비어있으면 스킵
    if not error_file.exists() or count_jsonl_lines(error_file) == 0:
        print_info("재처리할 크롤링 에러가 없습니다.")
        print_success("Phase 1b 스킵")
        return True
    
    if not retry_script.exists():
        print_warning(f"크롤링 에러 재처리 스크립트를 찾을 수 없습니다: {retry_script}")
        return True  # 선택적 단계이므로 계속 진행
    
    # 실행 권한 부여
    os.chmod(retry_script, 0o755)
    
    attempt = 0
    while attempt < MAX_RETRY_ATTEMPTS:
        attempt += 1
        error_count = count_jsonl_lines(error_file)
        
        if error_count == 0:
            print_success(f"모든 크롤링 에러 처리 완료! (시도 {attempt-1}회)")
            break
        
        print_info(f"재처리 시도 {attempt}/{MAX_RETRY_ATTEMPTS} (남은 에러: {error_count}개)")
        
        success, _ = run_command(
            ["bash", str(retry_script)],
            f"크롤링 에러 재처리 (시도 {attempt})",
            cwd=crawling_dir / "scripts",
            check=False
        )
        
        if not success:
            print_warning(f"재처리 시도 {attempt} 실패, 계속 진행...")
    
    # 최종 에러 카운트 확인
    remaining_errors = count_jsonl_lines(error_file)
    if remaining_errors > 0:
        print_warning(f"⚠️ {remaining_errors}개의 크롤링 에러가 남아있습니다.")
    
    return True


def phase_1c_add_metadata(backend_dir: Path) -> bool:
    """Phase 1c: 크롤링 결과에 YouTube 메타데이터 추가"""
    print_info("YouTube 메타데이터 추가 중...")
    
    crawling_dir = backend_dir / "geminiCLI-restaurant-crawling"
    today_folder = get_today_folder()
    data_path = crawling_dir / "data" / today_folder
    
    results_file = data_path / "tzuyang_restaurant_results.jsonl"
    meta_file = data_path / "tzuyang_restaurant_results_with_meta.jsonl"
    meta_script = crawling_dir / "scripts" / "api-youtube-meta.py"
    
    if not results_file.exists() or count_jsonl_lines(results_file) == 0:
        print_warning("크롤링 결과가 없어 메타데이터 추가를 스킵합니다.")
        return True
    
    if not meta_script.exists():
        print_warning(f"메타데이터 스크립트를 찾을 수 없습니다: {meta_script}")
        return True
    
    success, _ = run_command(
        [sys.executable, str(meta_script), str(results_file), str(meta_file)],
        "YouTube 메타데이터 추가",
        cwd=crawling_dir / "scripts"
    )
    
    if success:
        meta_count = count_jsonl_lines(meta_file)
        print_success(f"메타데이터 추가 완료: {meta_count}개")
    
    return success


def phase_2_evaluation(backend_dir: Path) -> bool:
    """Phase 2: 평가 파이프라인 실행"""
    print_phase(2, 6, "데이터 평가 (Gemini CLI)")
    
    evaluation_dir = backend_dir / "geminiCLI-restaurant-evaluation"
    evaluation_script = evaluation_dir / "scripts" / "evaluation-pipeline.py"
    
    if not evaluation_script.exists():
        print_error(f"평가 스크립트를 찾을 수 없습니다: {evaluation_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(evaluation_script)],
        "평가 파이프라인",
        cwd=evaluation_dir / "scripts"
    )
    
    return success


def phase_3_retry_errors(backend_dir: Path) -> bool:
    """Phase 3: LAAJ 에러 재평가 (에러 파일이 빌 때까지 반복)"""
    print_phase(3, 6, "LAAJ 에러 재평가")
    
    evaluation_dir = backend_dir / "geminiCLI-restaurant-evaluation"
    retry_script = evaluation_dir / "scripts" / "retry_errors.sh"
    today_folder = get_today_folder()
    error_file = evaluation_dir / "data" / today_folder / "tzuyang_restaurant_evaluation_errors.jsonl"
    
    # 에러 파일이 없거나 비어있으면 스킵
    if not error_file.exists() or count_jsonl_lines(error_file) == 0:
        print_info("재평가할 에러가 없습니다.")
        print_success("Phase 3 스킵")
        return True
    
    if not retry_script.exists():
        print_warning(f"에러 재평가 스크립트를 찾을 수 없습니다: {retry_script}")
        return True  # 선택적 단계이므로 계속 진행
    
    # 실행 권한 부여
    os.chmod(retry_script, 0o755)
    
    attempt = 0
    while attempt < MAX_RETRY_ATTEMPTS:
        attempt += 1
        error_count = count_jsonl_lines(error_file)
        
        if error_count == 0:
            print_success(f"모든 LAAJ 에러 처리 완료! (시도 {attempt-1}회)")
            break
        
        print_info(f"재평가 시도 {attempt}/{MAX_RETRY_ATTEMPTS} (남은 에러: {error_count}개)")
        
        success, _ = run_command(
            ["zsh", str(retry_script)],
            f"에러 재평가 (시도 {attempt})",
            cwd=evaluation_dir / "scripts",
            check=False
        )
        
        if not success:
            print_warning(f"재평가 시도 {attempt} 실패, 계속 진행...")
    
    # 최종 에러 카운트 확인
    remaining_errors = count_jsonl_lines(error_file)
    if remaining_errors > 0:
        print_warning(f"⚠️ {remaining_errors}개의 LAAJ 에러가 남아있습니다.")
    
    return True


def phase_4_transform(backend_dir: Path) -> bool:
    """Phase 4: 데이터 변환"""
    print_phase(4, 6, "데이터 변환 (Transform)")
    
    evaluation_dir = backend_dir / "geminiCLI-restaurant-evaluation"
    transform_script = evaluation_dir / "scripts" / "transform_evaluation_results.py"
    
    if not transform_script.exists():
        print_error(f"Transform 스크립트를 찾을 수 없습니다: {transform_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(transform_script)],
        "데이터 변환",
        cwd=evaluation_dir / "scripts"
    )
    
    return success


def phase_5_insert_db(backend_dir: Path) -> bool:
    """Phase 5: Supabase DB 삽입"""
    print_phase(5, 6, "Supabase DB 삽입")
    
    evaluation_dir = backend_dir / "geminiCLI-restaurant-evaluation"
    insert_script = evaluation_dir / "scripts" / "insert_to_supabase.ts"
    
    if not insert_script.exists():
        print_warning(f"DB 삽입 스크립트를 찾을 수 없습니다: {insert_script}")
        print_info("수동 실행 필요: npx tsx scripts/insert_to_supabase.ts")
        return True  # 선택적 단계이므로 계속 진행
    
    # npx tsx 사용
    try:
        success, _ = run_command(
            ["npx", "tsx", str(insert_script)],
            "DB 삽입",
            cwd=evaluation_dir
        )
        return success
    except Exception as e:
        print_warning(f"DB 삽입 실패: {e}")
        print_info(f"수동 실행 필요: cd {evaluation_dir} && npx tsx scripts/insert_to_supabase.ts")
        return True  # 선택적 단계이므로 계속 진행


def print_summary(phases: List[Tuple[str, bool]], start_time: datetime, backend_dir: Path):
    """최종 결과 요약"""
    end_time = datetime.now(KST)
    duration = end_time - start_time
    today_folder = get_today_folder()
    
    print_header("📊 파이프라인 실행 결과")
    
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏰ 종료 시간: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏱️  소요 시간: {duration}")
    print(f"📅 날짜 폴더: {today_folder}\n")
    
    print("=" * 90)
    print(f"{'Phase':<50} {'상태':>10}")
    print("=" * 90)
    
    success_count = 0
    for phase_name, success in phases:
        status = f"{Colors.OKGREEN}✅ 성공{Colors.ENDC}" if success else f"{Colors.FAIL}❌ 실패{Colors.ENDC}"
        print(f"{phase_name:<50} {status}")
        if success:
            success_count += 1
    
    print("=" * 90)
    print(f"\n완료된 Phase: {success_count}/{len(phases)}\n")
    
    # 결과 파일 통계 (날짜별 폴더)
    crawling_dir = backend_dir / "geminiCLI-restaurant-crawling"
    evaluation_dir = backend_dir / "geminiCLI-restaurant-evaluation"
    
    crawling_data_path = crawling_dir / "data" / today_folder
    evaluation_data_path = evaluation_dir / "data" / today_folder
    
    crawling_results = crawling_data_path / "tzuyang_restaurant_results.jsonl"
    crawling_meta = crawling_data_path / "tzuyang_restaurant_results_with_meta.jsonl"
    crawling_errors = crawling_data_path / "tzuyang_crawling_errors.jsonl"
    eval_results = evaluation_data_path / "tzuyang_restaurant_evaluation_results.jsonl"
    eval_errors = evaluation_data_path / "tzuyang_restaurant_evaluation_errors.jsonl"
    transforms = evaluation_data_path / "tzuyang_restaurant_transforms.jsonl"
    
    print_info("📊 결과 파일 통계:")
    if crawling_results.exists():
        print(f"  크롤링 결과: {count_jsonl_lines(crawling_results)}개")
    if crawling_meta.exists():
        print(f"  크롤링+메타: {count_jsonl_lines(crawling_meta)}개")
    if crawling_errors.exists():
        error_count = count_jsonl_lines(crawling_errors)
        if error_count > 0:
            print(f"  크롤링 에러: {error_count}개 ⚠️")
    if eval_results.exists():
        print(f"  평가 성공: {count_jsonl_lines(eval_results)}개")
    if eval_errors.exists():
        error_count = count_jsonl_lines(eval_errors)
        if error_count > 0:
            print(f"  평가 에러: {error_count}개 ⚠️")
    if transforms.exists():
        print(f"  Transform: {count_jsonl_lines(transforms)}개")
    
    print()
    
    if success_count == len(phases):
        print_success("🎉 모든 단계가 성공적으로 완료되었습니다!")
        print()
        print_info("생성된 주요 파일:")
        print(f"  1. {crawling_data_path}/tzuyang_restaurant_results_with_meta.jsonl")
        print(f"  2. {evaluation_data_path}/tzuyang_restaurant_evaluation_results.jsonl")
        print(f"  3. {evaluation_data_path}/tzuyang_restaurant_transforms.jsonl")
    else:
        print_error("⚠️  일부 단계가 실패했습니다. 위의 로그를 확인하세요.")
    
    print()
    print("=" * 90)


def main():
    """메인 실행 함수"""
    start_time = datetime.now(KST)
    today_folder = get_today_folder()
    
    print_header("🍜 GeminiCLI 레스토랑 데이터 전체 파이프라인")
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📅 날짜 폴더: {today_folder}\n")
    
    # 경로 설정
    backend_dir = Path(__file__).parent.resolve()
    print_info(f"Backend 디렉토리: {backend_dir}\n")
    
    # 필수 조건 확인
    if not check_prerequisites():
        print_error("필수 조건을 충족한 후 다시 실행해주세요.")
        sys.exit(1)
    
    # 파이프라인 단계 정의
    phases = []
    
    # Phase 1: 크롤링
    print_info("Phase 1/6: 데이터 크롤링을 시작합니다...")
    success = phase_1_crawling(backend_dir)
    phases.append(("Phase 1: 데이터 크롤링 (Gemini CLI)", success))
    if not success:
        print_error("크롤링 단계 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time, backend_dir)
        sys.exit(1)
    
    # Phase 1b: 크롤링 에러 재처리
    print_info("Phase 1b: 크롤링 에러 재처리를 시작합니다...")
    success = phase_1b_crawling_retry(backend_dir)
    phases.append(("Phase 1b: 크롤링 에러 재처리", success))
    # 에러 재처리는 실패해도 계속 진행
    
    # Phase 1c: 메타데이터 추가
    print_info("Phase 1c: YouTube 메타데이터를 추가합니다...")
    success = phase_1c_add_metadata(backend_dir)
    phases.append(("Phase 1c: YouTube 메타데이터 추가", success))
    # 메타데이터 추가는 실패해도 계속 진행
    
    # Phase 2: 평가
    print_info("Phase 2/6: 데이터 평가를 시작합니다...")
    success = phase_2_evaluation(backend_dir)
    phases.append(("Phase 2: 데이터 평가 (Gemini CLI)", success))
    if not success:
        print_error("평가 단계 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time, backend_dir)
        sys.exit(1)
    
    # Phase 3: LAAJ 에러 재평가
    print_info("Phase 3/6: LAAJ 에러 재평가를 시작합니다...")
    success = phase_3_retry_errors(backend_dir)
    phases.append(("Phase 3: LAAJ 에러 재평가", success))
    if not success:
        print_warning("에러 재평가 실패. 계속 진행합니다...")
        # 에러 재평가는 실패해도 계속 진행
    
    # Phase 4: Transform
    print_info("Phase 4/6: 데이터 변환을 시작합니다...")
    success = phase_4_transform(backend_dir)
    phases.append(("Phase 4: 데이터 변환", success))
    if not success:
        print_error("데이터 변환 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time, backend_dir)
        sys.exit(1)
    
    # Phase 5: DB 삽입
    print_info("Phase 5/6: DB 삽입을 시작합니다...")
    success = phase_5_insert_db(backend_dir)
    phases.append(("Phase 5: Supabase DB 삽입", success))
    if not success:
        print_warning("DB 삽입 실패.")
        # DB 삽입은 실패해도 요약 출력
    
    # 최종 결과 요약
    print_summary(phases, start_time, backend_dir)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("사용자에 의해 중단되었습니다.")
        sys.exit(1)
    except Exception as e:
        print()
        print_error(f"예상치 못한 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
