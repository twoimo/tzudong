#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
🚀 GeminiCLI 음식점 평가 전체 파이프라인 실행 스크립트

이 스크립트는 다음 4단계를 순차적으로 실행합니다:
1. 평가 대상 선정 (evaluation-target-selection.py)
2. 규칙 기반 평가 - RULE (evaluation-rule.py)
3. AI 평가 - LAAJ (Gemini CLI via evaluation.sh)
4. 평가 결과 변환 (transform_evaluation_results.py)

사용법:
    python3 evaluation-pipeline.py

전제조건:
    - Gemini CLI 설치 (gcloud auth 완료)
    - .env 파일 설정 완료 (네이버 API 키 등)
    - Python 패키지 설치: requests, python-dotenv
"""

import subprocess
import sys
import os
from pathlib import Path

# 색상 코드
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_step(step_num: int, title: str):
    """단계 제목 출력"""
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}📍 Step {step_num}: {title}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}\n")

def print_success(message: str):
    """성공 메시지 출력"""
    print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")

def print_error(message: str):
    """에러 메시지 출력"""
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")

def print_info(message: str):
    """정보 메시지 출력"""
    print(f"{Colors.OKBLUE}ℹ️  {message}{Colors.ENDC}")

def print_warning(message: str):
    """경고 메시지 출력"""
    print(f"{Colors.WARNING}⚠️  {message}{Colors.ENDC}")

def count_jsonl_lines(file_path: Path) -> int:
    """JSONL 파일의 라인 수를 카운트"""
    if not file_path.exists():
        return 0
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return sum(1 for _ in f)
    except Exception:
        return 0

def print_statistics(stats: dict):
    """각 단계별 통계 출력"""
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}📊 전체 처리 통계{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}\n")
    
    # Step 1: 평가 대상 선정
    step1 = stats.get('step1', {})
    if step1:
        before = step1.get('before', 0)
        after = step1.get('after', 0)
        processed = after - before
        print(f"{Colors.BOLD}{Colors.OKBLUE}Step 1: 평가 대상 선정{Colors.ENDC}")
        print(f"  입력: {Colors.OKCYAN}전체 크롤링 데이터{Colors.ENDC}")
        print(f"  이미 처리됨: {Colors.WARNING}{before}개{Colors.ENDC}")
        print(f"  새로 처리: {Colors.OKGREEN}{processed}개{Colors.ENDC}")
        print(f"  최종 누적: {Colors.OKCYAN}{after}개{Colors.ENDC}\n")
    
    # Step 2: RULE 평가
    step2 = stats.get('step2', {})
    if step2:
        total_selection = step2.get('input', 0)
        before = step2.get('before', 0)
        after = step2.get('after', 0)
        processed = after - before
        run_input = total_selection - before
        success_rate = (processed / run_input * 100) if run_input > 0 else 0
        
        print(f"{Colors.BOLD}{Colors.OKBLUE}Step 2: RULE 평가{Colors.ENDC}")
        print(f"  전체 대상: {Colors.OKCYAN}{total_selection}개{Colors.ENDC}")
        print(f"  이미 처리됨: {Colors.WARNING}{before}개{Colors.ENDC}")
        print(f"  {Colors.BOLD}이번 실행 입력: {Colors.OKCYAN}{run_input}개{Colors.ENDC}")
        print(f"  새로 처리: {Colors.OKGREEN}{processed}개{Colors.ENDC} ({success_rate:.1f}%)")
        print(f"  최종 누적: {Colors.OKCYAN}{after}개{Colors.ENDC}\n")
    
    # Step 3: LAAJ 평가
    step3 = stats.get('step3', {})
    if step3:
        input_count = step3.get('input', 0)
        before_success = step3.get('before_success', 0)
        before_error = step3.get('before_error', 0)
        after_success = step3.get('after_success', 0)
        after_error = step3.get('after_error', 0)
        
        before_total = before_success + before_error
        new_success = after_success - before_success
        new_error = after_error - before_error
        new_total = new_success + new_error
        
        success_rate = (new_success / new_total * 100) if new_total > 0 else 0
        error_rate = (new_error / new_total * 100) if new_total > 0 else 0
        
        print(f"{Colors.BOLD}{Colors.OKBLUE}Step 3: LAAJ 평가 (Gemini CLI){Colors.ENDC}")
        print(f"  입력: {Colors.OKCYAN}{input_count}개{Colors.ENDC}")
        print(f"  이미 처리됨: {Colors.WARNING}{before_total}개{Colors.ENDC} (성공 {before_success}, 에러 {before_error})")
        print(f"  새로 처리: {Colors.OKGREEN}{new_success}개 성공{Colors.ENDC} ({success_rate:.1f}%), {Colors.FAIL}{new_error}개 에러{Colors.ENDC} ({error_rate:.1f}%)")
        print(f"  최종 누적: 성공 {Colors.OKGREEN}{after_success}개{Colors.ENDC}, 에러 {Colors.FAIL}{after_error}개{Colors.ENDC}\n")
    
    # Step 4: Transform
    step4 = stats.get('step4', {})
    if step4:
        before = step4.get('before', 0)
        after = step4.get('after', 0)
        processed = after - before
        
        print(f"{Colors.BOLD}{Colors.OKBLUE}Step 4: Transform 결과 변환{Colors.ENDC}")
        print(f"  이미 변환됨: {Colors.WARNING}{before}개{Colors.ENDC}")
        print(f"  새로 변환: {Colors.OKGREEN}{processed}개{Colors.ENDC}")
        print(f"  최종 누적: {Colors.OKCYAN}{after}개{Colors.ENDC}\n")
    
    # 전체 성공률
    if step1 and step3:
        total_input = step1.get('after', 0)
        final_success = step3.get('after_success', 0)
        if total_input > 0:
            overall_rate = (final_success / total_input) * 100
            print(f"{Colors.BOLD}{Colors.HEADER}{'─'*80}{Colors.ENDC}")
            print(f"{Colors.BOLD}{Colors.OKGREEN}✅ 전체 성공률: {final_success}/{total_input} ({overall_rate:.1f}%){Colors.ENDC}")
            print(f"{Colors.BOLD}{Colors.HEADER}{'─'*80}{Colors.ENDC}\n")

def run_command(command: list, description: str, cwd: str = None) -> bool:
    """
    명령어를 실행하고 결과를 반환
    
    Args:
        command: 실행할 명령어 리스트
        description: 명령어 설명
        cwd: 실행 디렉토리 (None이면 현재 디렉토리)
    
    Returns:
        bool: 성공 여부
    """
    try:
        print_info(f"{description} 실행 중...")
        print(f"{Colors.OKBLUE}$ {' '.join(command)}{Colors.ENDC}\n")
        
        result = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            capture_output=False  # 실시간 출력
        )
        
        print_success(f"{description} 완료")
        return True
        
    except subprocess.CalledProcessError as e:
        print_error(f"{description} 실패 (exit code: {e.returncode})")
        return False
    except FileNotFoundError:
        print_error(f"명령어를 찾을 수 없습니다: {command[0]}")
        return False
    except Exception as e:
        print_error(f"{description} 중 예외 발생: {str(e)}")
        return False

def check_prerequisites() -> bool:
    """전제 조건 확인"""
    print_step(0, "전제 조건 확인")
    
    # 현재 디렉토리 확인
    current_dir = Path.cwd()
    print_info(f"현재 디렉토리: {current_dir}")
    
    # scripts 디렉토리 확인
    script_dir = Path(__file__).parent
    if script_dir.name != "scripts":
        print_error("이 스크립트는 scripts 폴더 안에 있어야 합니다.")
        return False
    
    # 필수 파일 확인
    required_files = [
        "evaluation-target-selection.py",
        "evaluation-rule.py",
        "evaluation.sh",
        "transform_evaluation_results.py"
    ]
    
    for file in required_files:
        file_path = script_dir / file
        if not file_path.exists():
            print_error(f"필수 파일을 찾을 수 없습니다: {file}")
            return False
    
    print_success("필수 파일 확인 완료")
    
    # Gemini CLI 설치 확인
    try:
        result = subprocess.run(
            ["which", "gemini"],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode != 0:
            print_warning("Gemini CLI가 설치되지 않았습니다.")
            print_info("설치 방법: npm install -g @google/generative-ai-cli")
            print_info("또는: gem install gemini-cli")
            # 경고만 출력하고 계속 진행 (LAAJ 단계에서 다시 확인됨)
    except Exception:
        pass
    
    print_success("모든 전제 조건 확인 완료\n")
    return True

def step1_target_selection(script_dir: Path) -> bool:
    """Step 1: 평가 대상 선정"""
    print_step(1, "평가 대상 선정 (evaluation-target-selection.py)")
    
    return run_command(
        ["python3", "evaluation-target-selection.py"],
        "평가 대상 선정",
        cwd=str(script_dir)
    )

def step2_rule_evaluation(script_dir: Path) -> bool:
    """Step 2: 규칙 기반 평가"""
    print_step(2, "규칙 기반 평가 - RULE (evaluation-rule.py)")
    
    return run_command(
        ["python3", "evaluation-rule.py"],
        "규칙 기반 평가",
        cwd=str(script_dir)
    )

def step3_ai_evaluation(script_dir: Path) -> bool:
    """Step 3: AI 평가 (Gemini CLI)"""
    print_step(3, "AI 평가 - LAAJ (Gemini CLI)")
    
    print_info("Gemini CLI로 AI 평가를 실행합니다.")
    print_warning("이 단계는 시간이 오래 걸릴 수 있습니다. (수분~수십분)")
    print()
    
    evaluation_script = script_dir / "evaluation.sh"
    
    # 실행 권한 부여
    os.chmod(evaluation_script, 0o755)
    
    return run_command(
        ["zsh", str(evaluation_script)],
        "AI 평가 (Gemini CLI)",
        cwd=str(script_dir)
    )

def step4_transform_results(script_dir: Path) -> bool:
    """Step 4: Transform 평가 결과"""
    print_step(4, "Transform 평가 결과 변환")
    
    print_info("평가 결과를 youtube_link-음식점명 기준으로 변환합니다.")
    print_info("중복된 레코드는 자동으로 스킵됩니다.\n")
    
    return run_command(
        ["python3", "transform_evaluation_results.py"],
        "Transform 평가 결과",
        cwd=str(script_dir)
    )

def main():
    """메인 실행 함수"""
    print(f"\n{Colors.BOLD}{Colors.HEADER}")
    print("🚀 GeminiCLI 음식점 평가 전체 파이프라인")
    print("=" * 80)
    print(f"{Colors.ENDC}\n")
    
    # 전제 조건 확인
    if not check_prerequisites():
        print_error("전제 조건을 만족하지 않아 종료합니다.")
        sys.exit(1)
    
    # 디렉토리 설정
    current_dir = Path.cwd()
    if current_dir.name == "scripts":
        script_dir = current_dir
        project_root = current_dir.parent
    else:
        script_dir = current_dir / "scripts"
        project_root = current_dir
    
    # 통계를 위한 딕셔너리
    stats = {}
    
    # 파일 경로 (Perplexity와 동일한 구조)
    selection_file = project_root / 'tzuyang_restaurant_evaluation_selection.jsonl'
    rule_results_file = project_root / 'tzuyang_restaurant_evaluation_rule_results.jsonl'
    laaj_results_file = project_root / 'tzuyang_restaurant_evaluation_results.jsonl'
    laaj_errors_file = project_root / 'tzuyang_restaurant_evaluation_errors.jsonl'
    transform_file = project_root / 'tzuyang_restaurant_transforms.jsonl'
    
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}평가 파이프라인 시작{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}\n")
    
    # Step 1: 평가 대상 선정
    step1_before = count_jsonl_lines(selection_file)
    if not step1_target_selection(script_dir):
        print_error("\nStep 1 실패로 인해 파이프라인을 중단합니다.")
        sys.exit(1)
    step1_after = count_jsonl_lines(selection_file)
    stats['step1'] = {'before': step1_before, 'after': step1_after}
    
    # Step 2: 규칙 기반 평가
    step2_before = count_jsonl_lines(rule_results_file)
    step2_input = step1_after
    if not step2_rule_evaluation(script_dir):
        print_error("\nStep 2 실패로 인해 파이프라인을 중단합니다.")
        print_info("규칙 평가 중 일부 실패는 정상일 수 있습니다. (해외 주소, API 제한 등)")
        sys.exit(1)
    step2_after = count_jsonl_lines(rule_results_file)
    stats['step2'] = {'input': step2_input, 'before': step2_before, 'after': step2_after}
    
    # Step 3: AI 평가
    step3_before_success = count_jsonl_lines(laaj_results_file)
    step3_before_error = count_jsonl_lines(laaj_errors_file)
    step3_input = step2_after
    if not step3_ai_evaluation(script_dir):
        print_error("\nStep 3 실패로 인해 파이프라인을 중단합니다.")
        sys.exit(1)
    step3_after_success = count_jsonl_lines(laaj_results_file)
    step3_after_error = count_jsonl_lines(laaj_errors_file)
    stats['step3'] = {
        'input': step3_input,
        'before_success': step3_before_success,
        'before_error': step3_before_error,
        'after_success': step3_after_success,
        'after_error': step3_after_error
    }
    
    # Step 4: Transform 평가 결과
    step4_before = count_jsonl_lines(transform_file)
    if not step4_transform_results(script_dir):
        print_warning("\nStep 4 Transform 실패했지만, 평가는 완료되었습니다.")
        print_info("Transform은 나중에 수동으로 실행할 수 있습니다: python3 scripts/transform_evaluation_results.py")
    else:
        step4_after = count_jsonl_lines(transform_file)
        stats['step4'] = {'before': step4_before, 'after': step4_after}
    
    # 통계 출력
    print_statistics(stats)
    
    # 완료
    print(f"\n{Colors.BOLD}{Colors.OKGREEN}")
    print("=" * 80)
    print("🎉 전체 평가 파이프라인이 성공적으로 완료되었습니다!")
    print("=" * 80)
    print(f"{Colors.ENDC}\n")
    
    print_info("출력 파일:")
    print(f"  📄 {project_root / 'tzuyang_restaurant_evaluation_selection.jsonl'}")
    print(f"  📄 {project_root / 'tzuyang_restaurant_evaluation_rule_results.jsonl'}")
    print(f"  📄 {project_root / 'tzuyang_restaurant_evaluation_results.jsonl'} (성공)")
    print(f"  📄 {project_root / 'tzuyang_restaurant_evaluation_errors.jsonl'} (실패)")
    print(f"  📄 {project_root / 'tzuyang_restaurant_transforms.jsonl'} (변환 결과)")
    print()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{Colors.WARNING}⚠️  사용자가 파이프라인을 중단했습니다.{Colors.ENDC}")
        sys.exit(130)
    except Exception as e:
        print(f"\n{Colors.FAIL}❌ 예상치 못한 오류 발생: {str(e)}{Colors.ENDC}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
