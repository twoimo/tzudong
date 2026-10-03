"""Preserve only previously inspected, session-owned native PNGs byte for byte."""
import datetime
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
trial = (root / sys.argv[1]).resolve()
assert trial.is_relative_to(root.resolve())
assert sys.argv[2] == "--confirm-reviewed-all-seven"
raw = json.loads((trial / "raw.json").read_text())
assert raw["passed"] and len(raw["cycles"]) == 60
frames = [{"cycle": 0, "temporaryPath": raw["nativeScreenshotTemporary"]}] + raw["nativeValidationFrames"]
assert [frame["cycle"] for frame in frames] == list(range(0, 61, 10))
destination = trial / "native-inspected"
destination.mkdir()
captures = []
for frame in frames:
    path = Path(frame["temporaryPath"])
    assert path.parent == Path("/tmp") and path.name.startswith("tzudong-owned-")
    assert not path.is_symlink()
    content = path.read_bytes()
    assert content.startswith(b"\x89PNG\r\n\x1a\n")
    output = destination / f'cycle-{frame["cycle"]:03d}.png'
    with output.open("xb") as handle:
        handle.write(content)
    digest = hashlib.sha256(content).hexdigest()
    assert hashlib.sha256(output.read_bytes()).hexdigest() == digest
    captures.append({"file": str(output.relative_to(root)), "sha256": digest,
                     "cycle": frame["cycle"], "capturedAt": frame.get("capturedAt"),
                     "inspected": True, "actualMapAndSyntheticListVisible": True,
                     "privateDataSeen": False})
receipt = {"observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "captures": captures, "nativeCurrentFocusCheckedEachCycle": True,
           "noOSShadeSeenInObservedFrames": True, "notIndependentUsers": True,
           "originalRawUntouched": True,
           "limits": "start and each10cycles; transient overlays/flicker between captures not excluded",
           "ownedTemporaryRemovalVerified": False}
for frame in frames:
    Path(frame["temporaryPath"]).unlink()
receipt["ownedTemporaryRemovalVerified"] = all(not Path(frame["temporaryPath"]).exists() for frame in frames)
with (trial / "native-inspection-v1.json").open("x") as handle:
    json.dump(receipt, handle, indent=2)
    handle.write("\n")
print(json.dumps({"nativeFramesPreserved": len(captures), "bytesUnchanged": True,
                  "ownedTemporaryRemovalVerified": receipt["ownedTemporaryRemovalVerified"]}))
