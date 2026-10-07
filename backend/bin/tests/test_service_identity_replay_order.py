import shutil
import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]


class ServiceIdentityReplayOrderTests(unittest.TestCase):
    def test_replays_each_migration_once_after_both_declared_prerequisites(self):
        source=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        block=source.split('effective_migrations=()\n',1)[1].split('initialization_inputs=',1)[0]
        previous='20260417_prevent_active_restaurant_identity_duplicates.sql'
        successor='20260417_harden_submission_identity_duplicate_checks.sql'
        repair='20261003095444_restore_service_identity_helpers.sql'
        registry='20261003065736_g014_current_service_rpc_registry.sql'
        names=sorted([previous,successor,repair,registry,'20260820040000_pipeline_batch_upsert.sql','20261003081915_restaurant_review_automation.sql'])
        prefix='set -euo pipefail\n'
        for key,value in [('migration_order_predecessor',previous),('migration_order_successor',successor),('service_identity_predecessor',repair),('service_identity_successor',registry)]:prefix+=key+'='+value+'\n'
        prefix+='declare -A applied_migrations_by_name=()\napplied_migrations=()\neffective_migrations=()\n'
        for name in names:prefix+='applied_migrations+=('+name+'); applied_migrations_by_name['+name+']='+name+'\n'
        program=prefix+block+'printf "%s\\n" "${effective_migrations[@]}"\n'
        result=subprocess.run([shutil.which('bash') or 'bash','-c',program],capture_output=True,text=True,check=True)
        actual=result.stdout.splitlines()
        self.assertEqual(sorted(actual),names)
        self.assertEqual(len(actual),len(set(actual)))
        self.assertLess(actual.index(previous),actual.index(successor))
        self.assertLess(actual.index('20260820040000_pipeline_batch_upsert.sql'),actual.index(repair))
        self.assertLess(actual.index(repair),actual.index(registry))
        self.assertLess(actual.index(registry),actual.index('20261003081915_restaurant_review_automation.sql'))


if __name__=='__main__':unittest.main()
