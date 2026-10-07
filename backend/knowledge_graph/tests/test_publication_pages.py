"""Producer-admitted extrema, source reconstruction and bounded semantic pages.

These are local contract proofs, not evidence of real-video completion.
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.knowledge_graph import longform_analysis as analysis
from backend.knowledge_graph import osk_publication as publication
from backend.knowledge_graph import publication_pages as pages
from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph.tests.test_osk_publication import fixture_bundle


def reconstructed_source(specs):
    pieces = []
    for spec in specs:
        marker = '## Tzudong source page\n\n```json\n'
        if marker in spec['body']:
            value = json.loads(spec['body'].split(marker)[1].split('\n```')[0])
            pieces.append(value)
    pieces.sort(key=lambda value: value['offsetBytes'])
    raw, position = bytearray(), 0
    for piece in pieces:
        assert piece['offsetBytes'] == position
        decoded = base64.b64decode(piece['data'], validate=True)
        raw.extend(decoded)
        position += len(decoded)
    assert pieces and all(piece['totalBytes'] == position and piece['sourceSha256'] == hashlib.sha256(raw).hexdigest() for piece in pieces)
    return bytes(raw)


class PublicationPageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle, self.row, self.config, self.receipt_path, self.evidence_path = fixture_bundle(Path(self.temp.name))

    def admit(self, value):
        report = (f"- **Source:** https://www.youtube.com/watch?v={self.row['videoId']} (URL sent to Google)\n"
                  f"- **Engine:** {self.config.model} (static clip 00:00–{analysis._clock(self.row['durationSeconds'])})\n"
                  "## Answer (from Gemini)\n"
                  "_These are Gemini's observations of the video, not frames you viewed yourself. Relay them as such; rerun with `--engine local` to inspect frames directly._\n"
                  + analysis.canonical(value).decode())
        admitted, _ = analysis.parse_watch_report(report, self.row, self.config)
        evidence = analysis.checked_document(self.evidence_path)
        evidence.update(analysis=admitted, reportSha256=hashlib.sha256(report.encode()).hexdigest())
        receipt = analysis.checked_document(self.receipt_path)
        receipt['evidenceSha256'] = analysis.digest(evidence)
        analysis.atomic_document(self.evidence_path, evidence)
        analysis.atomic_document(self.receipt_path, receipt)
        self.bundle = publication.completed_bundle(Path(self.temp.name) / 'analysis', self.row, self.config)
        return len(report.encode())

    def check_pages(self, bundle):
        specs = publication.specs(bundle, paged=True)
        self.assertEqual(reconstructed_source(specs), analysis.canonical(bundle['analysis']))
        self.assertEqual(len(specs), len({spec['name'] for spec in specs}))
        by_name = {spec['name']: spec for spec in specs}
        for spec in specs:
            target = publication.target_for(spec, bundle['source'], None)
            self.assertLessEqual(len(target['body'].encode()) + 2048, projection.MAX_NODE_BYTES)
            self.assertLessEqual(len(spec['metadata']['evidence']), projection.MAX_EVIDENCE)
            self.assertLessEqual(len(spec['children']), pages.CHILDREN_PER_HUB)
            self.assertLessEqual(len(spec['name']), 120)
            if spec['context']:
                parent = by_name[spec['context']]
                self.assertEqual(parent['metadata']['kind'], 'hub')
                self.assertIn(spec['name'], parent['children'])
                self.assertEqual(Path(spec['space']).parent if spec['metadata']['kind'] == 'hub' else Path(spec['space']), Path(parent['space']))
        return specs

    def test_long_observation_and_uncertainty_and_one_hundred_evidence_are_lossless(self):
        value = analysis.raw_analysis(copy.deepcopy(self.bundle['analysis']))
        fact = value['claims'][0]
        fact['text'] = '😀' * 2000
        fact['uncertainty'] = ['😀' * 1999 + str(i % 10) for i in range(50)]
        fact['evidence'] = [{'startSeconds': i / 2, 'endSeconds': i / 2 + .1, 'modality': 'both'} for i in range(100)]
        self.assertLess(len(analysis.canonical(value)), analysis.MAX_REPORT_BYTES)
        self.admit(value)
        specs = self.check_pages(self.bundle)
        owner = 'TZ-Claim-ABCDEFGHIJK-1'
        evidence = [e for spec in specs if spec['name'] == owner or spec['name'].startswith(pages.page_name(owner, 'evidence', 0).rsplit('-', 1)[0] + '-') for e in spec['metadata']['evidence']]
        self.assertEqual(len(evidence), 100)
        self.assertEqual({(e['startSeconds'], e['endSeconds']) for e in evidence}, {(e['startSeconds'], e['endSeconds']) for e in fact['evidence']})
        self.assertTrue(any('content-' in spec['name'] for spec in specs))

    def test_many_summary_evidence_pages_keep_all_timestamps(self):
        value = analysis.raw_analysis(copy.deepcopy(self.bundle['analysis']))
        value['summary'] = [dict(value['summary'][0], text=f'요약 {i}', evidence=[{'startSeconds': i / 100 + j / 10000, 'endSeconds': i / 100 + j / 10000, 'modality': 'audio'} for j in range(100)]) for i in range(100)]
        self.assertLess(len(analysis.canonical(value)), analysis.MAX_REPORT_BYTES)
        self.admit(value)
        specs = self.check_pages(self.bundle)
        owner = 'TZ-Video-ABCDEFGHIJK'
        evidence = [e for spec in specs if spec['name'] == owner or spec['name'].startswith(pages.page_name(owner, 'evidence', 0).rsplit('-', 1)[0] + '-') for e in spec['metadata']['evidence']]
        self.assertEqual(len(evidence), 10000)
        self.assertTrue(any('index2-' in spec['name'] for spec in specs) or any('index1-' in spec['name'] for spec in specs))

    def test_producer_valid_report_exceeds_old_million_total_at_1069_videos(self):
        value = analysis.raw_analysis(copy.deepcopy(self.bundle['analysis']))
        fact = {'text': 'x', 'kind': 'spoken', 'evidence': [], 'confidence': 0, 'uncertainty': []}
        value['restaurants'] = [{'name': f'R{i}', 'evidence': [], 'confidence': 0, 'uncertainty': [], 'menus': [fact] * 100, 'claims': []} for i in range(100)]
        value['claims'] = [fact] * 100
        self.assertLess(len(analysis.canonical(value)), analysis.MAX_REPORT_BYTES - 1024)
        self.admit(value)
        specs = self.check_pages(self.bundle)
        self.assertGreater(len(specs) * 1069, 1_000_000)
        self.assertEqual(sum(spec['metadata']['kind'] == 'menu' for spec in specs), 10000)

    def test_four_byte_unicode_chunk_boundaries_roundtrip(self):
        source = 'a😀한' * 10000
        chunks = list(pages.utf8_chunks(source))
        self.assertEqual(''.join(chunks), source)
        self.assertTrue(all(len(chunk.encode()) <= pages.CONTENT_BYTES for chunk in chunks))

    def test_full_allowed_bound_fits_exact_integer_and_manifest_depth(self):
        # Receipt admission replays every <=100-restaurant/claim/summary segment;
        # merged lists are <=10000, each retained restaurant still <=100+100.
        restaurants, summaries, global_claims, per_kind = 10000, 10000, 10000, 100
        ordinary = 1 + restaurants + global_claims + 2 * restaurants * per_kind
        facts = global_claims + 2 * restaurants * per_kind
        # A fact has <=2000 text and <=50*2000 uncertainty scalars, at <=4 UTF-8
        # bytes/scalar. Reserve 2048 bytes for fixed content syntax per fact.
        fact_content = 4 * (2000 + 50 * 2000) + 2048
        content_extra = facts * ((fact_content + pages.CONTENT_BYTES - 1) // pages.CONTENT_BYTES - 1)
        content_extra += (summaries * (4 * 2000 + 2) + pages.CONTENT_BYTES - 1) // pages.CONTENT_BYTES
        evidence_extra = (ordinary - 1) * 6 + (summaries * 100 + 15) // 16 - 1
        source_pages = (analysis.MAX_DOCUMENT_BYTES + pages.CONTENT_BYTES - 1) // pages.CONTENT_BYTES
        before_indexes = ordinary + content_extra + evidence_extra + source_pages + 1
        # At most one collection wrapper per observation. Each index reduces
        # at least 127 children; conservative one index per child also holds.
        nodes_per_video = 2 * (before_indexes + ordinary)
        total_nodes = 1 + 1069 * nodes_per_video
        total_edges = total_nodes * (pages.CHILDREN_PER_HUB + 8)
        self.assertLess(total_edges, projection.MAX_GRAPH_COUNT)
        # Even a conservative single item per leaf is addressable in 8 levels.
        self.assertLess(total_edges, 256 ** 9)
        self.assertEqual(ordinary, 2020001)
        self.assertLess(total_nodes, 200_000_000_000)


if __name__ == '__main__':
    unittest.main()
