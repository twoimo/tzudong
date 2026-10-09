"""POSIX shared media admission; the exec'd tool itself owns the OS lease.

No TTL/PID reclamation. Lock files are permanent slots and must never be unlinked
while this context is in use. Tool wrappers must pass the inherited lease FD to
any child that outlives them; native FFmpeg retains it until process exit.
"""
import errno
import os
from pathlib import Path
import stat
import sys
import time


def run(directory, command, requesting_parent=None, probe=False):
    import fcntl
    root = Path(directory)
    if not root.is_absolute() or root.is_symlink():
        raise ValueError()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError()
    explicit_parent = requesting_parent is not None
    requesting_parent = os.getppid() if requesting_parent is None else requesting_parent
    if os.getppid() != requesting_parent or requesting_parent < 1 or (requesting_parent == 1 and not explicit_parent):
        return 125
    # One immutable cap for every participant; local concurrency may be lower.
    waiting_reported = False
    while True:
        if os.getppid() != requesting_parent:
            return 125
        for slot in range(4):
            fd = os.open(root / f'ffmpeg-slot-{slot}.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                    raise ValueError()
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as exc:
                    if exc.errno not in (errno.EACCES, errno.EAGAIN): raise
                    os.close(fd)
                    continue
                os.set_inheritable(fd, True)
                if probe:
                    print('MEDIA_SHARED_LEASE_ACQUIRED', file=sys.stderr, flush=True)
                env = dict(os.environ, PIPELINE_MEDIA_LEASE_FD=str(fd))
                # Same PID/group/stdio: the caller's cancellation still targets
                # the real tool. SIGKILL of the Node parent cannot free this FD.
                os.execvpe(command[0], command, env)
            except BaseException:
                os.close(fd)
                raise
        # This cancels only an unadmitted request; it never reclaims any lease.
        # Active native children retain the OS lock independently of parent PID.
        if os.getppid() != requesting_parent:
            return 125
        if probe and not waiting_reported:
            print('MEDIA_SHARED_LEASE_WAITING', file=sys.stderr, flush=True)
            waiting_reported = True
        time.sleep(0.05)


if __name__ == '__main__':
    try:
        if os.name != 'posix' or len(sys.argv) < 4: raise ValueError()
        delimiter = sys.argv.index('--')
        options = sys.argv[2:delimiter]
        parent, probe = None, False
        while options:
            flag = options.pop(0)
            if flag == '--parent': parent = int(options.pop(0))
            elif flag == '--probe': probe = True
            else: raise ValueError()
        command = sys.argv[delimiter + 1:]
        if not command: raise ValueError()
        raise SystemExit(run(sys.argv[1], command, parent, probe))
    except (OSError, ValueError, ImportError, IndexError):
        print('MEDIA_SHARED_LEASE_UNAVAILABLE', file=sys.stderr)
        raise SystemExit(125)
