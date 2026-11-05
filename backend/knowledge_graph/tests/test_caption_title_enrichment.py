"""Title migration exercises real pinned OSK APIs in a disposable fixture vault."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from backend.knowledge_graph import caption_title_enrichment as title
from backend.knowledge_graph import caption_osk_adapter as caption
from backend.knowledge_graph.tests.test_caption_osk_adapter import FakeEngine, Fixture, video_id
from backend.knowledge_graph.tests.test_osk_publication import hub_fixture


class TitleFieldsTests(unittest.TestCase):
    def receipt(self, label='검증된 제목'):
        return {'schema': title.SCHEMA, 'videoId': caption.IDS[0], 'displayTitle': label,
                'titleSha256': caption.digest(label.encode()), 'reviewSha256': 'a'*64,
                'indexSha256': 'b'*64, 'observation': 'caption-first-pass'}
    def body(self, receipt):
        return title.HEADING+'\n```json\n'+json.dumps(receipt)+'\n```\n'
    def test_absent_and_code_fenced_examples_are_not_enrichment(self):
        self.assertIsNone(title.title_fields('legacy v1', caption.IDS[0]))
        self.assertIsNone(title.title_fields('````\n'+self.body(self.receipt())+'````', caption.IDS[0]))
    def test_duplicate_control_mismatch_and_forged_digest_are_rejected(self):
        good=self.body(self.receipt())
        for body,vid in [(good+good,caption.IDS[0]),(good,caption.IDS[1]),(self.body(self.receipt('bad\nheader')),caption.IDS[0]),(self.body(dict(self.receipt(),titleSha256='f'*64)),caption.IDS[0])]:
            with self.assertRaises(caption.PublicationError):title.title_fields(body,vid)
    def test_bounded_title_keeps_stage_separate(self):
        self.assertEqual(title.title_fields(self.body(self.receipt()),caption.IDS[0]),{'displayTitle':'검증된 제목','displayStage':'caption-first-pass'})


class TitleSourceTests(unittest.TestCase):
    def test_duplicate_title_key_is_rejected_before_index_comparison(self):
        with tempfile.TemporaryDirectory(prefix='caption-title-duplicate-') as directory:
            root=Path(directory);vid=video_id('V',1);fixture=Fixture(root,videos=[vid])
            review_path=fixture.add_review(vid)
            review=json.loads(review_path.read_text());review['title']='accepted-last'
            encoded=json.dumps(review)
            encoded=encoded.replace('"title": "accepted-last"','"title": "ambiguous-first", "title": "accepted-last"',1)
            review_path.write_text(encoded)
            index=fixture.channel/'source/corpus/video-index.json';index.parent.mkdir(parents=True,exist_ok=True)
            index.write_text(json.dumps([{'id':vid,'title':'accepted-last'}]))
            with self.assertRaisesRegex(caption.PublicationError,'CAPTION_TITLE_SOURCE_INVALID'):
                title.source_title(fixture.channel,vid)

    def test_title_hash_and_parse_share_the_captured_bytes(self):
        with tempfile.TemporaryDirectory(prefix='caption-title-snapshot-') as directory:
            root=Path(directory);vid=video_id('V',1);fixture=Fixture(root,videos=[vid])
            review_path=fixture.add_review(vid)
            original=json.loads(review_path.read_text());original['title']='captured-title'
            original_bytes=json.dumps(original).encode();review_path.write_bytes(original_bytes)
            index=fixture.channel/'source/corpus/video-index.json';index.parent.mkdir(parents=True,exist_ok=True)
            index.write_text(json.dumps([{'id':vid,'title':'captured-title'}]))
            file_snapshot=caption.file_snapshot
            def mutate_after_capture(path, source_root):
                binding,data=file_snapshot(path,source_root)
                if path == f'source/analysis/{vid}/caption-review.json':
                    changed=dict(original,title='later-title');review_path.write_text(json.dumps(changed))
                return binding,data
            with mock.patch.object(caption,'file_snapshot',side_effect=mutate_after_capture):
                receipt,bindings=title.source_title(fixture.channel,vid)
            self.assertEqual(receipt['displayTitle'],'captured-title')
            self.assertEqual(bindings[0]['sha256'],caption.digest(original_bytes))
            self.assertNotEqual(bindings[0]['sha256'],caption.digest(review_path.read_bytes()))

    def test_apply_reports_captured_title_when_sources_change_at_update_entry(self):
        with tempfile.TemporaryDirectory(prefix='caption-title-update-entry-') as directory:
            root=Path(directory);vid=video_id('V',1);fixture=Fixture(root,videos=[vid])
            review_path=fixture.add_review(vid)
            index=fixture.channel/'source/corpus/video-index.json';index.parent.mkdir(parents=True,exist_ok=True)
            index.write_text(json.dumps([{'id':vid,'title':'Synthetic title'}]))
            engine=FakeEngine(root,[vid])
            registration=caption.plan(engine,fixture.channel,fixture.memberships,1)['targets'][0]
            node=engine.nodes[registration['name']];node['body']=registration['body'];node['hash']='sha256:'+caption.digest(node['body'].encode())
            plan=title.make_plan([engine.read(registration['name'])],fixture.channel)
            captured_sha=caption.digest(caption.canonical([
                {'videoId':vid,'sourceFiles':plan['targets'][0]['sourceFiles']}
            ]).encode())

            def change_both_title_sources(_name):
                review=json.loads(review_path.read_text());review['title']='later-title'
                review_path.write_text(json.dumps(review))
                index.write_text(json.dumps([{'id':vid,'title':'later-title'}]))

            engine.api.before_update=change_both_title_sources
            result=title.apply(engine,fixture.channel,plan)
            self.assertEqual(result['schema'],'tzudong-caption-title-readback/v2')
            self.assertEqual(result['sourceSnapshot']['status'],'captured')
            self.assertEqual(result['sourceSnapshot']['sha256'],captured_sha)
            self.assertFalse(result['sourceSnapshot']['currentMutableSourcesCheckedAfterCapture'])
            self.assertEqual(title.title_fields(engine.read(registration['name'])['body'],vid)['displayTitle'],'Synthetic title')
            self.assertEqual(json.loads(review_path.read_text())['title'],'later-title')
            self.assertEqual(json.loads(index.read_text())[0]['title'],'later-title')


class ActualTitleMigrationTests(unittest.TestCase):
    def test_real_api_registration_title_migration_cas_source_fence_and_retry(self):
        engine=os.getenv('OSK_TEST_ENGINE')
        if not engine:self.skipTest('OSK_TEST_ENGINE required')
        with tempfile.TemporaryDirectory(prefix='tzudong-title-test-') as d:
            r=subprocess.run([sys.executable,'-B','-m',__name__,'--fixture',d,engine],capture_output=True,text=True,timeout=60,env=dict(os.environ,TMPDIR=d,OSK_UPDATE_CHECK='0',PYTHONDONTWRITEBYTECODE='1'))
            self.assertEqual(r.returncode,0,r.stderr[-2500:]);self.assertEqual(json.loads(r.stdout),{'ok':True})


def fixture(directory,engine_path):
    root=Path(directory);vault=root/'vault';vault.mkdir();(vault/'.git').mkdir();hub_fixture(vault)
    source=root/'channel';source.mkdir();rows=[]
    for i,vid in enumerate(caption.IDS):
        name='YT-tzuyang-Video-'+vid;p=vault/caption.SPACE/(name+'.md')
        p.write_text('---\nid: "261004-0001-'+str(i+2).zfill(8)+'"\ncreated: "2026-10-04 00:01 (KST)"\nupdated: "2026-10-04 00:01 (KST)"\nauthor: "agent"\ndrafter: "aside"\nsummary: "Unverified synthetic caption"\nderived-from: "[[https://www.youtube.com/watch?v='+vid+']]"\n---\n\n# Original caption\n\nUnverified audio/visual.\n')
        versions={}
        for key,lang in [('ko','ko'),('koOrig','ko-orig')]:
            sub=f'source/corpus/subs/{vid}.{lang}.vtt';trans=f'source/analysis/{vid}/transcript.{lang}.txt'
            for path in [sub,trans]:f=source/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic only\n')
            versions[key]={'subtitleFile':sub,'transcriptFile':trans,'subtitleSha256':caption.digest((source/sub).read_bytes()),'transcriptSha256':caption.digest((source/trans).read_bytes())}
        label=f'실제 출처 제목 {i+1}'
        (source/f'source/analysis/{vid}/caption-review.json').write_text(json.dumps({'videoId':vid,'title':label,'sourceVersions':versions}))
        rows.append({'id':vid,'title':label})
    index=source/'source/corpus/video-index.json';index.write_text(json.dumps(rows))
    memberships={}
    for tab,ids in [('videos',list(caption.IDS)),('streams',[]),('shorts',[])]:
        f=root/(tab+'.json');f.write_text(json.dumps({'tab':tab,'channelId':'UCfpaSruWW3S4dibonKXENjA','rows':[{'id':vid} for vid in ids]}));memberships[tab]=f
    checkpoints=root/'caption-checkpoints'
    engine=caption.Engine(vault,Path(engine_path));engine.overview();v1=caption.plan(engine,source,memberships,len(caption.IDS));caption.apply(engine,source,memberships,v1,checkpoints,len(caption.IDS))
    before=[engine.read(t['name']) for t in v1['targets']];plan=title.make_plan(before,source);title.validate_plan(plan)
    check=unittest.TestCase()
    # Whole-set human preimage fence; zero first-node writes.
    last=engine.read(plan['targets'][-1]['name']);engine.api.update_node(name=last['name'],body=last['body']+'\nHuman text',expect_hash=last['hash'])
    with check.assertRaisesRegex(caption.PublicationError,'CAPTION_TITLE_NODE_CHANGED'):title.apply(engine,source,plan)
    check.assertEqual(engine.read(plan['targets'][0]['name'])['body'],before[0]['body'])
    plan=title.make_plan([engine.read(t['name']) for t in v1['targets']],source)
    # Source change cannot silently replan or apply stale title.
    old=index.read_bytes();index.write_text(json.dumps([dict(r,title='changed') for r in rows]))
    with check.assertRaises(caption.PublicationError):title.apply(engine,source,plan)
    index.write_bytes(old)
    # A forged title with rehashed plan fields is still rejected against source.
    forged=json.loads(json.dumps(plan)); target=forged['targets'][0]
    receipt,_=title.source_title(source,target['videoId']);receipt['displayTitle']='invented title';receipt['titleSha256']=caption.digest(receipt['displayTitle'].encode())
    target['body']=title.enriched_body({'body':target['beforeBody']},target['videoId'],receipt);target['targetBodySha256']=caption.digest(target['body'].encode())
    title.validate_plan(forged)
    with check.assertRaisesRegex(caption.PublicationError,'CAPTION_TITLE_SOURCE_CHANGED'):title.apply(engine,source,forged)
    # Lost acknowledgement is reconciled by caller readback/retry, never blind resend.
    update=engine.api.update_node;calls=[]
    def lost(**kwargs):
        calls.append(kwargs['name']);update(**kwargs);raise RuntimeError('lost ACK')
    engine.api.update_node=lost
    with check.assertRaises(RuntimeError):title.apply(engine,source,plan)
    engine.api.update_node=update
    readback=title.apply(engine,source,plan);check.assertTrue(readback['results'][0]['reused']);check.assertEqual(len(calls),1)
    check.assertTrue(all(r['reused'] for r in title.apply(engine,source,plan)['results']))
    for t in plan['targets']:
        after=engine.read(t['name']);check.assertTrue(after['body'].startswith(t['beforeBody']));check.assertEqual(title.projection._metadata(after['body']),title.projection._metadata(t['beforeBody']))
    # Saved v1 decoder still validates byte-exact original plan; after explicit
    # migration its old apply must fail closed rather than silently erase titles.
    caption.validate_plan(v1)
    with check.assertRaises(caption.PublicationError):caption.apply(engine,source,memberships,v1,checkpoints,len(caption.IDS))
    projection=title.projection.project_vault(vault,Path(engine_path))
    videos=[n for n in projection['nodes'] if n['kind']=='video']
    check.assertEqual(len(videos),9);check.assertTrue(all(n['displayTitle'].startswith('실제 출처 제목') for n in videos));check.assertEqual(projection['coverage']['analyzedCount'],0)
    from backend.knowledge_graph.graph_shards import build_graph_shards
    check.assertEqual(build_graph_shards(projection).manifest['totalNodes'],len(projection['nodes']))
    print(json.dumps({'ok':True}))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--fixture':fixture(sys.argv[2],sys.argv[3])
    else:unittest.main()
