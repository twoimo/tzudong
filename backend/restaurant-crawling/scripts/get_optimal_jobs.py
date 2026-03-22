import os
import sys

def get_optimal_jobs():
    # CPU 코어 수 기반 동적 병렬 처리 개수 계산
    # GitHub Actions(보통 2~4코어) 및 다양한 OS(Windows, Mac, Linux) 환경 지원
    try:
        cores = os.cpu_count()
        if cores is None:
            cores = 2
    except:
        cores = 2

    # 최소 2개, 최대 8개로 제한 (너무 많은 API 동시 호출 시 Rate Limit/Quota Error 방지)
    # CPU 코어가 많더라도 API 제한을 고려해 보수적으로 접근 (코어수 - 1)
    optimal_jobs = max(2, min(cores - 1, 8))
    
    # 환경 변수로 명시적 오버라이드가 있는 경우 우선 적용
    if "MAX_JOBS" in os.environ:
        try:
            optimal_jobs = int(os.environ["MAX_JOBS"])
        except ValueError:
            pass
            
    print(optimal_jobs)

if __name__ == "__main__":
    get_optimal_jobs()
