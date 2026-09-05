"""Opt-in Collector crash/restart proof using only disposable fixture resources.

No published ports, real logs, credentials or existing Compose stack are used.
"""
import os
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4

import yaml

ROOT = Path(__file__).resolve().parents[3]
SINK_IMAGE = 'python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea'
SINK = r'''
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import gzip, re
class Sink(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.headers.get('Content-Encoding') == 'gzip': body = gzip.decompress(body)
        markers = re.findall(rb'00000000-0000-4000-8000-[0-9]{12}', body)
        with open('/fixture/payloads', 'ab') as f: f.write(body + b'\n')
        fail = Path('/fixture/fail').exists()
        with open('/fixture/attempts', 'a') as f:
            for marker in markers: f.write(marker.decode() + '\n')
        if not fail:
            with open('/fixture/delivered', 'a') as f:
                for marker in markers: f.write(marker.decode() + '\n')
        self.send_response(503 if fail else 200)
        self.send_header('Content-Type', 'application/x-protobuf')
        self.send_header('Content-Length', '0')
        self.end_headers()
HTTPServer(('0.0.0.0', 3100), Sink).serve_forever()
'''


class StorageContractTests(unittest.TestCase):
    def test_offsets_and_export_queue_share_persistent_storage_under_unprivileged_collector(self):
        config = yaml.safe_load((ROOT / 'backend/pipeline-control/otel-collector.yaml').read_text())
        compose = yaml.safe_load((ROOT / 'backend/pipeline-control/docker-compose.observability.yml').read_text())
        self.assertEqual(config['receivers']['filelog']['storage'], 'file_storage')
        self.assertEqual(config['receivers']['filelog']['start_at'], 'end')
        self.assertEqual(config['service']['pipelines']['logs']['processors'],
                         ['transform/parse', 'filter/admitted', 'transform/minimize'])
        self.assertEqual(config['exporters']['otlphttp/loki_minimized_v1']['sending_queue']['storage'], 'file_storage')
        for stage in (config['receivers']['filelog'], config['exporters']['otlphttp/loki_minimized_v1']):
            self.assertEqual(stage['retry_on_failure'], {'enabled': True, 'max_elapsed_time': '0s'})
        service = compose['services']['otel-collector']
        self.assertEqual(service['user'], '10001:10001')
        self.assertIn('otel-storage:/var/lib/otelcol', service['volumes'])
        self.assertEqual(service['depends_on']['otel-storage-init']['condition'], 'service_completed_successfully')


@unittest.skipUnless(os.environ.get('TZUDONG_TEST_OTEL_RESTART') == '1', 'disposable Docker test opt-in absent')
class CollectorRestartTests(unittest.TestCase):
    def docker(self, *args, check=True):
        result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=60)
        if check and result.returncode:
            self.fail('fixture_docker_operation_failed:' + args[0])
        return result.stdout.strip()

    def await_marker(self, file, marker):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if file.exists() and marker in file.read_text().splitlines():
                return
            time.sleep(0.1)
        self.fail('fixture_marker_not_observed:' + marker)

    def test_pending_export_and_downtime_lines_survive_sigkill_without_replaying_checkpoint(self):
        prefix = 'tzotel-test-' + uuid4().hex[:12]
        network, volume = prefix + '-net', prefix + '-store'
        collector, sink = prefix + '-collector', prefix + '-sink'
        # The repository is shared with desktop Docker VMs; macOS /var/folders
        # is not necessarily mounted and can silently become an empty VM path.
        with tempfile.TemporaryDirectory(prefix='.tzotel-fixture-', dir=ROOT) as raw:
            path = Path(raw)
            path.chmod(0o755)
            logs = path / 'logs'
            logs.mkdir(mode=0o755)
            logs.chmod(0o755)
            log = logs / 'fixture.log'
            def marker(index):
                return f'00000000-0000-4000-8000-{index:012d}'
            def line(index, **fields):
                return json.dumps({'component': 'backend_runtime', 'severity': 'info',
                    'type': 'run.lifecycle', 'occurred_at': '2026-09-05T00:00:00Z',
                    'correlation_id': marker(index), **fields}) + '\n'
            # Existing logs on a fresh volume must not be replayed.
            log.write_text(line(0) * 10)
            log.chmod(0o644)
            (path / 'sink.py').write_text(SINK)
            cfg = yaml.safe_load((ROOT / 'backend/pipeline-control/otel-collector.yaml').read_text())
            cfg['exporters']['otlphttp/loki_minimized_v1']['endpoint'] = 'http://fixture-sink:3100/otlp'
            config = path / 'config.yaml'
            config.write_text(yaml.safe_dump(cfg))
            config.chmod(0o644)
            compose = yaml.safe_load((ROOT / 'backend/pipeline-control/docker-compose.observability.yml').read_text())
            image = compose['services']['otel-collector']['image']
            try:
                self.docker('network', 'create', '--internal', network)
                self.docker('volume', 'create', volume)
                self.docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                            '--cap-add', 'CHOWN', '--user', '0:0', '-v', volume + ':/var/lib/otelcol',
                            compose['services']['otel-storage-init']['image'],
                            'chown', '10001:10001', '/var/lib/otelcol')
                sink_image = self.docker('image', 'inspect', SINK_IMAGE, '--format', '{{.Id}}')
                self.docker('run', '-d', '--name', sink, '--network', network, '--network-alias', 'fixture-sink',
                            '-v', raw + ':/fixture', sink_image, 'python', '/fixture/sink.py')
                def start():
                    self.docker('run', '-d', '--name', collector, '--network', network, '--user', '10001:10001',
                                '-v', str(config) + ':/etc/otelcol/config.yaml:ro',
                                '-v', str(logs) + ':/var/log/tzudong:ro',
                                '-v', volume + ':/var/lib/otelcol', image, '--config=/etc/otelcol/config.yaml')
                start()
                # Allow the first receiver scan to checkpoint the pre-existing
                # file before writing the first new record (200ms poll default).
                time.sleep(1)
                with log.open('a') as f:
                    f.write(line(1, message='FORBIDDEN_fixture_message',
                                 password='FORBIDDEN_fixture_credential',
                                 nested={'email': 'FORBIDDEN_fixture_contact'}))
                    f.write('FORBIDDEN_fixture_raw_diagnostic\n')
                    f.write('null\n[]\n42\n')
                    f.write(line(4, component='FORBIDDEN_fixture_component'))
                    f.write(line(5, correlation_id='FORBIDDEN_fixture_identifier'))
                self.await_marker(path / 'delivered', marker(1))
                (path / 'fail').touch()
                with log.open('a') as f:
                    f.write(line(2, message='FORBIDDEN_fixture_pending'))
                self.await_marker(path / 'attempts', marker(2))
                self.docker('kill', '--signal', 'KILL', collector)
                self.docker('rm', collector)
                with log.open('a') as f:
                    f.write(line(3, occurred_at='2026-09-05T00:00:00+00:00'))
                (path / 'fail').unlink()
                start()
                for expected in (marker(2), marker(3)):
                    self.await_marker(path / 'delivered', expected)
                delivered = (path / 'delivered').read_text().splitlines()
                self.assertEqual(set(delivered), {marker(1), marker(2), marker(3)})
                self.assertEqual(delivered.count(marker(1)), 1)
                self.assertNotIn(b'FORBIDDEN_fixture_', (path / 'payloads').read_bytes())
                self.assertNotIn(b'fixture.log', (path / 'payloads').read_bytes())
                # A pre-redaction exporter queue must not bypass the new
                # processors during an upgrade. Seed only synthetic legacy data.
                self.docker('kill', '--signal', 'KILL', collector)
                self.docker('rm', collector)
                legacy = yaml.safe_load(config.read_text())
                legacy['exporters']['otlphttp/loki'] = legacy['exporters'].pop('otlphttp/loki_minimized_v1')
                legacy['service']['pipelines']['logs']['exporters'] = ['otlphttp/loki']
                legacy['service']['pipelines']['logs'].pop('processors')
                config.write_text(yaml.safe_dump(legacy))
                (path / 'fail').touch()
                start()
                time.sleep(0.5)
                with log.open('a') as f:
                    f.write(line(9, message='FORBIDDEN_fixture_legacy_queue'))
                self.await_marker(path / 'attempts', marker(9))
                self.docker('kill', '--signal', 'KILL', collector)
                self.docker('rm', collector)
                config.write_text(yaml.safe_dump(cfg))
                (path / 'payloads').write_bytes(b'')
                (path / 'fail').unlink()
                start()
                with log.open('a') as f:
                    f.write(line(6))
                self.await_marker(path / 'delivered', marker(6))
                time.sleep(1)
                self.assertNotIn(marker(9), (path / 'delivered').read_text().splitlines())
                self.assertNotIn(b'FORBIDDEN_fixture_', (path / 'payloads').read_bytes())
            finally:
                self.docker('rm', '-f', collector, sink, check=False)
                self.docker('volume', 'rm', volume, check=False)
                self.docker('network', 'rm', network, check=False)


if __name__ == '__main__':
    unittest.main()
