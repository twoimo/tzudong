import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1]/'apply_hosted_pending_candidates.py'
spec = importlib.util.spec_from_file_location('hosted_apply_cli_under_test',FILE)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class HostedApplyCli(unittest.TestCase):
    def invoke(self, result, arguments=()):
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(cli,'assert_hosted_target'))
            stack.enter_context(patch.object(cli,'fetch_hosted_restaurant_snapshot',return_value=([],[])))
            stack.enter_context(patch.object(cli,'load_evaluation_rows',return_value=[{}]))
            stack.enter_context(patch.object(cli,'build_apply_preview',return_value={'previewSha256':'fixture','applyCandidateCount':1,'evaluationClasses':{}}))
            writer=stack.enter_context(patch.object(cli,'apply_pending_candidates',return_value=result))
            stack.enter_context(patch.dict(cli.os.environ,{cli.APPROVAL_ENV:'1'}))
            output=stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            code=cli.main(list(arguments))
            return code,output.getvalue(),writer.call_count

    def test_unresolved_write_is_failure_instead_of_success(self):
        result={'insertedCount':0,'insertedVideoIds':[],'skippedExistingVideoIds':[],
                'reflection':{'applied':[],'skippedAlreadyPresent':[],'unresolved':['abcdefghijk']}}
        code,text,calls=self.invoke(result)
        self.assertEqual(code,2)
        self.assertIn('error=hosted_apply_unresolved',text)
        self.assertEqual(calls,1)

    def test_success_and_preview_keep_their_existing_contract(self):
        result={'insertedCount':1,'insertedVideoIds':['abcdefghijk'],'skippedExistingVideoIds':[],
                'reflection':{'applied':['abcdefghijk'],'skippedAlreadyPresent':[],'unresolved':[]}}
        self.assertEqual(self.invoke(result)[0],0)
        code,_,calls=self.invoke(result,['--dry-run'])
        self.assertEqual((code,calls),(0,0))


if __name__=='__main__':unittest.main()
