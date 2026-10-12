"""Recalculate in a fresh directory without changing retained inputs."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def require(ok, code):
    if not ok:
        raise ValueError(code)

def main():
    require(sys.version_info[:3] == (3, 12, 14), 'PINNED_PYTHON_REQUIRED')
    paths = [ROOT / 'aggregate-browser-v7.py', ROOT / 'browser-confirm-plan-v7.json',
             ROOT / 'browser-series-final-v7.json', ROOT / 'browser-confirm-summary-v7.json']
    paths += sorted(ROOT.glob('ui-*/raw.json'))
    before = {p.relative_to(ROOT).as_posix(): digest(p) for p in paths}
    require(len(list(ROOT.glob('ui-*/raw.json'))) == 22, 'PROCESS_INVENTORY_DENIED')
    with tempfile.TemporaryDirectory(prefix='tzudong-stats-independent-') as temporary:
        out = Path(temporary)
        for p in paths:
            if p.name == 'browser-confirm-summary-v7.json':
                continue
            destination = out / p.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, destination)
        run = subprocess.run([sys.executable, '-O', str(out / 'aggregate-browser-v7.py')],
                             text=True, capture_output=True, check=True)
        require((out / 'browser-confirm-summary-v7.json').read_bytes() ==
                (ROOT / 'browser-confirm-summary-v7.json').read_bytes(), 'STATISTICS_DRIFT')
        require(before == {p.relative_to(ROOT).as_posix(): digest(p) for p in paths},
                'INPUT_MUTATION_DENIED')
    result = {'status': 'passed', 'sameBytes': True, 'summarySha256': digest(paths[3]),
              'runtime': '3.12.14', 'optimizedMode': True, 'rawProcesses': 22,
              'originalDataUnchanged': True, 'performanceAdmission': 0, 'fieldAdmission': 0}
    with (ROOT / 'independent-statistics-rerun-v1.json').open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
