"""Verify the project-pinned Chrome for Testing executable without browser state."""
import argparse
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys


def verify(executable: str) -> Path:
    root = Path(__file__).resolve().parents[2]
    contract = json.loads((root / '.github/chrome-for-testing.v1.json').read_text())
    if (set(contract) != {'schemaVersion', 'product', 'version', 'playwrightVersion'}
            or contract['schemaVersion'] != 1 or contract['product'] != 'Google Chrome for Testing'
            or not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', contract['version'])):
        raise ValueError('CHROME_FOR_TESTING_PIN_UNVERIFIED')
    path = Path(executable)
    if not path.is_absolute() or not path.is_file() or path.is_symlink() or path.resolve() != path:
        raise ValueError('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED')
    if sys.platform == 'darwin':
        with (path.parent.parent / 'Info.plist').open('rb') as handle:
            info = plistlib.load(handle)
        if (info.get('CFBundleIdentifier') != 'com.google.chrome.for.testing'
                or info.get('CFBundleShortVersionString') != contract['version']
                or info.get('CFBundleExecutable') != path.name):
            raise ValueError('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED')
    elif sys.platform.startswith('linux'):
        if path.name != 'chrome':
            raise ValueError('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED')
        result = subprocess.run([str(path), '--version'], capture_output=True, text=True, timeout=10, check=True)
        if result.stdout.strip() != f"{contract['product']} {contract['version']}":
            raise ValueError('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED')
    else:
        raise ValueError('CHROME_FOR_TESTING_PLATFORM_UNSUPPORTED')
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable', required=True)
    arguments = parser.parse_args()
    try:
        print(verify(arguments.executable))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED', file=sys.stderr)
        raise SystemExit(1)
