"""Read-only reproduction of the two historical action pin changes."""
import argparse
import json
from pathlib import Path
import subprocess
import yaml

parser = argparse.ArgumentParser()
parser.add_argument("--repo", type=Path, default=Path("/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong"))
args = parser.parse_args()
base = "7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd"
relative = ".github/workflows/security-audit.yml"
original = yaml.safe_load(subprocess.check_output(["git", "show", f"{base}:{relative}"], cwd=args.repo, text=True))
current = yaml.safe_load((args.repo / relative).read_text())
expected = {
    "Azure/setup-helm@1a275c3b69536ee54be43f2070a358922e12c8d4": "Azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310",
    "opentofu/setup-opentofu@9d84900f3238fab8cd84ce47d658d25dd008be2f": "opentofu/setup-opentofu@a1320f892987e89d278cc92dc5adc984fb93aca4",
}
changes = []
steps = original["jobs"]["orchestration-readiness"]["steps"]
for step in steps:
    previous = step.get("uses")
    if previous not in expected:
        continue
    replacement = expected[previous]
    action_name = replacement.split("@")[0].split("/")[1]
    manifest = yaml.safe_load((Path(__file__).parent / f"{action_name}-candidate-action.yml").read_text())
    assert set(step["with"]).issubset(manifest["inputs"])
    assert manifest["runs"]["using"] == "node24"
    step["uses"] = replacement
    changes.append(replacement)
assert len(changes) == 2, changes
assert original == current, "Unexpected workflow field differences from the historical two-pin patch"
subprocess.run(["git", "diff", "--check", "--", relative], cwd=args.repo, check=True)
print(json.dumps({"status": "passed", "source_base": base, "verified_action_pins": changes, "other_workflow_fields_unchanged": True}, indent=2))
