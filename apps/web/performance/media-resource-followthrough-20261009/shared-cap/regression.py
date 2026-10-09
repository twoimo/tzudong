"""Run affected existing Node regressions using owned copies + pinned deps."""
import pathlib,tempfile,os,subprocess,sys
sys.path.insert(0,str(next(p for p in pathlib.Path(__file__).resolve().parents if (p/'backend').is_dir())))
from backend.bin import benchmark_media_orchestration as b
E=pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='tzudong-owned-media-final-regression-') as d:
 root=pathlib.Path(d).resolve();assets=b.ASSETS+['backend/utils/media_lease_exec.py','backend/utils/tests/frame-receipt.test.mjs','backend/restaurant-crawling/scripts/tests/test_heatmap_video_candidate_regression.js','backend/restaurant-crawling/scripts/split_video_chunks.mjs','backend/restaurant-crawling/scripts/tests/test_split_video_chunks_timeout.mjs']
 for relative in assets:
  p=root/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((b.ROOT/relative).read_bytes())
 (root/'backend/node_modules').symlink_to(b.ORIGINAL/'backend/node_modules',target_is_directory=True)
 gitdir=(b.ROOT/'.git').read_text().split('gitdir: ',1)[1].strip()
 env=dict(os.environ,PIPELINE_MEDIA_RESOURCE_DIR=str(root/'owned-slots'),RUN_DAILY_PYTHON=sys.executable,PYTHONDONTWRITEBYTECODE='1',GIT_DIR=gitdir)
 r=subprocess.run([str(b.NODE),'--test','backend/utils/tests/frame-receipt.test.mjs','backend/restaurant-crawling/scripts/tests/test_heatmap_video_candidate_regression.js','backend/restaurant-crawling/scripts/tests/test_split_video_chunks_timeout.mjs'],cwd=root,env=env,capture_output=True,text=True)
 print(r.stdout[-600:]);print('exit',r.returncode)
 b.write_json(E/'final-source-node-regression.json',{'exitCode':r.returncode,'stdoutSha256':b.sha(r.stdout.encode()),'stderrSha256':b.sha(r.stderr.encode()),'fixtureOnly':True,'dependencySource':'existing pinned original backend node_modules read-only symlink; no install','baselineGitReadOnly':True,'ownedSourceHashes':{relative:b.sha((b.ROOT/relative).read_bytes()) for relative in assets}})
 raise SystemExit(r.returncode)
