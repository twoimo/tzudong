import { isRecordMutationAdmitted } from '@/lib/admin/record-action-admission';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { parseRecordActionRequest } from '@/lib/admin/record-action-contract';
import { RecordActionError,readRecordAction,runRecordAction,type RecordActionRpc } from '@/lib/admin/record-action-service';
export const runtime='nodejs';
function response(value: unknown,status=200) { return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}}); }
function failure(error: unknown) { return error instanceof RecordActionError ? response({success:false,code:error.code},error.status) : response({success:false,code:'RECORD_ACTION_UNCERTAIN'},503); }
function transport(): RecordActionRpc {
  const client=createSupabaseServiceRoleClient();
  // The new RPC is intentionally isolated until generated database types are refreshed.
  const invoke=client.rpc.bind(client) as unknown as (name:string,args:Record<string,unknown>)=>ReturnType<RecordActionRpc>;
  return args=>invoke('admin_record_action',args);
}
export async function POST(request: Request) {
  try {
    const auth=await requireAdmin(); if(!auth.ok) { auth.response.headers.set('Cache-Control','no-store'); return auth.response; }
    if(!isTrustedSameOriginMutation(request)) return response({success:false,code:'RECORD_ACTION_FORBIDDEN'},403);
  if(!isRecordMutationAdmitted()) return response({success:false,code:'RECORD_ACTION_MAINTENANCE'},423);
    const body=await readBoundedJsonRequest(request,65536);
    const parsed=body.ok?parseRecordActionRequest(body.value):null;
    if(!parsed) return response({success:false,code:'RECORD_ACTION_INVALID_PAYLOAD'},400);
    return response({success:true,receipt:await runRecordAction(transport(),auth.userId,parsed)});
  } catch(error) { return failure(error); }
}
export async function GET(request: Request) {
  try {
    const auth=await requireAdmin(); if(!auth.ok) { auth.response.headers.set('Cache-Control','no-store'); return auth.response; }
    return response({success:true,receipt:await readRecordAction(transport(),auth.userId,new URL(request.url).searchParams.get('operationId')??'')});
  } catch(error) { return failure(error); }
}
