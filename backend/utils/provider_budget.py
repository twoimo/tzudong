"""Local cross-process project pacing. No keys, prompts, or responses on disk."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import time
import uuid


def positive_int(value: str | None, default: int, ceiling: int) -> int:
    try:
        parsed = int(value or default)
    except ValueError:
        raise ValueError("provider_budget_invalid") from None
    if not 0 < parsed <= ceiling:
        raise ValueError("provider_budget_invalid")
    return parsed


def budget_path() -> Path:
    """A host-wide default prevents separate checkouts multiplying one quota."""
    explicit = os.getenv('GEMINI_BUDGET_PATH')
    if explicit:
        return Path(explicit)
    directory = Path(os.getenv('TZUDONG_PROVIDER_STATE_DIR', str(Path.home()/'.cache'/'tzudong')))
    return directory/'provider-budget.sqlite'


class ProjectBudget:
    def __init__(self, path: Path, scope: str, *, rpm: int = 30, concurrency: int = 1):
        import re
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,62}', scope):
            raise ValueError("provider_scope_invalid")
        if not 0 < rpm <= 100000 or not 0 < concurrency <= 8:
            raise ValueError("provider_budget_invalid")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path, self.scope = path, scope
        self.interval, self.concurrency = 60 / rpm, concurrency
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS pacing(scope TEXT PRIMARY KEY, next REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS leases(scope TEXT, id TEXT PRIMARY KEY, pid INTEGER, started REAL)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        try:
            yield db
        finally:
            db.close()

    @staticmethod
    def alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def acquire(self, pid: int, *, timeout: float = 600) -> str:
        deadline = time.monotonic() + timeout
        identity = uuid.uuid4().hex
        while True:
            wait = 0.1
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                now = time.time()
                for lease, owner in db.execute("SELECT id,pid FROM leases WHERE scope=?", (self.scope,)):
                    if not self.alive(owner):
                        db.execute("DELETE FROM leases WHERE id=?", (lease,))
                count = db.execute("SELECT count(*) FROM leases WHERE scope=?", (self.scope,)).fetchone()[0]
                row = db.execute("SELECT next FROM pacing WHERE scope=?", (self.scope,)).fetchone()
                ready = row[0] if row else 0
                if count < self.concurrency and ready <= now:
                    db.execute("INSERT INTO leases VALUES(?,?,?,?)", (self.scope, identity, pid, now))
                    db.execute("INSERT INTO pacing VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET next=excluded.next", (self.scope, now + self.interval))
                    db.commit()
                    return identity
                wait = min(1.0, max(0.01, ready - now)) if ready > now else 0.1
                db.commit()
            if time.monotonic() + wait > deadline:
                raise TimeoutError("provider_budget_timeout")
            time.sleep(wait)

    def release(self, identity: str) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM leases WHERE id=? AND scope=?", (identity, self.scope))

    def cooldown(self, delay: float) -> None:
        import math
        if not math.isfinite(delay) or delay < 0:
            raise ValueError("provider_cooldown_invalid")
        with self.connect() as db:
            db.execute("INSERT INTO pacing VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET next=max(next,excluded.next)", (self.scope, time.time() + delay))

    @contextmanager
    def lease(self):
        identity = self.acquire(os.getpid())
        try:
            yield
        finally:
            self.release(identity)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("acquire", "release", "cooldown"))
    parser.add_argument("--pid", type=int, default=os.getppid())
    parser.add_argument("--lease", default="")
    parser.add_argument("--delay", type=float, default=0)
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    budget = ProjectBudget(budget_path(),
                           os.getenv("GEMINI_BUDGET_PROJECT", "configured-project"),
                           rpm=positive_int(os.getenv("GEMINI_REQUESTS_PER_MINUTE"), 30, 100000),
                           concurrency=positive_int(os.getenv("GEMINI_MAX_INFLIGHT"), 1, 8))
    if args.action == "acquire":
        if not 0 < args.timeout <= 600:
            raise ValueError('provider_budget_invalid')
        print(budget.acquire(args.pid, timeout=args.timeout))
    elif args.action == "release":
        budget.release(args.lease)
    else:
        budget.cooldown(args.delay)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, sqlite3.Error, TimeoutError):
        raise SystemExit("PROVIDER_BUDGET_UNAVAILABLE") from None
