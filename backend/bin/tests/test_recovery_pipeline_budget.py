"""Bounded recovery shares the existing daily provider budget, no hosted calls."""
import contextlib
import io
import unittest
from unittest.mock import patch

from backend.bin import run_hosted_new_video_pipeline as runner
from backend.bin import run_restaurant_evidence_recovery as recovery


class RecoveryPipelineBudgetTests(unittest.TestCase):
    def invoke(self, limit, manual, legacy, dry=False):
        args = ['--review-automation', '--evidence-recovery', '--limit', str(limit)]
        if dry:
            args.append('--dry-run')
        with patch.object(runner, '_load_backend_env'), patch.object(runner, 'cadence_source_preflight'), \
                patch.object(runner, 'env_contract_preflight'), patch.object(runner, '_apply_local_runtime_environment'), \
                patch.object(runner, '_recovery_reserved_slot', return_value=manual) as manual_run, \
                patch.object(runner, '_review_reserved_slot', return_value=legacy) as legacy_run, \
                patch.object(runner, '_run', return_value=0) as commands, contextlib.redirect_stdout(io.StringIO()):
            code = runner.main(args)
        self.assertEqual(code, 0)
        return manual_run, legacy_run, [call.args[0] for call in commands.call_args_list]

    def test_manual_and_legacy_rechecks_leave_one_new_video_slot(self):
        manual, legacy, commands = self.invoke(3, runner.ReviewReservation(1, True), runner.ReviewReservation(1, True))
        manual.assert_called_once_with('tzuyang')
        legacy.assert_called_once_with()
        evaluate = next(c for c in commands if c[1] == str(runner.EVALUATE))
        self.assertEqual(evaluate[evaluate.index('--limit') + 1], '1')
        followup = [c for c in commands if c[1] == str(runner.REVIEW)]
        self.assertEqual(followup[0][followup[0].index('--recheck-limit') + 1], '0')

    def test_empty_manual_queue_keeps_original_two_or_three_new_slots(self):
        for legacy_slots in (0, 1):
            with self.subTest(legacy_slots=legacy_slots):
                _, legacy, commands = self.invoke(3, runner.ReviewReservation(0, True), runner.ReviewReservation(legacy_slots, True))
                legacy.assert_called_once_with()
                evaluate = next(c for c in commands if c[1] == str(runner.EVALUATE))
                self.assertEqual(evaluate[evaluate.index('--limit') + 1], str(3 - legacy_slots))

    def test_one_slot_limit_never_dispatches_second_paid_recheck_or_new_video(self):
        _, legacy, commands = self.invoke(1, runner.ReviewReservation(1, False), runner.ReviewReservation(1, False))
        legacy.assert_not_called()
        self.assertFalse(any(c[1] == str(runner.EVALUATE) for c in commands))
        self.assertFalse(any(c[1] == str(runner.REVIEW) for c in commands))

    def test_dry_run_neither_selects_nor_claims_recovery(self):
        manual, legacy, commands = self.invoke(3, runner.ReviewReservation(1, True), runner.ReviewReservation(1, True), dry=True)
        manual.assert_not_called()
        legacy.assert_not_called()
        evaluate = next(c for c in commands if c[1] == str(runner.EVALUATE))
        self.assertEqual(evaluate[evaluate.index('--limit') + 1], '3')
        self.assertIn('--dry-run', evaluate)

    def test_unknown_or_contradictory_receipt_keeps_one_reserved_slot(self):
        cases = [None, {}, {'schemaVersion': 1, 'reserved_slots': False},
                 recovery.report(None, 'idle', 'queue_empty', attempted=True),
                 recovery.report(None, 'idle', 'queue_empty', outstanding=True),
                 recovery.report(None, 'idle', 'queue_empty', paid_attempted=True),
                 recovery.report('fixture', 'draft', 'draft_confirmed')]
        for result in cases:
            with self.subTest(result=result), patch.object(recovery, 'resolve_privileged_supabase_rest_credentials'), \
                    patch.object(recovery, 'RestTransport'), patch.object(recovery, 'run_next_recovery', return_value=result):
                self.assertEqual(runner._recovery_reserved_slot('tzuyang'), runner.ReviewReservation(1, False))

    def test_confirmed_empty_and_draft_receipts(self):
        for result, expected in [(recovery.report(None, 'idle', 'queue_empty'), runner.ReviewReservation(0, True)),
                                 (recovery.report('fixture', 'draft', 'draft_confirmed', attempted=True, reserved_slots=1, paid_attempted=True), runner.ReviewReservation(1, True))]:
            with self.subTest(result=result), patch.object(recovery, 'resolve_privileged_supabase_rest_credentials'), \
                    patch.object(recovery, 'RestTransport'), patch.object(recovery, 'run_next_recovery', return_value=result):
                self.assertEqual(runner._recovery_reserved_slot('tzuyang'), expected)

    def test_recovery_flag_alone_does_not_load_credentials_or_start_work(self):
        with patch.object(runner, '_load_backend_env') as load, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(['--evidence-recovery']), 2)
        load.assert_not_called()

    def test_unsupported_recovery_channel_stops_before_environment_or_any_work(self):
        for dry in (False, True):
            args = ['--review-automation', '--evidence-recovery', '--channel', 'meatcreator']
            if dry:
                args.append('--dry-run')
            with self.subTest(dry=dry), patch.object(runner, '_load_backend_env') as load, \
                    patch.object(runner, '_recovery_reserved_slot') as recovery_run, \
                    patch.object(runner, '_run') as command, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(args), 2)
            load.assert_not_called()
            recovery_run.assert_not_called()
            command.assert_not_called()

    def test_general_other_channel_pipeline_keeps_its_existing_dry_run(self):
        with patch.object(runner, '_load_backend_env'), patch.object(runner, 'cadence_source_preflight'), \
                patch.object(runner, 'env_contract_preflight'), patch.object(runner, '_apply_local_runtime_environment'), \
                patch.object(runner, '_recovery_reserved_slot') as recovery_run, \
                patch.object(runner, '_run', return_value=0) as commands, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(['--channel', 'meatcreator', '--dry-run']), 0)
        recovery_run.assert_not_called()
        evaluate = next(call.args[0] for call in commands.call_args_list if call.args[0][1] == str(runner.EVALUATE))
        self.assertEqual(evaluate[evaluate.index('--channel') + 1], 'meatcreator')


if __name__ == '__main__':
    unittest.main()
