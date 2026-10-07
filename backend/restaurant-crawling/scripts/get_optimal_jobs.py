import os

def get_optimal_jobs():
    # API admission is configured independently of CPU availability. All keys
    # in a project share a quota; unknown limits must not imply extra capacity.
    raw = os.environ.get("GEMINI_MAX_INFLIGHT", "1")
    try:
        jobs = int(raw)
    except (ValueError, TypeError):
        jobs = 1
    print(max(1, min(jobs, 8)))

if __name__ == "__main__":
    get_optimal_jobs()
