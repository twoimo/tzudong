"""One process-local stdio lock broker; OS locks still span Node processes.

No network, inference, prompts, or persistent job queue. The parent's stdin
closing ends this broker immediately and releases every held lock.
"""
import json
import os
from pathlib import Path
import sys
import threading

from backend.utils.stage_cache import stage_lock


def main():
    writers=threading.Lock();state=threading.Lock()
    permits=threading.BoundedSemaphore(8)
    held={}

    def reply(identity, ok):
        try:
            with writers:
                print(json.dumps({'id':identity,'ok':ok}),flush=True)
        except (OSError,ValueError):
            os._exit(1)

    def acquire(identity, receipt):
        lock=None
        try:
            lock=stage_lock(receipt);lock.__enter__()
            with state:held[identity]=lock
            reply(identity,True)
        except (OSError,ValueError):
            if lock is not None:
                try:lock.__exit__(None,None,None)
                except (OSError,ValueError):pass
            reply(identity,False)
        finally:
            permits.release()

    for line in iter(lambda:sys.stdin.buffer.readline(16384),b''):
        value=None
        try:
            value=json.loads(line)
            identity=value['id']
            if type(identity) is not int or identity<1:raise ValueError()
            if value.get('operation')=='acquire':
                receipt=Path(value['receipt'])
                if not receipt.is_absolute() or receipt.name!='.receipt.json':raise ValueError()
                if not permits.acquire(blocking=False):
                    reply(identity,False);continue
                threading.Thread(target=acquire,args=(identity,receipt),daemon=True).start()
            elif value.get('operation')=='release':
                with state:lock=held.pop(value['lockId'],None)
                if lock is None:raise ValueError()
                lock.__exit__(None,None,None);reply(identity,True)
            else:raise ValueError()
        except (KeyError,TypeError,ValueError,OSError):
            reply(value.get('id',0) if isinstance(value,dict) else 0,False)
    # Daemon threads can be waiting for another process. EOF must never leave
    # those threads or previously acquired file descriptors alive after a crash.
    os._exit(0)


if __name__=='__main__':main()
