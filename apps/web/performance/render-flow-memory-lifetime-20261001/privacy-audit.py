"""Known-byte audit. Private values stay in memory; output only aggregate counts."""
from pathlib import Path
import datetime
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parent
app = root.parent.parent
label = sys.argv[1]
if not re.fullmatch(r"[a-z0-9-]+", label):
    raise SystemExit("new immutable label required")
needles = set()
for name in (".env.local", ".env.production.local", ".env.masked-backup.local"):
    path = app / name
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                value = line.split("=", 1)[1].strip().strip("\"'")
                if len(value) >= 8 and "*" not in value and value.lower() not in {"[sensitive]", "[encrypted]", "[redacted]"}:
                    needles.add(value.encode())
contact = re.search(r"email:\s*process\.env\.NEXT_PUBLIC_SUPPORT_EMAIL\s*\|\|\s*['\"]([^'\"]+)", (app / "lib/site-config.ts").read_text())
if contact:
    needles.add(contact[1].encode())
try:
    rows = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=5).stdout.splitlines()[1:]
    for row in rows:
        columns = row.split()
        if len(columns) > 1:
            needles.add(columns[0].encode())
            if columns[1] == "device":
                serial = subprocess.run(["adb", "-s", columns[0], "shell", "getprop", "ro.serialno"], capture_output=True, timeout=5).stdout.strip()
                if serial:
                    needles.add(serial)
except (OSError, subprocess.TimeoutExpired):
    pass
matches = []
files = sorted(p for p in root.rglob("*") if p.is_file())
for file in files:
    data = file.read_bytes()
    if any(needle in data for needle in needles):
        matches.append(str(file.relative_to(root)))
result = {
    "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "filesScanned": len(files),
    "knownConfigurationDeviceIdentityAndPublicContactMatches": len(matches),
    "paths": matches,
    "needleValuesSaved": False,
    "knownMaskPlaceholdersExcluded": True,
    "limits": ["Known-byte scan plus collector design and inspected screenshots, not exhaustive PII detection", "No cookies/headers/private response bodies/localstorage/heap objects retained"],
}
with (root / (label + ".json")).open("x") as output:
    json.dump(result, output, indent=2)
    output.write("\n")
print(json.dumps(result))
if matches:
    raise SystemExit(1)
