#!/usr/bin/env python3
"""
🍜 쯔양 레스토랑 데이터 전체 파이프라인

전체 프로세스를 자동으로 실행합니다:
1. 크롤링 파이프라인 (URL 수집 → Perplexity 크롤링 → 메타데이터 추가)
2. 평가 파이프라인 (평가 대상 선정 → Rule 평가 → LAAJ 평가)
3. LAAJ 에러 재평가
4. 데이터 변환 (Transform)
5. Supabase DB 삽입

사용법:
    python restaurant-pipeline.py
    
전제조건:
    - Python 3.8+
    - Node.js 16+
    - npm install 완료 (perplexity-restaurant-crawling, perplexity-restaurant-evaluation)
    - TypeScript 빌드 완료 (각 폴더에서 npm run build)
    - .env 파일 설정 완료 (API 키 등)
"""

import sys
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Tuple, List


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
    
    # npm 확인
    try:
        result = subprocess.run(
            ["npm", "--version"],
            capture_output=True,
            text=True,
            check=True
        )
        print_success(f"npm 버전: {result.stdout.strip()}")
    except (subprocess.CalledProcessError, FileNotFoundError):
        issues.append("npm이 설치되지 않았습니다")
    
    print()
    
    if issues:
        print_error("필수 조건이 충족되지 않았습니다:")
        for issue in issues:
            print(f"  - {issue}")
        return False
    
    print_success("모든 필수 조건이 충족되었습니다!")
    return True


def phase_1_crawling(backend_dir: Path) -> bool:
    """Phase 1: 크롤링 파이프라인 실행"""
    print_phase(1, 5, "데이터 크롤링")
    
    crawling_dir = backend_dir / "perplexity-restaurant-crawling"
    crawling_script = crawling_dir / "src" / "crawling-pipeline.py"
    
    if not crawling_script.exists():
        print_error(f"크롤링 스크립트를 찾을 수 없습니다: {crawling_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(crawling_script)],
        "크롤링 파이프라인",
        cwd=crawling_dir / "src"
    )
    
    return success


def phase_2_evaluation(backend_dir: Path) -> bool:
    """Phase 2: 평가 파이프라인 실행"""
    print_phase(2, 5, "데이터 평가")
    
    evaluation_dir = backend_dir / "perplexity-restaurant-evaluation"
    evaluation_script = evaluation_dir / "src" / "evaluation-pipeline.py"
    
    if not evaluation_script.exists():
        print_error(f"평가 스크립트를 찾을 수 없습니다: {evaluation_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(evaluation_script)],
        "평가 파이프라인",
        cwd=evaluation_dir / "src"
    )
    
    return success


def phase_3_retry_errors(backend_dir: Path) -> bool:
    """Phase 3: 에러 재평가"""
    print_phase(3, 5, "LAAJ 에러 재평가")
    
    evaluation_dir = backend_dir / "perplexity-restaurant-evaluation"
    
    # TypeScript 빌드 확인
    dist_dir = evaluation_dir / "dist"
    if not dist_dir.exists():
        print_warning("TypeScript가 빌드되지 않았습니다. 빌드를 시도합니다...")
        success, _ = run_command(
            ["npm", "run", "build"],
            "TypeScript 빌드",
            cwd=evaluation_dir
        )
        if not success:
            return False
    
    # index_retry_for_errors.js 실행
    retry_script = dist_dir / "index_retry_for_errors.js"
    if not retry_script.exists():
        print_error(f"에러 재평가 스크립트를 찾을 수 없습니다: {retry_script}")
        return False
    
    success, _ = run_command(
        ["node", str(retry_script)],
        "에러 재평가",
        cwd=evaluation_dir
    )
    
    return success


def phase_4_transform(backend_dir: Path) -> bool:
    """Phase 4: 데이터 변환"""
    print_phase(4, 5, "데이터 변환 (Transform)")
    
    evaluation_dir = backend_dir / "perplexity-restaurant-evaluation"
    transform_script = evaluation_dir / "src" / "transform_evaluation_results.py"
    
    if not transform_script.exists():
        print_error(f"Transform 스크립트를 찾을 수 없습니다: {transform_script}")
        return False
    
    success, _ = run_command(
        [sys.executable, str(transform_script)],
        "데이터 변환",
        cwd=evaluation_dir / "src"
    )
    
    return success


def phase_5_insert_db(backend_dir: Path) -> bool:
    """Phase 5: Supabase DB 삽입"""
    print_phase(5, 5, "Supabase DB 삽입")
    
    evaluation_dir = backend_dir / "perplexity-restaurant-evaluation"
    
    # TypeScript 빌드 확인
    dist_dir = evaluation_dir / "dist"
    insert_script = dist_dir / "insert_to_supabase.js"
    
    if not insert_script.exists():
        print_error(f"DB 삽입 스크립트를 찾을 수 없습니다: {insert_script}")
        print_info("npm run build를 먼저 실행해주세요.")
        return False
    
    success, _ = run_command(
        ["node", str(insert_script)],
        "DB 삽입",
        cwd=evaluation_dir
    )
    
    return success


def print_summary(phases: List[Tuple[str, bool]], start_time: datetime):
    """최종 결과 요약"""
    end_time = datetime.now()
    duration = end_time - start_time
    
    print_header("📊 파이프라인 실행 결과")
    
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏰ 종료 시간: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏱️  소요 시간: {duration}\n")
    
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
    
    if success_count == len(phases):
        print_success("🎉 모든 단계가 성공적으로 완료되었습니다!")
        print()
        print_info("생성된 주요 파일:")
        print("  1. tzuyang_youtubeVideo_urls.txt - YouTube URL 목록")
        print("  2. tzuyang_restaurant_results_with_meta.jsonl - 크롤링 데이터 + 메타데이터")
        print("  3. tzuyang_restaurant_evaluation_results.jsonl - LAAJ 평가 결과")
        print("  4. tzuyang_restaurant_transforms.jsonl - 변환된 최종 데이터")
        print("  5. Supabase DB - 데이터베이스에 삽입 완료")
    else:
        print_error("⚠️  일부 단계가 실패했습니다. 위의 로그를 확인하세요.")
    
    print()
    print("=" * 90)


def main():
    """메인 실행 함수"""
    start_time = datetime.now()
    
    print_header("🍜 쯔양 레스토랑 데이터 전체 파이프라인")
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    
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
    print_info("Phase 1/5: 데이터 크롤링을 시작합니다...")
    success = phase_1_crawling(backend_dir)
    phases.append(("Phase 1: 데이터 크롤링", success))
    if not success:
        print_error("크롤링 단계 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time)
        sys.exit(1)
    
    # Phase 2: 평가
    print_info("Phase 2/5: 데이터 평가를 시작합니다...")
    success = phase_2_evaluation(backend_dir)
    phases.append(("Phase 2: 데이터 평가", success))
    if not success:
        print_error("평가 단계 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time)
        sys.exit(1)
    
    # Phase 3: 에러 재평가
    print_info("Phase 3/5: 에러 재평가를 시작합니다...")
    success = phase_3_retry_errors(backend_dir)
    phases.append(("Phase 3: LAAJ 에러 재평가", success))
    if not success:
        print_warning("에러 재평가 실패. 계속 진행합니다...")
        # 에러 재평가는 실패해도 계속 진행
    
    # Phase 4: Transform
    print_info("Phase 4/5: 데이터 변환을 시작합니다...")
    success = phase_4_transform(backend_dir)
    phases.append(("Phase 4: 데이터 변환", success))
    if not success:
        print_error("데이터 변환 실패. 파이프라인을 중단합니다.")
        print_summary(phases, start_time)
        sys.exit(1)
    
    # Phase 5: DB 삽입
    print_info("Phase 5/5: DB 삽입을 시작합니다...")
    success = phase_5_insert_db(backend_dir)
    phases.append(("Phase 5: Supabase DB 삽입", success))
    if not success:
        print_error("DB 삽입 실패.")
        print_summary(phases, start_time)
        sys.exit(1)
    
    # 최종 결과 요약
    print_summary(phases, start_time)


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
