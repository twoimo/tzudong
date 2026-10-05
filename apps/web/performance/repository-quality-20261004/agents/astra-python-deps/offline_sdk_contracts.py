"""Exercise installed SDKs and actual callers. Run only with network-denying sandbox."""
import contextlib, importlib, importlib.util, inspect, io, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
ROOT=Path('/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong')
sys.path.insert(0,str(ROOT))

def script(relative,name):
 old_path=sys.path[:]
 saved_utils={k:v for k,v in sys.modules.items() if k=='utils' or k.startswith('utils.')}
 for key in saved_utils:del sys.modules[key]
 spec=importlib.util.spec_from_file_location(name,ROOT/relative)
 module=importlib.util.module_from_spec(spec);sys.modules[name]=module
 try:spec.loader.exec_module(module)
 finally:
  sys.path[:]=old_path
  for key in list(sys.modules):
   if key=='utils' or key.startswith('utils.'):del sys.modules[key]
  sys.modules.update(saved_utils)
 return module

def transport_for(client,handler):
 module=importlib.import_module('httpx2' if any(c.__module__.startswith('httpx2') for c in type(client).__mro__) else 'httpx')
 def adapted(request):
  status,payload=handler(request)
  return module.Response(status,json=payload,request=request)
 return module.MockTransport(adapted)

def completion(content):
 return {'id':'offline-completion','object':'chat.completion','created':0,'model':'fixture-model','choices':[{'index':0,'finish_reason':'stop','message':{'role':'assistant','content':content}}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}

class PipelineContracts(unittest.TestCase):
 def test_actual_pipeline_state_reducers_with_installed_langgraph(self):
  from backend.pipeline.state import PipelineState,create_initial_state
  from langgraph.graph import StateGraph,START,END
  graph=StateGraph(PipelineState)
  graph.add_node('first',lambda state:{'completed_enrich':['fixture-a']})
  graph.add_node('second',lambda state:{'completed_enrich':['fixture-b']})
  graph.add_edge(START,'first');graph.add_edge('first','second');graph.add_edge('second',END)
  state=create_initial_state('fixture','/offline/crawl','/offline/evaluate',dry_run=True)
  result=graph.compile().invoke(state)
  self.assertEqual(result['completed_enrich'],['fixture-a','fixture-b'])
  self.assertTrue(result['dry_run']);self.assertEqual(result['review_queue'],[])
 def test_langchain_document_pydantic_and_prompt_contract(self):
  from langchain_core.documents import Document
  from langchain_core.prompts import PromptTemplate
  from langchain_core.output_parsers import StrOutputParser
  from langchain_core.runnables import RunnableLambda
  from pydantic import ValidationError
  doc=Document(page_content='fixture text',metadata={'recollect_id':7})
  self.assertEqual(Document.model_validate_json(doc.model_dump_json()).metadata,{'recollect_id':7})
  with self.assertRaises(ValidationError):Document(page_content=None)
  chain=PromptTemplate.from_template('{title}: {chunk}')|RunnableLambda(lambda prompt:prompt.to_string())|StrOutputParser()
  self.assertEqual(chain.invoke({'title':'fixture','chunk':'text'}),'fixture: text')

class CrawlerContracts(unittest.TestCase):
 def openai_call(self,status,payload):
  from openai import OpenAI
  module=script('backend/restaurant-crawling/scripts/02-collect-meta.py','sdk_collect_meta')
  client=OpenAI(api_key='offline-fixture',base_url='https://offline.invalid/v1',max_retries=0)
  seen=[]
  def handle(request):seen.append(json.loads(request.content));return status,payload
  client._client._transport=transport_for(client._client,handle)
  with client,patch.object(module,'get_api_config',return_value={'openai':{'model':'fixture-configured-model'}}):
   result=module.analyze_ad_content(client,'fixture advertisement',MagicMock())
  self.assertEqual(len(seen),1)
  self.assertEqual(seen[0]['model'],'fixture-configured-model')
  self.assertEqual(seen[0]['temperature'],0.3)
  return result,module.OPENAI_AD_ANALYSIS_DISABLED_REASON
 def test_actual_ad_analysis_with_real_openai_response(self):
  self.assertEqual(self.openai_call(200,completion('["fixture sponsor"]')),(['fixture sponsor'],None))
 def test_actual_ad_analysis_authentication_error_contract(self):
  self.assertEqual(self.openai_call(401,{'error':{'message':'offline fixture','type':'invalid_request_error','code':'invalid_api_key'}}),(None,'invalid_api_key'))
 def test_actual_ad_analysis_rate_limit_does_not_disable(self):
  self.assertEqual(self.openai_call(429,{'error':{'message':'offline fixture','type':'rate_limit_error','code':'rate_limit'}}),(None,None))
 def test_actual_transcript_chain_uses_real_chatopenai(self):
  module=script('backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py','sdk_context')
  from langchain_core.prompts import PromptTemplate
  llm=module.build_context_llm('openai',module.DEFAULT_OMLX_MODEL,module.DEFAULT_OMLX_BASE_URL)
  seen=[]
  def handle(request):seen.append(json.loads(request.content));return 200,completion('  fixture context  ')
  llm.root_client._client._transport=transport_for(llm.root_client._client,handle)
  with patch.object(module,'build_context_llm',return_value=llm):
   result=module.run_chain(module.DEFAULT_OMLX_MODEL,module.DEFAULT_OMLX_BASE_URL,'title','full','chunk',PromptTemplate.from_template('{title} {full_transcript} {chunk}'),backend='openai')
  llm.root_client.close()
  self.assertEqual(result,'fixture context');self.assertEqual(len(seen),1)
  self.assertEqual(seen[0]['model'],module.DEFAULT_OMLX_MODEL);self.assertEqual(seen[0]['temperature'],0)
 def test_existing_ollama_defaults_construct_with_real_sdk(self):
  module=script('backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py','sdk_ollama')
  with patch.dict(os.environ,{},clear=True):
   llm=module.build_context_llm('ollama',module.DEFAULT_OLLAMA_MODEL,module.DEFAULT_OLLAMA_BASE_URL)
  self.assertEqual(llm.model,module.DEFAULT_OLLAMA_MODEL);self.assertEqual(llm.num_predict,128)
 def test_actual_youtube_metadata_caller_with_real_discovery(self):
  from googleapiclient.discovery import build
  import httplib2
  module=script('backend/restaurant-crawling/scripts/02-collect-meta.py','sdk_youtube')
  requests=[]
  class Http:
   def request(self,uri,method='GET',body=None,headers=None,**kwargs):
    requests.append(uri)
    return httplib2.Response({'status':'200','content-type':'application/json'}),json.dumps({'items':[{'id':'fixture1234','snippet':{'title':'fixture title','description':'fixture text'},'contentDetails':{'duration':'PT3M1S'},'statistics':{'viewCount':'8'}}]}).encode()
  youtube=build('youtube','v3',http=Http(),developerKey='offline-fixture',static_discovery=True)
  result=module.get_video_meta_batch(youtube,['fixture1234'],'fixture-channel')
  self.assertEqual(result['fixture1234']['duration'],181);self.assertFalse(result['fixture1234']['is_shorts'])
  self.assertEqual(result['fixture1234']['stats']['view_count'],8);self.assertEqual(len(requests),1)
 def test_actual_scrapling_helper_with_real_fetcher_response(self):
  import curl_cffi.requests as curl_requests
  module=script('backend/bin/naver_scrapling_fetch.py','sdk_naver')
  response=curl_requests.Response();response.status_code=200;response.url='https://offline.invalid/';response.content=b'<html><h1>fixture</h1></html>';response.headers=curl_requests.Headers({'content-type':'text/html'});response.cookies=curl_requests.Cookies()
  output=io.StringIO()
  with patch.object(sys,'argv',['naver_scrapling_fetch.py','--query','offline fixture']),patch.object(curl_requests.Session,'request',return_value=response) as request,contextlib.redirect_stdout(output):
   rc=module.main()
  data=json.loads(output.getvalue());self.assertEqual(rc,0);self.assertEqual(data['status'],200)
  self.assertIn('fixture',data['html']);self.assertEqual(data['blocked_reason'],'');request.assert_called_once()
 def test_curl_cffi_native_request_preparation_without_dispatch(self):
  import curl_cffi
  from curl_cffi import requests
  with requests.Session() as session,patch.object(curl_cffi.Curl,'perform',side_effect=RuntimeError('offline_dispatch_boundary')) as perform:
   with self.assertRaisesRegex(RuntimeError,'offline_dispatch_boundary'):
    session.get('https://offline.invalid/',impersonate='chrome',timeout=1)
   perform.assert_called_once()
 def test_real_playwright_api_accepts_existing_browser_call_arguments(self):
  from playwright.sync_api import BrowserType
  inspect.signature(BrowserType.connect_over_cdp).bind(None,'http://127.0.0.1:9222')
  inspect.signature(BrowserType.launch_persistent_context).bind(None,'/offline/profile',channel='chrome',headless=False,locale='ko-KR',args=['--profile-directory=Default','--remote-debugging-port=9222'])
 def test_actual_visual_downloader_arguments_parse_in_real_ytdlp(self):
  import yt_dlp
  module=script('backend/restaurant-crawling/scripts/03-2-visual-location.py','sdk_visual')
  captured=[]
  with tempfile.TemporaryDirectory() as directory:
   dest=Path(directory);(dest/'sample.mp4').write_bytes(b'offline fixture')
   def run(args,**kwargs):captured.extend(args);return type('Result',(),{'returncode':0})()
   with patch.object(module,'resolve_tool',return_value='yt-dlp'),patch.object(module.subprocess,'run',side_effect=run):
    self.assertEqual(module.download_sampled_video('fixture1234',dest,None,20,[]),dest/'sample.mp4')
  parsed=yt_dlp.parse_options(captured[1:])
  self.assertTrue(parsed.ydl_opts['noplaylist']);self.assertEqual(len(parsed.urls),1)

class ControlContracts(unittest.TestCase):
 def test_actual_loaders_use_real_psycopg_json_adapter(self):
  from backend.pipeline_control import batch_upsert,outbox,persist,pool
  import psycopg2
  from psycopg2.extras import Json
  for module in [batch_upsert,outbox]:
   driver,adapter=module._load_psycopg2();self.assertIs(driver,psycopg2);self.assertIs(adapter,Json)
   self.assertIn(b'fixture',adapter({'value':'fixture'}).getquoted())
  self.assertIs(persist._load_psycopg2(),psycopg2);self.assertIs(pool._load_psycopg2()[0],psycopg2)
 def test_actual_pool_reuses_real_driver_pool_and_transaction_boundary(self):
  import psycopg2
  from backend.pipeline_control import pool
  conn=MagicMock();conn.closed=False;conn.info.transaction_status=0
  pool.close_pool()
  with patch.dict(os.environ,{'TZUDONG_DATA_ENV':'local_db','PIPELINE_CONTROL_DSN':'postgresql://localhost/fixture'}),patch.object(psycopg2,'connect',return_value=conn) as connect:
   try:
    with pool.connection() as actual:self.assertIs(actual,conn)
    conn.commit.assert_called_once()
    with self.assertRaisesRegex(ValueError,'fixture_failure'):
     with pool.connection():raise ValueError('fixture_failure')
    conn.rollback.assert_called_once();connect.assert_called_once()
   finally:pool.close_pool()

class CrawlerAdditionalContracts(unittest.TestCase):
 def test_real_youtube_discovery_paginates_actual_url_collector(self):
  from googleapiclient.discovery import build
  import httplib2
  module=script('backend/restaurant-crawling/scripts/01-collect-urls.py','sdk_url_collect')
  requests=[];responses=[{'items':[{'contentDetails':{'relatedPlaylists':{'uploads':'fixture-playlist'}}}]},{'items':[{'contentDetails':{'videoId':'fixture0001'}}],'nextPageToken':'fixture-next'},{'items':[{'contentDetails':{'videoId':'fixture0002'}}]}]
  class Http:
   def request(self,uri,method='GET',body=None,headers=None,**kwargs):
    requests.append(uri);return httplib2.Response({'status':'200','content-type':'application/json'}),json.dumps(responses.pop(0)).encode()
  def builder(*args,**kwargs):return build(*args,http=Http(),static_discovery=True,**kwargs)
  with patch.object(module,'build',side_effect=builder),patch.object(module,'get_collection_config',return_value={'batch_size':2}):
   result=module.fetch_all_video_urls('offline-fixture','fixture-channel',MagicMock())
  self.assertEqual(result,['https://www.youtube.com/watch?v=fixture0001','https://www.youtube.com/watch?v=fixture0002']);self.assertEqual(len(requests),3);self.assertIn('pageToken=fixture-next',requests[2])
 def test_real_prompt_loading_and_actual_document_jsonl_serialization(self):
  module=script('backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py','sdk_prompt_documents')
  prompts=ROOT/'backend/restaurant-crawling/prompts'
  for filename in ['generate_context_en.yaml','parse_error_context.yaml']:
   prompt=module.load_prompt(str(prompts/filename),encoding='utf-8');self.assertTrue(prompt.input_variables)
  doc=module.Document(page_content='fixture 문맥',metadata={'recollect_id':7})
  with tempfile.TemporaryDirectory() as directory:
   module.save_documents_for_video('fixture1234',[doc],directory,7)
   data=json.loads((Path(directory)/'fixture1234.jsonl').read_text())
  self.assertEqual(data[0]['page_content'],'fixture 문맥');self.assertEqual(data[0]['metadata']['recollect_id'],7)
 def test_real_playwright_upload_api_signatures(self):
  from playwright.sync_api import Page,Locator,FileChooser,Browser,BrowserContext
  for fn,args,kwargs in [(Page.expect_file_chooser,(None,),{'timeout':8000}),(Locator.set_input_files,(None,'/unused.mp4'),{}),(FileChooser.set_files,(None,'/unused.mp4'),{}),(Browser.new_context,(None,),{}),(BrowserContext.new_page,(None,),{}),(BrowserContext.close,(None,),{})]:
   inspect.signature(fn).bind(*args,**kwargs)
  self.assertIsInstance(Browser.contexts,property);self.assertIsInstance(BrowserContext.pages,property)
 def test_ytdlp_chrome_impersonation_matches_actual_shell_detection(self):
  import subprocess,re
  result=subprocess.run([sys.executable,'-m','yt_dlp','--ignore-config','--no-cache-dir','--list-impersonate-targets'],capture_output=True,text=True,timeout=20)
  self.assertEqual(result.returncode,0)
  self.assertRegex(result.stdout,re.compile(r'^\s*Chrome-\S+\s+',re.MULTILINE))
