import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
LAUNCHER = ROOT / "backend/supabase/tests/g038_phase2b_qualify.sh"


class LauncherContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = LAUNCHER.read_text(encoding="utf-8")

    def ordered(self, *tokens):
        positions = [self.source.index(token) for token in tokens]
        self.assertEqual(positions, sorted(positions))

    def test_o0_defense_in_depth_and_closed_arguments(self):
        self.assertIn("--expected-content-map-sha256", self.source)
        self.assertIn("/usr/bin/shasum -a 256 -c -- \"$MAP\"", self.source)
        self.assertIn("validate-manifest", self.source)
        self.assertIn("source-preflight", self.source)
        self.assertIn("g038_exclusion_scan.py", self.source)
        self.assertIn("case \"$1\"", self.source)
        self.assertIn("*) usage;;", self.source)

    def test_no_network_mount_port_and_only_two_copy_ins(self):
        create_line = next(
            line for line in self.source.splitlines() if '"$DOCKER" create ' in line
        )
        self.assertIn("\"$DOCKER\" create --pull never --network none --env-file", create_line)
        self.assertIn("'none|0|0'", self.source)
        self.assertEqual(self.source.count("\"$DOCKER\" cp \"$host\""), 1)
        self.assertIn("20260728000100_g038_deterministic_contract.sql:/tmp/p1.sql", self.source)
        self.assertIn("g038_catalog_assertions.sql:/tmp/h3.sql", self.source)
        self.assertNotIn("\"$DOCKER\" run", self.source)
        self.assertNotIn("--publish", create_line)
        self.assertNotIn("--mount", create_line)

    def test_prestart_evidence_and_image_guards_precede_start(self):
        self.ordered(
            "[ ! -e \"$EVIDENCE\" ]",
            "\"$DOCKER\" image inspect",
            "\"$DOCKER\" create --pull never",
            "\"$DOCKER\" inspect --format",
            "g038_phase2b_record.py deny",
            "\"$DOCKER\" start \"$ID\"",
        )

    def test_catalog_and_exact_three_negative_streams(self):
        self.assertIn("PASS|P1_H3_CATALOG", self.source)
        self.assertIn("PASS|INVALID_PHASE|22023|g038_invalid_phase|0|0", self.source)
        self.assertIn("PASS|CANDIDATE_IDENTIFIER|22023|g038_candidate_identifier_invalid|0|0", self.source)
        self.assertIn("PASS|ADAPTER_DIRECT_DML|42501|permission denied for table g038_deletion_commitment|0|0", self.source)
        self.assertEqual(self.source.count("\"$DOCKER\" exec -i \"$ID\" psql"), 2)

    def test_owned_cleanup_and_qualified_receipt_ordering(self):
        self.assertIn("trap on_exit EXIT", self.source)
        self.assertIn("\"$DOCKER\" rm -f -v \"$ID\"", self.source)
        self.assertIn("/bin/rm -rf -- \"$SCRATCH\"", self.source)
        self.ordered(
            "GJC_SESSION_ID=d367f506-f4bf-46b1-adf2-0945db47bb73 \"$BUN\" \"$GJC\" ultragoal status --json",
            "cleanup\n[ \"$FAIL\" -eq 0 ] || exit \"$FAIL\"",
            "backend/supabase/tests/g038_phase2b_record.py receipt --kind qualified",
        )
        self.assertIn('"satisfies":[]', self.source)
        self.assertIn('"does_not_complete_or_unblock":["G002","G003","aggregate"]', self.source)
        self.assertIn('"environment_class":"LOCAL_DISPOSABLE_ONLY"', self.source)

    def test_tamper_and_qualified_reachability_guards(self):
        self.assertIn("= \"$EXPECTED  $MAP\"", self.source)
        self.assertIn("EVIDENCE_PATH_OCCUPIED", (ROOT / "backend/supabase/tests/g038_phase2b_record.py").read_text())
        self.assertLess(
            self.source.index("/usr/bin/shasum -a 256 -c -- \"$MAP\""),
            self.source.index("\"$DOCKER\" create --pull never"),
        )
    def test_bounded_docker_and_authoritative_lifecycle_guards(self):
        self.assertIn('bounded 30 "$DOCKER" create', self.source)
        self.assertIn('bounded 2 "$DOCKER" exec "$ID" psql', self.source)
        self.assertIn('GJC_SESSION_ID=d367f506-f4bf-46b1-adf2-0945db47bb73', self.source)
        self.assertIn('"$BUN" "$GJC" ultragoal status --json', self.source)
        self.assertIn("validate-lifecycle --state-file", self.source)
        self.assertIn('"$READY"', self.source)
        self.assertIn('exact_not_found "$err" "$ID"', self.source)
        self.assertIn('[ ! -e "$EVIDENCE/run-receipt.json" ]', self.source)


if __name__ == "__main__":
    unittest.main()
