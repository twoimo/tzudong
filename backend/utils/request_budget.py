"""Thread-safe pacing and single-flight reads, with no persisted provider data."""
from __future__ import annotations

from concurrent.futures import Future
from copy import deepcopy
import threading
import time
from typing import Callable, TypeVar

T = TypeVar("T")


class ReadCoalescer:
    """One read per key per run; exceptions are never cached."""
    def __init__(self, capacity: int = 4096):
        self.capacity = capacity
        self._pending: dict[object, Future] = {}
        self._lock = threading.Lock()

    def get(self, key: object, read: Callable[[], T]) -> T:
        with self._lock:
            pending = self._pending.get(key)
            owner = pending is None
            if owner:
                pending = Future()
                # Evict completed entries only: never duplicate in-flight work.
                if len(self._pending) >= self.capacity:
                    for old, value in list(self._pending.items()):
                        if value.done():
                            del self._pending[old]
                            break
                self._pending[key] = pending
        if owner:
            try:
                result = read()
            except BaseException as error:
                pending.set_exception(error)
                with self._lock:
                    self._pending.pop(key, None)
                raise
            else:
                pending.set_result(result)
        return deepcopy(pending.result())


class RequestPacer:
    """Serialize reservations without holding a lock while sleeping."""
    def __init__(self, interval: float, *, clock=time.monotonic, sleep=time.sleep, max_wait: float = 30):
        import math
        if not math.isfinite(interval) or interval < 0:
            raise ValueError("request_interval_invalid")
        self.interval, self.clock, self.sleep = interval, clock, sleep
        self.max_wait = max_wait
        self._next = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        deadline=self.clock()+self.max_wait
        while True:
            with self._lock:
                now=self.clock()
                if now>=self._next:
                    self._next=now+self.interval
                    return
                delay=self._next-now
            if delay>deadline-now:
                raise TimeoutError("PROVIDER_RATE_LIMITED")
            self.sleep(delay)

    def cooldown(self, seconds: float) -> None:
        with self._lock:
            self._next = max(self._next, self.clock() + max(0, seconds))


def retry_after_seconds(value: str | None, *, now: float | None = None) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value)
    except ValueError:
        from email.utils import parsedate_to_datetime
        try:
            seconds = parsedate_to_datetime(value).timestamp() - (time.time() if now is None else now)
        except (ValueError, TypeError, OverflowError):
            return None
    import math
    return max(0.0, seconds) if math.isfinite(seconds) else None
