#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
🚀 음식점 평가 전체 파이프라인 실행 스크립트

이 스크립트는 다음 3단계를 순차적으로 실행합니다:
1. 평가 대상 선정 (evaluation-target-selection.py)
2. 규칙 기반 평가 - RULE (evaluation-rule.py)
3. AI 평가 - LAAJ (TypeScript via Node.js)

사용법:
    python3 evaluation_pipeline.py

전제 조건:
    - npm install 완료
    - npm run build 실행 완료 (TypeScript → JavaScript 컴파일)
    - .env 파일 설정 완료 (API 키 등)
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
    
    # src 디렉토리 확인
    src_dir = current_dir / "src"
    if not src_dir.exists():
        # 만약 이미 src 안에 있다면
        if current_dir.name == "src":
            src_dir = current_dir
        else:
            print_error("src 디렉토리를 찾을 수 없습니다.")
            print_info("프로젝트 루트 디렉토리에서 실행해주세요.")
            return False
    
    # 필수 파일 확인
    required_files = [
        "evaluation-target-selection.py",
        "evaluation-rule.py",
    ]
    
    for file in required_files:
        file_path = src_dir / file
        if not file_path.exists():
            print_error(f"필수 파일을 찾을 수 없습니다: {file}")
            return False
    
    print_success("필수 파일 확인 완료")
    
    # dist/index.js 확인 (TypeScript 빌드)
    if current_dir.name == "src":
        dist_dir = current_dir.parent / "dist"
    else:
        dist_dir = current_dir / "dist"
    
    index_js = dist_dir / "index.js"
    if not index_js.exists():
        print_warning("TypeScript가 빌드되지 않았습니다.")
        print_info("npm run build를 먼저 실행해주세요.")
        
        # 빌드 시도
        if current_dir.name == "src":
            build_dir = current_dir.parent
        else:
            build_dir = current_dir
            
        print_info("자동으로 빌드를 시도합니다...")
        if not run_command(["npm", "run", "build"], "TypeScript 빌드", cwd=str(build_dir)):
            print_error("빌드 실패. npm run build를 수동으로 실행해주세요.")
            return False
    
    print_success("TypeScript 빌드 확인 완료")
    print_success("모든 전제 조건 확인 완료\n")
    
    return True

def step1_target_selection(src_dir: Path) -> bool:
    """Step 1: 평가 대상 선정"""
    print_step(1, "평가 대상 선정 (evaluation-target-selection.py)")
    
    return run_command(
        ["python3", "evaluation-target-selection.py"],
        "평가 대상 선정",
        cwd=str(src_dir)
    )

def step2_rule_evaluation(src_dir: Path) -> bool:
    """Step 2: 규칙 기반 평가"""
    print_step(2, "규칙 기반 평가 - RULE (evaluation-rule.py)")
    
    return run_command(
        ["python3", "evaluation-rule.py"],
        "규칙 기반 평가",
        cwd=str(src_dir)
    )

def step3_ai_evaluation(project_root: Path, parallel_choice: str) -> bool:
    """Step 3: AI 평가 (TypeScript/Node.js)"""
    print_step(3, "AI 평가 - LAAJ (Perplexity AI via TypeScript)")
    
    print_info("Node.js로 AI 평가를 실행합니다.")
    print_info(f"병렬 브라우저 수: {parallel_choice}개")
    print_warning("이 단계는 시간이 오래 걸릴 수 있습니다. (수분~수십분)")
    print_warning("수동 로그인이 필요한 경우 브라우저에서 직접 로그인해주세요.\n")
    
    # Node.js 실행 (병렬 처리 선택값을 stdin으로 전달)
    try:
        print(f"{Colors.OKBLUE}$ echo '{parallel_choice}' | node dist/index.js{Colors.ENDC}\n")
        
        # 선택값을 stdin으로 전달
        result = subprocess.run(
            ["node", "dist/index.js"],
            cwd=str(project_root),
            input=f"{parallel_choice}\n",
            text=True,
            check=True
        )
        
        print_success("AI 평가 완료")
        return True
        
    except subprocess.CalledProcessError as e:
        print_error(f"AI 평가 실패 (exit code: {e.returncode})")
        return False
    except KeyboardInterrupt:
        print_warning("\n사용자가 평가를 중단했습니다.")
        return False
    except Exception as e:
        print_error(f"AI 평가 중 예류 발생: {str(e)}")
        return False

def main():
    """메인 실행 함수"""
    print(f"\n{Colors.BOLD}{Colors.HEADER}")
    print("🚀 음식점 평가 전체 파이프라인")
    print("=" * 80)
    print(f"{Colors.ENDC}\n")
    
    # 전제 조건 확인
    if not check_prerequisites():
        print_error("전제 조건을 만족하지 않아 종료합니다.")
        sys.exit(1)
    
    # 디렉토리 설정
    current_dir = Path.cwd()
    if current_dir.name == "src":
        src_dir = current_dir
        project_root = current_dir.parent
    else:
        src_dir = current_dir / "src"
        project_root = current_dir
    
    # AI 평가 병렬 처리 브라우저 수 선택 (미리 받기)
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}Step 3 (AI 평가) 설정 - 병렬 처리 브라우저 개수 선택{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}{'='*80}{Colors.ENDC}\n")
    print(f"  {Colors.OKGREEN}1{Colors.ENDC} - 1개 (순차 처리, 안정적)")
    print(f"  {Colors.OKGREEN}3{Colors.ENDC} - 3개 (병렬 처리, 권장)")
    print(f"  {Colors.OKGREEN}5{Colors.ENDC} - 5개 (병렬 처리, 빠름)")
    
    parallel_choice = None
    while True:
        try:
            choice = input(f"{Colors.OKBLUE}선택 (1/3/5): {Colors.ENDC}").strip()
            if choice in ['1', '3', '5']:
                parallel_choice = choice
                print(f"{Colors.OKGREEN}✅ {choice}개 브라우저로 병렬 처리 설정 완료{Colors.ENDC}\n")
                break
            else:
                print(f"{Colors.WARNING}⚠️  1, 3, 5 중 하나를 선택해주세요.{Colors.ENDC}")
        except KeyboardInterrupt:
            print(f"\n{Colors.WARNING}⚠️  사용자가 선택을 취소했습니다.{Colors.ENDC}")
            sys.exit(130)
    
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}평가 파이프라인 시작{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}\n")
    # Step 1: 평가 대상 선정
    if not step1_target_selection(src_dir):
        print_error("\nStep 1 실패로 인해 파이프라인을 중단합니다.")
        sys.exit(1)
    
    # Step 2: 규칙 기반 평가
    if not step2_rule_evaluation(src_dir):
        print_error("\nStep 2 실패로 인해 파이프라인을 중단합니다.")
        print_info("규칙 평가 중 일부 실패는 정상일 수 있습니다. (해외 주소, API 제한 등)")
        print_info("계속 진행하려면 수동으로 Step 3을 실행하세요: node dist/index.js")
        sys.exit(1)
    
    # Step 3: AI 평가
    if not step3_ai_evaluation(project_root, parallel_choice):
        print_error("\nStep 3 실패로 인해 파이프라인을 중단합니다.")
        sys.exit(1)
    
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
