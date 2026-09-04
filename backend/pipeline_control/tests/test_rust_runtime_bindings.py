"""Actual migrated public call sites, including native builds when required."""
from __future__ import annotations
import importlib.util
import os
import runpy
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from backend.pipeline_control import impl_selector as selector
from backend.pipeline_control import rust_parity
from backend.pipeline_control import state_machine, batch_upsert, graph
from backend.pipeline import validators, state
from backend.utils import data_utils

ROOT = Path(__file__).resolve().parents[3]
SLICES = 'R1-validators,R2-normalize,R3-upsert-payload,R4-media-compute,R5-pipeline-graph'
MODULES = ('tzudong_validators','tzudong_normalize','tzudong_upsert_payload','tzudong_media_compute','tzudong_pipeline_graph')
NATIVE = all(importlib.util.find_spec(name) is not None for name in MODULES)


class RuntimeRoutingTests(unittest.TestCase):
    def test_default_python_never_initializes_native_modules(self):
        with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':''}), mock.patch.object(selector,'load_rust') as loader:
            self.assertEqual(data_utils.parse_folder_date('26-09-05').year, 2026)
            self.assertTrue(state_machine.can_pause('Queued'))
            self.assertIsInstance(validators.validate_selection('v', {}), list)
            loader.assert_not_called()

    def test_python_parity_reference_cannot_be_redirected_to_rust(self):
        @selector.rust_dispatch('R1-validators')
        def marker():
            return 1
        with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':'R1-validators'}), mock.patch.object(selector,'load_rust',return_value=SimpleNamespace(marker=lambda:2)):
            self.assertEqual(marker(), 2)
            result = rust_parity.run_parity('R1-validators','binding',{},
                python_impl=lambda _: {'value':marker()}, rust_impl=lambda _: {'value':2}, rust_artifact_id='test-artifact')
            self.assertFalse(result['matched'])
            self.assertEqual(result['mismatch_fields'], ['value'])
            self.assertIsNone(result['result_code'])

    def test_missing_selected_native_function_never_falls_back(self):
        with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':'R2-normalize'}), mock.patch.object(selector,'load_rust',return_value=SimpleNamespace()):
            with self.assertRaises(selector.SelectorError):
                data_utils.parse_folder_date('26-09-05')


@unittest.skipUnless(NATIVE or os.environ.get('TZUDONG_REQUIRE_RUST_CALL_SITES')=='1', 'five native extensions not installed')
class NativeCallSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not NATIVE:
            raise AssertionError('required_native_call_site_builds_missing')
        cls.chunk = runpy.run_path(str(ROOT/'backend/restaurant-crawling/scripts/chunk_planner.py'), run_name='rust_runtime_binding_fixture')

    def test_all_five_slices_execute_through_real_public_call_sites(self):
        calls = [
            ('R1-validators', lambda: validators.validate_gemini_output('video',{})),
            ('R1-validators', lambda: validators.validate_selection('video',{})),
            ('R1-validators', lambda: validators.validate_rule_results('video',{})),
            ('R1-validators', lambda: validators.validate_laaj_results('video',{})),
            ('R1-validators', lambda: validators.cross_validate('video',{},{})),
            ('R1-validators', lambda: validators.validate_transform_output('video',[])),
            ('R1-validators', lambda: validators.has_blocking_errors([])),
            ('R1-validators', lambda: validators.error_summary([])),
            ('R1-validators', lambda: state.create_initial_state('tzuyang','crawl','evaluate')),
            ('R2-normalize', lambda: data_utils.parse_folder_date('26-09-05')),
            ('R2-normalize', lambda: data_utils.parse_folder_date('26-02-30')),
            ('R3-upsert-payload', lambda: state_machine.payload_hash({'b':2,'a':'한글'})),
            ('R4-media-compute', lambda: self.chunk['compute_chunk_duration'](2400)),
            ('R4-media-compute', lambda: self.chunk['align_to_subtitle_boundary'](10,[])),
            ('R4-media-compute', lambda: self.chunk['format_transcript_range']([],0,10)),
            ('R4-media-compute', lambda: self.chunk['plan_chunks']('video',2400,[])),
            ('R5-pipeline-graph', lambda: state_machine.lock_key('target','lite_gha')),
            ('R5-pipeline-graph', lambda: state_machine.can_pause('Queued')),
            ('R5-pipeline-graph', lambda: state_machine.can_cancel('Succeeded')),
            ('R5-pipeline-graph', lambda: state_machine.can_resume('Paused')),
            ('R5-pipeline-graph', lambda: graph.step_class('03-transcript')),
            ('R5-pipeline-graph', lambda: graph.validate_step_classes()),
            ('R5-pipeline-graph', lambda: graph.validate_graph()),
        ]
        for slice_id, operation in calls:
            with self.subTest(slice=slice_id):
                with selector.python_reference():
                    expected = operation()
                with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':SLICES}), mock.patch.object(selector,'load_rust',wraps=selector.load_rust) as loader:
                    self.assertEqual(operation(), expected)
                    self.assertTrue(any(call.args[0] == slice_id for call in loader.call_args_list))

    def test_selected_batch_limit_is_checked_before_any_database_connection(self):
        with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':'R3-upsert-payload'}), mock.patch.object(batch_upsert,'connection') as connection:
            with self.assertRaises(batch_upsert.BatchUpsertError) as error:
                batch_upsert.apply_restaurant_batch([{}]*201)
            self.assertEqual(error.exception.code, 'batch_upsert_limit')
            connection.assert_not_called()

    def test_state_adapters_preserve_python_object_updates_and_bounded_errors(self):
        with mock.patch.dict(os.environ, {'TZUDONG_RUST_SLICES':'R5-pipeline-graph'}):
            run = SimpleNamespace(status='Queued',lease_until=0,heartbeat_at=0)
            self.assertIs(state_machine.apply_transition(run,'pause',10,20), run)
            self.assertEqual((run.status,run.lease_until,run.heartbeat_at), ('Paused',30,10))
            self.assertFalse(state_machine.stale_reclaim_eligible(run,100))
            self.assertIs(state_machine.heartbeat(run,11,20),run)
            with self.assertRaises(state_machine.ControlPlaneError) as error:
                state_machine.apply_transition(run,'unknown',11,20)
            self.assertEqual(error.exception.code,'illegal_transition')
            with self.assertRaises(graph.AdapterGraphError):
                graph.step_class('unknown')


if __name__ == '__main__':
    unittest.main()
