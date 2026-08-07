"""
LangGraph 노드 함수 (Node Functions).

각 노드는 기존 스크립트를 subprocess로 호출하고,
결과를 파싱하여 PipelineState를 업데이트한다.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from backend.utils.privacy_log import redact_log_text

from .state import PipelineState, StepName, ValidationSeverity
from .validators import (
    validate_gemini_output,
    validate_selection,
    validate_rule_results,
    validate_laaj_results,
    cross_validate,
    validate_transform_output,
    has_blocking_errors,
    error_summary,
)
from .review import ReviewQueue


# ─── 유틸리티 ─────────────────────────────────────────────

MAX_SUBPROCESS_OUTPUT_BYTES = 1024 * 1024
MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024

SUBPROCESS_OK = "SUBPROCESS_OK"
SUBPROCESS_EXIT_NONZERO = "SUBPROCESS_EXIT_NONZERO"
SUBPROCESS_TIMEOUT = "SUBPROCESS_TIMEOUT"
SUBPROCESS_OUTPUT_LIMIT = "SUBPROCESS_OUTPUT_LIMIT"
SUBPROCESS_LAUNCH_FAILED = "SUBPROCESS_LAUNCH_FAILED"
SUBPROCESS_STAGE_REJECTED = "SUBPROCESS_STAGE_REJECTED"
SUBPROCESS_EXECUTABLE_REJECTED = "SUBPROCESS_EXECUTABLE_REJECTED"
SUBPROCESS_CLEANUP_FAILED = "SUBPROCESS_CLEANUP_FAILED"
WINDOWS_CREATE_SUSPENDED = 0x00000004
WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1
WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
WINDOWS_NTSTATUS_SUCCESS = 0

# Each stage starts with an empty environment. The writer is the only child
# allowed to receive persistence credentials, and only the names its script
# consumes directly. Adding a secret requires an explicit capability review.
STAGE_CAPABILITIES: dict[str, frozenset[str]] = {
    StepName.ENRICH.value: frozenset(),
    StepName.GEMINI.value: frozenset({
        "GEMINI_API_KEY",
        "PRIMARY_MODEL",
        "FALLBACK_MODEL",
        "GEMINI_THINKING_LEVEL",
    }),
    StepName.TARGET.value: frozenset(),
    StepName.RULE.value: frozenset({
        "GEMINI_API_KEY",
        "GEMINI_FALLBACK_MODEL",
        "GEMINI_FALLBACK_TIMEOUT_SEC",
    }),
    StepName.LAAJ.value: frozenset({
        "GEMINI_API_KEY",
        "PRIMARY_MODEL",
        "FALLBACK_MODEL",
        "GEMINI_CLI_TIMEOUT_SEC",
    }),
    StepName.TRANSFORM.value: frozenset(),
    StepName.INSERT.value: frozenset({
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
    }),
}


@dataclass(frozen=True)
class CommandResult:
    """Bounded result of a child process without exposing its diagnostics."""

    args: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str
    reason_code: str


class PipelineCommandFailure(RuntimeError):
    """Fixed-code graph failure for an unsuccessful pipeline child command."""

    def __init__(self, stage: str, reason_code: str) -> None:
        self.stage = stage
        self.reason_code = reason_code
        super().__init__(reason_code)


def _command_result(
    command: list[str],
    returncode: int,
    reason_code: str,
    stdout: str = "",
    stderr: str = "",
) -> CommandResult:
    return CommandResult(
        args=tuple(part for part in command if isinstance(part, str)),
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
        reason_code=reason_code,
    )


def _failure_returncode(reason_code: str, returncode: int | None = None) -> int:
    if reason_code == SUBPROCESS_EXIT_NONZERO and returncode not in (None, 0):
        return returncode
    return {
        SUBPROCESS_TIMEOUT: 124,
        SUBPROCESS_OUTPUT_LIMIT: 125,
        SUBPROCESS_LAUNCH_FAILED: 127,
    }.get(reason_code, 126)


def _require_command_success(step: str, result: CommandResult) -> None:
    if result.reason_code == SUBPROCESS_OK and result.returncode == 0:
        return
    reason_code = (
        result.reason_code
        if result.reason_code != SUBPROCESS_OK
        else SUBPROCESS_EXIT_NONZERO
    )
    raise PipelineCommandFailure(step, reason_code)

def _reason_code_from_exception(exc: RuntimeError) -> str:
    reason_code = str(exc)
    if reason_code in {
        SUBPROCESS_STAGE_REJECTED,
        SUBPROCESS_EXECUTABLE_REJECTED,
        SUBPROCESS_LAUNCH_FAILED,
    }:
        return reason_code
    return SUBPROCESS_LAUNCH_FAILED


def _run_stage_command(
    stage: str,
    command_factory: Callable[[], list[str]],
    timeout: int | float = 1800,
) -> CommandResult:
    try:
        command = command_factory()
    except RuntimeError as exc:
        reason_code = _reason_code_from_exception(exc)
        return _command_result(
            command=[],
            returncode=_failure_returncode(reason_code),
            reason_code=reason_code,
        )
    except OSError:
        return _command_result(
            command=[],
            returncode=_failure_returncode(SUBPROCESS_LAUNCH_FAILED),
            reason_code=SUBPROCESS_LAUNCH_FAILED,
        )
    return run_command(stage, command, timeout=timeout)



class _OutputRing:
    """Keep only the tail of one output stream in a fixed-size buffer."""

    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._chunks: deque[bytes] = deque()
        self._size = 0

    def append(self, chunk: bytes) -> None:
        if self._capacity <= 0:
            return
        if len(chunk) >= self._capacity:
            self._chunks.clear()
            self._chunks.append(chunk[-self._capacity:])
            self._size = self._capacity
            return

        self._chunks.append(chunk)
        self._size += len(chunk)
        while self._size > self._capacity:
            excess = self._size - self._capacity
            first = self._chunks[0]
            if len(first) <= excess:
                self._chunks.popleft()
                self._size -= len(first)
            else:
                self._chunks[0] = first[excess:]
                self._size -= excess

    def text(self) -> str:
        return b"".join(self._chunks).decode("utf-8", errors="replace")


def _project_root() -> Path:
    """backend/pipeline/ 기준으로 프로젝트 루트 반환"""
    return Path(__file__).resolve().parent.parent.parent


def _validated_executable(candidate: Path) -> str:
    if not candidate.is_absolute():
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED) from exc
    if not resolved.is_file() or (os.name != "nt" and not os.access(resolved, os.X_OK)):
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)
    return str(resolved)


def _windows_directory() -> Path:
    """Read the Windows directory from the OS rather than the parent environment."""
    if os.name != "nt":
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)

    import ctypes

    buffer = ctypes.create_unicode_buffer(32768)
    length = ctypes.windll.kernel32.GetWindowsDirectoryW(buffer, len(buffer))
    if not length or length >= len(buffer):
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)
    return Path(buffer.value)


def _python_cmd() -> str:
    """Return the validated absolute interpreter for this running process."""
    if not sys.executable:
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)
    return _validated_executable(Path(sys.executable))


def _bash_cmd() -> str:
    """Return a validated platform bash without consulting PATH."""
    if os.name != "nt":
        return _validated_executable(Path("/bin/bash"))

    windows_directory = _windows_directory()
    candidates = (
        windows_directory.parent / "Program Files" / "Git" / "bin" / "bash.exe",
        windows_directory.parent / "Program Files" / "Git" / "usr" / "bin" / "bash.exe",
    )
    for candidate in candidates:
        try:
            return _validated_executable(candidate)
        except RuntimeError:
            continue
    raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)


def _controlled_temp_parent() -> Path:
    if os.name != "nt":
        for candidate in (Path("/tmp"), Path("/var/tmp")):
            if candidate.is_dir():
                return candidate
        raise RuntimeError(SUBPROCESS_LAUNCH_FAILED)

    import ctypes

    buffer = ctypes.create_unicode_buffer(32768)
    # CSIDL_LOCAL_APPDATA avoids trusting TEMP, TMP, HOME, or user-provided paths.
    result = ctypes.windll.shell32.SHGetFolderPathW(None, 0x001C, None, 0, buffer)
    if result != 0:
        raise RuntimeError(SUBPROCESS_LAUNCH_FAILED)
    parent = Path(buffer.value) / "Temp"
    if not parent.is_dir():
        raise RuntimeError(SUBPROCESS_LAUNCH_FAILED)
    return parent


def _controlled_path(executable: str) -> str:
    executable_path = Path(executable)
    if os.name == "nt":
        windows_directory = _windows_directory()
        candidates = (
            windows_directory / "System32",
            windows_directory,
            executable_path.parent,
            executable_path.parent.parent / "usr" / "bin",
        )
    else:
        candidates = (
            Path("/usr/local/sbin"),
            Path("/usr/local/bin"),
            Path("/usr/sbin"),
            Path("/usr/bin"),
            Path("/sbin"),
            Path("/bin"),
            executable_path.parent,
        )

    directories: list[str] = []
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved.is_dir() and str(resolved) not in directories:
            directories.append(str(resolved))
    if not directories:
        raise RuntimeError(SUBPROCESS_LAUNCH_FAILED)
    return os.pathsep.join(directories)


def _build_stage_environment(stage: str, executable: str, temp_home: str) -> dict[str, str]:
    try:
        capabilities = STAGE_CAPABILITIES[stage]
    except KeyError as exc:
        raise RuntimeError(SUBPROCESS_STAGE_REJECTED) from exc

    environment = {
        "PATH": _controlled_path(executable),
        "HOME": temp_home,
        "TMPDIR": temp_home,
        "TEMP": temp_home,
        "TMP": temp_home,
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
        "TZUDONG_PIPELINE_ISOLATED": "1",
    }
    if os.name == "nt":
        windows_directory = str(_windows_directory())
        environment.update({
            "SystemRoot": windows_directory,
            "WINDIR": windows_directory,
            "ComSpec": str(Path(windows_directory) / "System32" / "cmd.exe"),
            "PATHEXT": ".COM;.EXE;.BAT;.CMD",
        })

    for name in capabilities:
        value = os.environ.get(name)
        if value:
            environment[name] = value
    return environment


def _validate_command(command: list[str]) -> list[str]:
    if not command or not all(isinstance(part, str) for part in command):
        raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)

    executable = _validated_executable(Path(command[0]))
    if executable != _python_cmd():
        try:
            bash = _bash_cmd()
        except RuntimeError as exc:
            raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED) from exc
        if executable != bash:
            raise RuntimeError(SUBPROCESS_EXECUTABLE_REJECTED)
    return [executable, *command[1:]]


def _helper_environment(executable: str) -> dict[str, str]:
    return {
        "PATH": _controlled_path(executable),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
    }


def _run_posix_tree_helper(process_group_id: int, signal_value: int) -> bool:
    """Use the pinned interpreter to signal a group when this process cannot."""
    try:
        helper = _python_cmd()
        completed = subprocess.run(
            [
                helper,
                "-c",
                (
                    "import os, sys\n"
                    "try:\n"
                    "    os.killpg(int(sys.argv[1]), int(sys.argv[2]))\n"
                    "except ProcessLookupError:\n"
                    "    pass"
                ),
                str(process_group_id),
                str(signal_value),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=5,
            env=_helper_environment(helper),
        )
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def _posix_tree_helper_confirms_empty(process_group_id: int) -> bool:
    try:
        helper = _python_cmd()
        completed = subprocess.run(
            [
                helper,
                "-c",
                (
                    "import os, sys\n"
                    "try:\n"
                    "    os.killpg(int(sys.argv[1]), 0)\n"
                    "except ProcessLookupError:\n"
                    "    raise SystemExit(0)\n"
                    "raise SystemExit(1)"
                ),
                str(process_group_id),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=5,
            env=_helper_environment(helper),
        )
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def _signal_posix_process_group(process_group_id: int, signal_name: str) -> bool:
    signal_value = getattr(signal, f"SIG{signal_name}")
    try:
        os.killpg(process_group_id, signal_value)
        return True
    except ProcessLookupError:
        return True
    except OSError:
        return _run_posix_tree_helper(process_group_id, signal_value)


def _posix_process_group_is_empty(process_group_id: int) -> bool:
    try:
        os.killpg(process_group_id, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return _posix_tree_helper_confirms_empty(process_group_id)
    return False


def _wait_for_posix_process_group(process_group_id: int, deadline: float) -> bool:
    while time.monotonic() < deadline:
        if _posix_process_group_is_empty(process_group_id):
            return True
        time.sleep(0.02)
    return _posix_process_group_is_empty(process_group_id)


def _terminate_posix_process_group(process_group_id: int) -> bool:
    term_sent = _signal_posix_process_group(process_group_id, "TERM")
    if term_sent and _wait_for_posix_process_group(process_group_id, time.monotonic() + 2):
        return True

    kill_sent = _signal_posix_process_group(process_group_id, "KILL")
    if not kill_sent:
        return False
    return _wait_for_posix_process_group(process_group_id, time.monotonic() + 5)


def _windows_kernel32() -> tuple[Any, Any, Any]:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = (
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    )
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.IsProcessInJob.argtypes = (
        wintypes.HANDLE,
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.BOOL),
    )
    kernel32.IsProcessInJob.restype = wintypes.BOOL
    kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel32.TerminateJobObject.restype = wintypes.BOOL
    kernel32.QueryInformationJobObject.argtypes = (
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.QueryInformationJobObject.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return ctypes, wintypes, kernel32

def _create_windows_job(process: subprocess.Popen[bytes]) -> Any | None:
    """Create a kill-on-close job before accepting a Windows child command."""
    job: Any | None = None
    try:
        ctypes, wintypes, kernel32 = _windows_kernel32()

        class _JobBasicLimitInformation(ctypes.Structure):
            _fields_ = [
                ("per_process_user_time_limit", ctypes.c_int64),
                ("per_job_user_time_limit", ctypes.c_int64),
                ("limit_flags", wintypes.DWORD),
                ("minimum_working_set_size", ctypes.c_size_t),
                ("maximum_working_set_size", ctypes.c_size_t),
                ("active_process_limit", wintypes.DWORD),
                ("affinity", ctypes.c_size_t),
                ("priority_class", wintypes.DWORD),
                ("scheduling_class", wintypes.DWORD),
            ]

        class _IoCounters(ctypes.Structure):
            _fields_ = [
                ("read_operation_count", ctypes.c_uint64),
                ("write_operation_count", ctypes.c_uint64),
                ("other_operation_count", ctypes.c_uint64),
                ("read_transfer_count", ctypes.c_uint64),
                ("write_transfer_count", ctypes.c_uint64),
                ("other_transfer_count", ctypes.c_uint64),
            ]

        class _JobExtendedLimitInformation(ctypes.Structure):
            _fields_ = [
                ("basic_limit_information", _JobBasicLimitInformation),
                ("io_info", _IoCounters),
                ("process_memory_limit", ctypes.c_size_t),
                ("job_memory_limit", ctypes.c_size_t),
                ("peak_process_memory_used", ctypes.c_size_t),
                ("peak_job_memory_used", ctypes.c_size_t),
            ]

        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None
        limits = _JobExtendedLimitInformation()
        limits.basic_limit_information.limit_flags = (
            WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        process_handle = getattr(process, "_handle", None)
        if process_handle is None:
            kernel32.CloseHandle(job)
            return None
        process_handle = wintypes.HANDLE(int(process_handle))
        if (
            not kernel32.SetInformationJobObject(
                job,
                WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                ctypes.byref(limits),
                ctypes.sizeof(limits),
            )
            or not kernel32.AssignProcessToJobObject(job, process_handle)
        ):
            kernel32.CloseHandle(job)
            return None
        in_job = wintypes.BOOL()
        if not kernel32.IsProcessInJob(process_handle, job, ctypes.byref(in_job)) or not in_job.value:
            kernel32.CloseHandle(job)
            return None
        return job
    except (AttributeError, OSError, TypeError):
        if job is not None:
            _close_windows_job(job)
        return None
def _resume_windows_process(process: subprocess.Popen[bytes]) -> bool:
    """Resume a job-owned suspended process only after containment is verified."""
    try:
        ctypes, wintypes, _ = _windows_kernel32()
        process_handle = getattr(process, "_handle", None)
        if process_handle is None:
            return False
        ntdll = ctypes.windll.ntdll
        ntdll.NtResumeProcess.argtypes = (wintypes.HANDLE,)
        ntdll.NtResumeProcess.restype = ctypes.c_long
        return (
            ntdll.NtResumeProcess(wintypes.HANDLE(int(process_handle)))
            >= WINDOWS_NTSTATUS_SUCCESS
        )
    except (AttributeError, OSError, TypeError):
        return False



def _terminate_windows_job(job: Any) -> bool:
    try:
        _, wintypes, kernel32 = _windows_kernel32()
        return bool(kernel32.TerminateJobObject(job, wintypes.UINT(1)))
    except (AttributeError, OSError, TypeError):
        return False

def _windows_job_is_empty(job: Any) -> bool:
    try:
        ctypes, wintypes, kernel32 = _windows_kernel32()

        class _JobBasicAccountingInformation(ctypes.Structure):
            _fields_ = [
                ("total_user_time", ctypes.c_int64),
                ("total_kernel_time", ctypes.c_int64),
                ("this_period_total_user_time", ctypes.c_int64),
                ("this_period_total_kernel_time", ctypes.c_int64),
                ("total_page_fault_count", wintypes.DWORD),
                ("total_processes", wintypes.DWORD),
                ("active_processes", wintypes.DWORD),
                ("total_terminated_processes", wintypes.DWORD),
            ]

        information = _JobBasicAccountingInformation()
        returned_length = wintypes.DWORD()
        if not kernel32.QueryInformationJobObject(
            job,
            WINDOWS_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
            ctypes.byref(information),
            ctypes.sizeof(information),
            ctypes.byref(returned_length),
        ):
            return False
        return (
            returned_length.value == ctypes.sizeof(information)
            and information.active_processes == 0
        )
    except (AttributeError, OSError, TypeError):
        return False


def _close_windows_job(job: Any) -> bool:
    try:
        _, _, kernel32 = _windows_kernel32()
        return bool(kernel32.CloseHandle(job))
    except (AttributeError, OSError, TypeError):
        return False


def _taskkill_process_tree(process: subprocess.Popen[bytes]) -> bool:
    try:
        taskkill = _validated_executable(_windows_directory() / "System32" / "taskkill.exe")
        windows_directory = str(_windows_directory())
        completed = subprocess.run(
            [taskkill, "/PID", str(process.pid), "/T", "/F"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=5,
            env={
                "SystemRoot": windows_directory,
                "WINDIR": windows_directory,
            },
        )
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def _wait_for_process(process: subprocess.Popen[bytes], timeout: float = 5) -> bool:
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return False
    return True
def _wait_for_windows_job(
    process: subprocess.Popen[bytes],
    job: Any,
    timeout: float = 5,
) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None and _windows_job_is_empty(job):
            return True
        time.sleep(0.02)
    return process.poll() is not None and _windows_job_is_empty(job)


def _close_process_pipes(process: subprocess.Popen[bytes]) -> None:
    for stream in (process.stdout, process.stderr):
        if stream is None:
            continue
        try:
            stream.close()
        except (OSError, ValueError):
            pass


def _join_reader_threads(
    stdout_thread: threading.Thread,
    stderr_thread: threading.Thread,
    timeout: float = 5,
) -> bool:
    deadline = time.monotonic() + timeout
    for reader_thread in (stdout_thread, stderr_thread):
        if reader_thread.ident is None:
            continue
        remaining = max(0, deadline - time.monotonic())
        reader_thread.join(timeout=remaining)
    return not stdout_thread.is_alive() and not stderr_thread.is_alive()
def _terminate_unresumed_windows_process(process: subprocess.Popen[bytes]) -> bool:
    """A CREATE_SUSPENDED child has not run and cannot yet have descendants."""
    if _taskkill_process_tree(process) and _wait_for_process(process):
        return True
    try:
        process.kill()
    except OSError:
        return False
    return _wait_for_process(process)




@dataclass
class _ProcessTreeSupervisor:
    process: subprocess.Popen[bytes]
    process_group_id: int | None = None
    windows_job: Any | None = None
    windows_job_released: bool = False

    def is_clean(self) -> bool:
        if self.windows_job is not None:
            return _wait_for_windows_job(self.process, self.windows_job, timeout=0.5)
        if self.windows_job_released:
            return _wait_for_process(self.process, timeout=0.5)
        return (
            self.process_group_id is not None
            and _posix_process_group_is_empty(self.process_group_id)
        )

    def terminate(self) -> bool:
        if self.windows_job is not None:
            job = self.windows_job
            if _terminate_windows_job(job) and _wait_for_windows_job(
                self.process,
                job,
            ):
                return True
            if _taskkill_process_tree(self.process) and _wait_for_windows_job(
                self.process,
                job,
            ):
                return True
            if _close_windows_job(job):
                self.windows_job = None
                self.windows_job_released = True
                _wait_for_process(self.process)
            return False
        if self.windows_job_released:
            return False
        return (
            self.process_group_id is not None
            and _terminate_posix_process_group(self.process_group_id)
            and _wait_for_process(self.process)
        )

    def close(self) -> bool:
        if self.windows_job is None:
            return True
        return _close_windows_job(self.windows_job)


def _start_process_tree_supervisor(
    process: subprocess.Popen[bytes],
) -> _ProcessTreeSupervisor | None:
    if os.name == "nt":
        windows_job = _create_windows_job(process)
        if windows_job is None:
            return None
        return _ProcessTreeSupervisor(process=process, windows_job=windows_job)

    try:
        if os.getpgid(process.pid) != process.pid or os.getsid(process.pid) != process.pid:
            return None
    except OSError:
        return None
    return _ProcessTreeSupervisor(process=process, process_group_id=process.pid)


def _terminate_process_tree(supervisor: _ProcessTreeSupervisor) -> bool:
    """Terminate only a verified whole process tree; never fall back to its parent."""
    return supervisor.terminate()


def _cleanup_failure_result(
    command: list[str],
    result: CommandResult | None = None,
) -> CommandResult:
    return _command_result(
        command,
        _failure_returncode(SUBPROCESS_CLEANUP_FAILED),
        SUBPROCESS_CLEANUP_FAILED,
        stdout=result.stdout if result else "",
        stderr=result.stderr if result else "",
    )


def _collect_command_result(
    command: list[str],
    process: subprocess.Popen[bytes],
    supervisor: _ProcessTreeSupervisor,
    timeout: int | float,
) -> CommandResult:
    stdout_ring = _OutputRing(MAX_CAPTURED_OUTPUT_BYTES)
    stderr_ring = _OutputRing(MAX_CAPTURED_OUTPUT_BYTES)
    output_overflow = threading.Event()
    output_lock = threading.Lock()
    total_output = 0

    def drain(stream: Any, ring: _OutputRing) -> None:
        nonlocal total_output
        try:
            while chunk := stream.read(8192):
                ring.append(chunk)
                with output_lock:
                    total_output += len(chunk)
                    if total_output > MAX_SUBPROCESS_OUTPUT_BYTES:
                        output_overflow.set()
        except (OSError, ValueError):
            pass
        finally:
            try:
                stream.close()
            except (OSError, ValueError):
                pass

    stdout_thread = threading.Thread(
        target=drain,
        args=(process.stdout, stdout_ring),
        daemon=False,
    )
    stderr_thread = threading.Thread(
        target=drain,
        args=(process.stderr, stderr_ring),
        daemon=False,
    )
    stdout_thread.start()
    stderr_thread.start()

    reason_code = SUBPROCESS_OK
    deadline = time.monotonic() + timeout

    def stop_for_failure(failure_reason: str) -> None:
        nonlocal reason_code
        reason_code = failure_reason
        if not _terminate_process_tree(supervisor):
            reason_code = SUBPROCESS_CLEANUP_FAILED

    while process.poll() is None:
        if output_overflow.is_set():
            stop_for_failure(SUBPROCESS_OUTPUT_LIMIT)
            break
        if time.monotonic() >= deadline:
            stop_for_failure(SUBPROCESS_TIMEOUT)
            break
        time.sleep(0.02)

    reader_deadline = deadline if reason_code == SUBPROCESS_OK else time.monotonic() + 5
    while stdout_thread.is_alive() or stderr_thread.is_alive():
        if output_overflow.is_set() and reason_code == SUBPROCESS_OK:
            stop_for_failure(SUBPROCESS_OUTPUT_LIMIT)
            reader_deadline = time.monotonic() + 5
        elif time.monotonic() >= reader_deadline:
            if reason_code == SUBPROCESS_OK:
                stop_for_failure(SUBPROCESS_TIMEOUT)
                reader_deadline = time.monotonic() + 5
            else:
                break
        stdout_thread.join(timeout=0.02)
        stderr_thread.join(timeout=0.02)

    if process.poll() is None:
        stop_for_failure(
            SUBPROCESS_TIMEOUT if reason_code == SUBPROCESS_OK else reason_code,
        )
    if not _wait_for_process(process):
        stop_for_failure(SUBPROCESS_CLEANUP_FAILED)

    if stdout_thread.is_alive() or stderr_thread.is_alive():
        stop_for_failure(SUBPROCESS_CLEANUP_FAILED)
    _close_process_pipes(process)
    if not _join_reader_threads(stdout_thread, stderr_thread):
        reason_code = SUBPROCESS_CLEANUP_FAILED

    if output_overflow.is_set() and reason_code == SUBPROCESS_OK:
        stop_for_failure(SUBPROCESS_OUTPUT_LIMIT)

    if not supervisor.is_clean():
        if not supervisor.terminate() or not supervisor.is_clean():
            reason_code = SUBPROCESS_CLEANUP_FAILED

    returncode = process.returncode
    if reason_code == SUBPROCESS_OK and returncode != 0:
        reason_code = SUBPROCESS_EXIT_NONZERO
    if reason_code != SUBPROCESS_OK:
        returncode = _failure_returncode(reason_code, returncode)

    return _command_result(
        command,
        returncode,
        reason_code,
        stdout=stdout_ring.text(),
        stderr=stderr_ring.text(),
    )


def run_command(
    stage: str,
    command: list[str],
    cwd: str | Path | None = None,
    timeout: int | float = 1800,
) -> CommandResult:
    """Run a pinned command with stage-scoped credentials and bounded output."""
    if stage not in STAGE_CAPABILITIES:
        return _command_result(
            command,
            _failure_returncode(SUBPROCESS_STAGE_REJECTED),
            SUBPROCESS_STAGE_REJECTED,
        )
    if timeout <= 0:
        return _command_result(
            command,
            _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
            SUBPROCESS_LAUNCH_FAILED,
        )

    try:
        pinned_command = _validate_command(command)
        temporary_directory = tempfile.TemporaryDirectory(
            prefix="tzudong-pipeline-",
            dir=str(_controlled_temp_parent()),
        )
    except RuntimeError as exc:
        reason_code = _reason_code_from_exception(exc)
        return _command_result(
            command,
            _failure_returncode(reason_code),
            reason_code,
        )
    except OSError:
        return _command_result(
            command,
            _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
            SUBPROCESS_LAUNCH_FAILED,
        )

    result: CommandResult | None = None
    supervisor: _ProcessTreeSupervisor | None = None
    process: subprocess.Popen[bytes] | None = None
    try:
        temporary_home = temporary_directory.name
        try:
            os.chmod(temporary_home, 0o700)
        except OSError:
            pass
        environment = _build_stage_environment(stage, pinned_command[0], temporary_home)
        popen_kwargs: dict[str, Any] = {
            "cwd": str(cwd or _project_root()),
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": False,
            "env": environment,
        }
        if os.name == "nt":
            popen_kwargs["creationflags"] = (
                subprocess.CREATE_NEW_PROCESS_GROUP | WINDOWS_CREATE_SUSPENDED
            )
        else:
            popen_kwargs["start_new_session"] = True

        try:
            process = subprocess.Popen(pinned_command, **popen_kwargs)
        except OSError:
            result = _command_result(
                pinned_command,
                _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
                SUBPROCESS_LAUNCH_FAILED,
            )
        else:
            supervisor = _start_process_tree_supervisor(process)
            if supervisor is None:
                if os.name == "nt":
                    _terminate_unresumed_windows_process(process)
                else:
                    _terminate_posix_process_group(process.pid)
                result = _cleanup_failure_result(pinned_command)
            elif os.name == "nt" and not _resume_windows_process(process):
                if supervisor.terminate():
                    result = _command_result(
                        pinned_command,
                        _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
                        SUBPROCESS_LAUNCH_FAILED,
                    )
                else:
                    result = _cleanup_failure_result(pinned_command)
            else:
                result = _collect_command_result(
                    pinned_command,
                    process,
                    supervisor,
                    timeout,
                )
    except (OSError, RuntimeError):
        if supervisor is not None and not supervisor.terminate():
            result = _cleanup_failure_result(pinned_command)
        else:
            result = _command_result(
                pinned_command,
                _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
                SUBPROCESS_LAUNCH_FAILED,
            )
    finally:
        if process is not None:
            _close_process_pipes(process)
        if supervisor is not None:
            if not supervisor.close():
                result = _cleanup_failure_result(pinned_command, result)
            if process is not None and not _wait_for_process(process):
                result = _cleanup_failure_result(pinned_command, result)
        try:
            temporary_directory.cleanup()
        except OSError:
            result = _cleanup_failure_result(pinned_command, result)

    return result or _command_result(
        pinned_command,
        _failure_returncode(SUBPROCESS_LAUNCH_FAILED),
        SUBPROCESS_LAUNCH_FAILED,
    )


def _load_latest_jsonl(filepath: Path) -> dict | None:
    """JSONL 파일의 마지막 줄을 JSON으로 파싱"""
    if not filepath.exists():
        return None
    last_line = None
    with open(filepath, "r", encoding="utf-8-sig") as f:
        for line in f:
            stripped = line.strip()
            if stripped:
                last_line = stripped
    if not last_line:
        return None
    try:
        return json.loads(last_line)
    except json.JSONDecodeError:
        return None


def _log(step: str, msg: str) -> None:
    """파이프라인 로그 출력"""
    timestamp = time.strftime("%H:%M:%S")
    print(
        f"[{timestamp}] [Pipeline/{redact_log_text(step)}] {redact_log_text(msg)}",
        flush=True,
    )




def _log_subprocess_result(step: str, result: CommandResult, duration: float) -> None:
    reason_code = (
        result.reason_code
        if result.reason_code != SUBPROCESS_OK or result.returncode == 0
        else SUBPROCESS_EXIT_NONZERO
    )
    outcome = "완료" if reason_code == SUBPROCESS_OK else "실패"
    _log(step, f"{outcome} ({reason_code}, {duration:.0f}s)")




# ═══════════════════════════════════════════════════════════
# 노드 함수들
# ═══════════════════════════════════════════════════════════

def discover_video_ids(state: PipelineState) -> dict:
    """
    처리 대상 video_id 목록을 수집한다.
    crawling 디렉토리의 JSONL 파일명에서 추출.
    """
    crawling_dir = Path(state["crawling_path"]) / "crawling"
    video_ids = sorted({f.stem for f in crawling_dir.glob("*.jsonl")})

    max_v = state.get("max_videos", -1)
    if max_v > 0:
        video_ids = video_ids[:max_v]

    _log("discover", f"대상 video_id: {len(video_ids)}개")
    return {"video_ids": video_ids}


def run_enrich(state: PipelineState) -> dict:
    """Step 6.1: 자막 문서 메타데이터 추가"""
    step = StepName.ENRICH.value
    _log(step, "자막 문서 메타데이터 추가 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _python_cmd(),
            "backend/restaurant-crawling/scripts/06-1-transcript-document-with-meta.py",
            "--channel", state["channel"],
        ],
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def run_gemini(state: PipelineState) -> dict:
    """Step 7: Gemini 기반 데이터 분석"""
    step = StepName.GEMINI.value
    _log(step, "Gemini 데이터 분석 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _bash_cmd(),
            "backend/restaurant-crawling/scripts/07-gemini-crawling.sh",
            "--channel", state["channel"],
        ],
        timeout=3600,
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_gemini_node(state: PipelineState) -> dict:
    """Step 7 후 검증: Gemini 크롤링 결과 검증"""
    step = "validate_gemini"
    _log(step, "Gemini 결과 검증 중...")

    crawling_dir = Path(state["crawling_path"]) / "crawling"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []
    total_restaurants = 0

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(crawling_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_gemini_output(vid, data)
        all_errors.extend(errors)
        total_restaurants += len(data.get("restaurants", []))

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.GEMINI.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_gemini": completed,
        "total_restaurants": total_restaurants,
        "review_queue": [{"step": StepName.GEMINI.value, "count": len(failed_ids)}]
        if failed_ids else [],
    }


def run_target(state: PipelineState) -> dict:
    """Step 9: 평가 대상 선정"""
    step = StepName.TARGET.value
    _log(step, "평가 대상 선정 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _python_cmd(),
            "backend/restaurant-evaluation/scripts/09-target-selection.py",
            "--channel", state["channel"],
            "--crawling-path", state["crawling_path"],
            "--evaluation-path", state["evaluation_path"],
        ],
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_target_node(state: PipelineState) -> dict:
    """Step 9 후 검증: Selection 결과 검증"""
    step = "validate_target"
    _log(step, "Selection 결과 검증 중...")

    selection_dir = Path(state["evaluation_path"]) / "evaluation" / "selection"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(selection_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_selection(vid, data)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.TARGET.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_target": completed,
    }


def run_rule(state: PipelineState) -> dict:
    """Step 10: Rule 기반 평가"""
    step = StepName.RULE.value
    _log(step, "Rule 기반 평가 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _python_cmd(),
            "backend/restaurant-evaluation/scripts/10-rule-evaluation.py",
            "--channel", state["channel"],
            "--evaluation-path", state["evaluation_path"],
        ],
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_rule_node(state: PipelineState) -> dict:
    """Step 10 후 검증: Rule 평가 결과 검증"""
    step = "validate_rule"
    _log(step, "Rule 평가 결과 검증 중...")

    rule_dir = Path(state["evaluation_path"]) / "evaluation" / "rule_results"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(rule_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_rule_results(vid, data)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.RULE.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_rule": completed,
    }


def run_laaj(state: PipelineState) -> dict:
    """Step 11: LAAJ (LLM) 기반 평가"""
    step = StepName.LAAJ.value
    _log(step, "LAAJ 평가 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _bash_cmd(),
            "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh",
            "--channel", state["channel"],
            "--crawling-path", state["crawling_path"],
            "--evaluation-path", state["evaluation_path"],
        ],
        timeout=3600,
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_laaj_node(state: PipelineState) -> dict:
    """Step 11 후 검증: LAAJ 평가 결과 검증 + 교차 검증"""
    step = "validate_laaj"
    _log(step, "LAAJ 평가 결과 및 교차 검증 중...")

    laaj_dir = Path(state["evaluation_path"]) / "evaluation" / "laaj_results"
    rule_dir = Path(state["evaluation_path"]) / "evaluation" / "rule_results"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        laaj_data = _load_latest_jsonl(laaj_dir / f"{vid}.jsonl")
        if not laaj_data:
            continue

        # LAAJ 자체 검증
        errors = validate_laaj_results(vid, laaj_data)

        # Rule vs LAAJ 교차 검증
        rule_data = _load_latest_jsonl(rule_dir / f"{vid}.jsonl")
        if rule_data:
            cross_errors = cross_validate(vid, rule_data, laaj_data)
            errors.extend(cross_errors)

        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.LAAJ.value, errors, laaj_data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_laaj": completed,
    }


def run_transform(state: PipelineState) -> dict:
    """Step 12: 결과 변환"""
    step = StepName.TRANSFORM.value
    _log(step, "결과 변환 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _python_cmd(),
            "backend/restaurant-evaluation/scripts/12-transform.py",
            "--channel", state["channel"],
            "--crawling-path", state["crawling_path"],
            "--evaluation-path", state["evaluation_path"],
        ],
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_transform_node(state: PipelineState) -> dict:
    """Step 12 후 검증: Transform 출력 검증"""
    step = "validate_transform"
    _log(step, "Transform 결과 검증 중...")

    transforms_file = Path(state["evaluation_path"]) / "evaluation" / "transforms.jsonl"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    if not transforms_file.exists():
        _log(step, "transforms.jsonl 파일 없음")
        return {
            "validation_errors": [{
                "step": step,
                "video_id": "*",
                "restaurant_name": None,
                "severity": ValidationSeverity.ERROR.value,
                "rule": "missing_file",
                "message": "transforms.jsonl 파일이 존재하지 않습니다",
                "field_path": "",
                "actual_value": None,
            }],
        }

    # 전체 transforms.jsonl 로드 (video_id별 그룹핑)
    records_by_video: dict[str, list[dict]] = {}
    total_records = 0

    with open(transforms_file, "r", encoding="utf-8-sig") as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
                vid = record.get("youtube_link", "").split("v=")[-1] if record.get("youtube_link") else "unknown"
                records_by_video.setdefault(vid, []).append(record)
                total_records += 1
            except json.JSONDecodeError:
                continue

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []
    validated_count = 0

    for vid, records in records_by_video.items():
        if vid in state.get("failed_video_ids", []):
            continue

        errors = validate_transform_output(vid, records)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.TRANSFORM.value, errors,
                          {"video_id": vid, "records": records})
            failed_ids.append(vid)
        else:
            completed.append(vid)
            validated_count += len(records)

    _log(step, f"검증 완료: 레코드 {total_records}개 중 {validated_count}개 통과")

    # 품질 점수 계산
    quality = validated_count / total_records if total_records > 0 else 0.0

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_transform": completed,
        "validated_restaurants": validated_count,
        "quality_score": round(quality, 4),
    }


def run_insert(state: PipelineState) -> dict:
    """Step 13: Supabase 데이터 삽입"""
    step = StepName.INSERT.value

    if state.get("dry_run"):
        _log(step, "DRY RUN 모드: Supabase 삽입 건너뜀")
        return {
            "current_step": step,
            "step_timings": [{"step": step, "duration_sec": 0.0}],
        }

    _log(step, "Supabase 데이터 삽입 시작...")
    start = time.time()

    result = _run_stage_command(
        step,
        lambda: [
            _python_cmd(),
            "backend/restaurant-evaluation/scripts/13-supabase-insert.py",
            "--channel", state["channel"],
            "--evaluation-path", state["evaluation_path"],
        ],
    )

    duration = time.time() - start
    _log_subprocess_result(step, result, duration)

    _require_command_success(step, result)

    return {
        "current_step": step,
        "completed_insert": state.get("completed_transform", []),
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def generate_summary(state: PipelineState) -> dict:
    """최종 리포트 생성"""
    failed = state.get("failed_video_ids", [])
    unique_failed = list(set(failed))

    # 스텝별 소요 시간
    timings = state.get("step_timings", [])
    timing_lines = [f"  {t['step']}: {t['duration_sec']:.0f}s" for t in timings]
    total_time = sum(t["duration_sec"] for t in timings)

    # 검증 오류 요약
    errors = state.get("validation_errors", [])
    error_count = {"error": 0, "warning": 0, "info": 0}
    for e in errors:
        sev = e.get("severity", "info")
        error_count[sev] = error_count.get(sev, 0) + 1

    # 리뷰 큐 통계
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )
    queue_stats = queue.stats()

    summary = f"""
═══════════════════════════════════════════════════
 LangGraph 파이프라인 실행 리포트
═══════════════════════════════════════════════════
 채널: {state['channel']}
 모드: {'DRY RUN' if state.get('dry_run') else 'PRODUCTION'}
 총 비디오: {len(state.get('video_ids', []))}개
 검증 실패 제외: {len(unique_failed)}개
 품질 점수: {state.get('quality_score', 0):.1%}
───────────────────────────────────────────────────
 실행 시간:
{chr(10).join(timing_lines)}
  ────────────
  총 소요: {total_time:.0f}s ({total_time/60:.1f}m)
───────────────────────────────────────────────────
 검증 결과:
  ERROR: {error_count['error']}건
  WARNING: {error_count['warning']}건
  INFO: {error_count['info']}건
───────────────────────────────────────────────────
 리뷰 큐:
  대기: {queue_stats['pending']}건
  승인: {queue_stats['approved']}건
  거부: {queue_stats['rejected']}건
  수정: {queue_stats['modified']}건
═══════════════════════════════════════════════════
"""

    _log("summary", summary)
    return {"summary": summary.strip()}
