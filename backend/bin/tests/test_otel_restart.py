"""Opt-in Collector crash/restart proof using only disposable fixture resources.

No published ports, real logs, credentials or existing Compose stack are used.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4

import yaml

ROOT = Path(__file__).resolve().parents[3]
SINK = r'''
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import gzip, re
class Sink(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.headers.get('Content-Encoding') == 'gzip': body = gzip.decompress(body)
        markers = re.findall(rb'TZOTEL_FIXTURE_[a-z]+', body)
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
        self.assertEqual(config['receivers']['filelog']['start_at'], 'beginning')
        self.assertEqual(config['exporters']['otlphttp/loki']['sending_queue']['storage'], 'file_storage')
        for stage in (config['receivers']['filelog'], config['exporters']['otlphttp/loki']):
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
            log.write_text('TZOTEL_FIXTURE_delivered\n')
            log.chmod(0o644)
            (path / 'sink.py').write_text(SINK)
            cfg = yaml.safe_load((ROOT / 'backend/pipeline-control/otel-collector.yaml').read_text())
            cfg['exporters']['otlphttp/loki']['endpoint'] = 'http://fixture-sink:3100/otlp'
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
                sink_image = self.docker('image', 'inspect', 'python:3.12-slim', '--format', '{{.Id}}')
                self.docker('run', '-d', '--name', sink, '--network', network, '--network-alias', 'fixture-sink',
                            '-v', raw + ':/fixture', sink_image, 'python', '/fixture/sink.py')
                def start():
                    self.docker('run', '-d', '--name', collector, '--network', network, '--user', '10001:10001',
                                '-v', str(config) + ':/etc/otelcol/config.yaml:ro',
                                '-v', str(logs) + ':/var/log/tzudong:ro',
                                '-v', volume + ':/var/lib/otelcol', image, '--config=/etc/otelcol/config.yaml')
                start()
                self.await_marker(path / 'delivered', 'TZOTEL_FIXTURE_delivered')
                (path / 'fail').touch()
                with log.open('a') as f:
                    f.write('TZOTEL_FIXTURE_pending\n')
                self.await_marker(path / 'attempts', 'TZOTEL_FIXTURE_pending')
                self.docker('kill', '--signal', 'KILL', collector)
                self.docker('rm', collector)
                with log.open('a') as f:
                    f.write('TZOTEL_FIXTURE_downtime\n')
                (path / 'fail').unlink()
                start()
                for marker in ('TZOTEL_FIXTURE_pending', 'TZOTEL_FIXTURE_downtime'):
                    self.await_marker(path / 'delivered', marker)
                delivered = (path / 'delivered').read_text().splitlines()
                self.assertEqual(set(delivered), {'TZOTEL_FIXTURE_delivered', 'TZOTEL_FIXTURE_pending', 'TZOTEL_FIXTURE_downtime'})
                self.assertEqual(delivered.count('TZOTEL_FIXTURE_delivered'), 1)
            finally:
                self.docker('rm', '-f', collector, sink, check=False)
                self.docker('volume', 'rm', volume, check=False)
                self.docker('network', 'rm', network, check=False)


if __name__ == '__main__':
    unittest.main()
