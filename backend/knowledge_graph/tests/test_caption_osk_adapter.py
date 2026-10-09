"""Real public OSK APIs in disposable vaults; no shared-vault writes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import stat
import sys
import tempfile
import unittest
from backend.knowledge_graph import caption_osk_adapter as c
from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph.tests.test_osk_publication import hub_fixture

class CaptionAdapterTests(unittest.TestCase):
    def run_case(self, case):
        engine = os.getenv('OSK_TEST_ENGINE')
        if not engine: self.skipTest('OSK_TEST_ENGINE required')
        with tempfile.TemporaryDirectory(prefix='tzudong-caption-test-') as d:
            result = subprocess.run([sys.executable, '-B', '-m', __name__, '--fixture', case, d, engine],
                                    env=dict(os.environ, TMPDIR=d, PYTHONDONTWRITEBYTECODE='1', OSK_UPDATE_CHECK='0'),
                                    capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stderr[-2500:])
            self.assertEqual(json.loads(result.stdout), {'case': case, 'ok': True})
    def test_real_registration_projection_and_idempotency(self): self.run_case('normal')
    def test_human_preimage_change_blocks_whole_set(self): self.run_case('cas')
    def test_lost_ack_is_readback_only(self): self.run_case('ack')
    def test_source_and_plan_mutation_block_writes(self): self.run_case('source')


class PrivateOutputTests(unittest.TestCase):
    def test_exact_0600_exclusive_output_under_permissive_and_restrictive_umask(self):
        with tempfile.TemporaryDirectory(prefix='tzudong-private-output-') as d:
            for mask in (0o000, 0o777):
                with self.subTest(umask=mask):
                    path = Path(d) / str(mask)
                    previous = os.umask(mask)
                    try:
                        c.write_private_output(path, {'synthetic': '자막'})
                    finally:
                        os.umask(previous)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                    before = path.read_bytes()
                    with self.assertRaises(FileExistsError):
                        c.write_private_output(path, {'replacement': True})
                    self.assertEqual(path.read_bytes(), before)
                    link = path.with_suffix('.link')
                    link.symlink_to(path)
                    with self.assertRaises(FileExistsError):
                        c.write_private_output(link, {'replacement': True})
                    self.assertEqual(path.read_bytes(), before)


def fixture(case, root, engine_path):
    vault=root/'vault';vault.mkdir();(vault/'.git').mkdir();hub_fixture(vault)
    source=root/'channel';source.mkdir();original={}
    for i, vid in enumerate(c.IDS):
        name='YT-tzuyang-Video-'+vid;p=vault/c.SPACE/(name+'.md')
        p.write_text('---\nid: "261004-0001-'+str(i+2).zfill(8)+'"\ncreated: "2026-10-04 00:01 (KST)"\nupdated: "2026-10-04 00:01 (KST)"\nauthor: "agent"\ndrafter: "aside"\nsummary: "Caption fixture; uncertainty retained"\nderived-from: "[[https://www.youtube.com/watch?v='+vid+']]"\n---\n\n# Caption only\n\nConflicting captions; audio and full visual unverified.\n')
        original[name]=p.read_bytes()
        versions={}
        for key, language in [('ko','ko'),('koOrig','ko-orig')]:
            sub=f'source/corpus/subs/{vid}.{language}.vtt';trans=f'source/analysis/{vid}/transcript.{language}.txt'
            for relative in [sub, trans]:
                t=source/relative;t.parent.mkdir(parents=True,exist_ok=True);t.write_text('synthetic captions only\n')
            versions[key]={'subtitleFile':sub,'transcriptFile':trans,'subtitleSha256':c.digest((source/sub).read_bytes()),'transcriptSha256':c.digest((source/trans).read_bytes())}
        (source/f'source/analysis/{vid}/caption-review.json').write_text(json.dumps({'videoId':vid,'sourceVersions':versions,'uncertainty':'unresolved negation'}))
    memberships={}
    for tab,ids in [('videos',list(c.IDS)),('streams',[])]:
        p=root/(tab+'.json');p.write_text(json.dumps({'tab':tab,'channelId':'UCfpaSruWW3S4dibonKXENjA','rows':[{'id':vid} for vid in ids]}));memberships[tab]=p
    engine=c.Engine(vault,engine_path);engine.overview();plan=c.plan(engine,source,memberships);c.validate_plan(plan)
    check=unittest.TestCase()
    if case=='cas':
        last=plan['targets'][-1];current=engine.read(last['name']);engine.api.update_node(name=last['name'],body=current['body']+'\nHuman addition',expect_hash=current['hash'])
        with check.assertRaisesRegex(c.PublicationError,'CAPTION_NODE_CHANGED'):c.apply(engine,source,plan)
        check.assertEqual((vault/c.SPACE/(plan['targets'][0]['name']+'.md')).read_bytes(),original[plan['targets'][0]['name']])
    elif case=='source':
        t=plan['targets'][0];(source/t['sourceFiles'][1]['path']).write_text('changed source\n')
        with check.assertRaises(c.PublicationError):c.apply(engine,source,plan)
        check.assertEqual((vault/c.SPACE/(t['name']+'.md')).read_bytes(),original[t['name']])
        plan['targets'][0]['body']+='\nforged'
        with check.assertRaisesRegex(c.PublicationError,'CAPTION_PLAN_INVALID'):c.validate_plan(plan)
    else:
        if case=='ack':
            update=engine.api.update_node;calls=[]
            def lost(**kw):
                calls.append(kw['name']);update(**kw);raise RuntimeError('lost ACK')
            engine.api.update_node=lost
        result=c.apply(engine,source,plan);check.assertEqual(len(result['results']),9)
        again=c.apply(engine,source,plan);check.assertTrue(all(x['reused'] for x in again['results']))
        if case=='ack':check.assertEqual(len(calls),9)
        for t in plan['targets']:
            node=engine.read(t['name']);check.assertEqual(c.digest(node['body'].rpartition('\n\n'+projection.METADATA_HEADING)[0].encode()),t['beforeBodySha256'])
            check.assertEqual(node['meta']['derived-from'],t['meta']['derived-from'])
        graph=projection.project_vault(vault,engine_path);check.assertEqual(len(graph['nodes']),10)
        check.assertEqual(graph['coverage']['analyzedCount'],0)
        for n in graph['nodes']:
            if n['kind']=='video':check.assertEqual(n['evidence'][0]['status'],'unverified');check.assertIsNone(n['evidence'][0]['endSeconds'])
    print(json.dumps({'case':case,'ok':True}))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--fixture':fixture(sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]))
    else:unittest.main()
