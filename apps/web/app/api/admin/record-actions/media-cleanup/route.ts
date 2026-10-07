import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { RecordActionError,resumeRecordMediaCleanup,createRecordMediaTransport,type RecordActionRpc } from '@/lib/admin/record-action-service';
import {admitRecordMediaCleanup} from '@/lib/admin/record-media-admission';
export const runtime='nodejs';
export async function POST(request:Request) {
 const response=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
 try {
  const auth=await requireAdmin(); if(!auth.ok) {auth.response.headers.set('Cache-Control','no-store');return auth.response;}
  if(!isTrustedSameOriginMutation(request)) return response({success:false,code:'RECORD_ACTION_FORBIDDEN'},403);
  const body=await readBoundedJsonRequest(request,1024);
  const input=z.strictObject({operationId:z.uuid()}).safeParse(body.ok?body.value:null);
  if(!input.success) return response({success:false,code:'RECORD_ACTION_INVALID_PAYLOAD'},400);
  const admission=admitRecordMediaCleanup();
  if(!admission) return response({success:false,code:'RECORD_ACTION_MEDIA_NOT_ADMITTED'},503);
  const client=createSupabaseServiceRoleClient();
  const invoke=client.rpc.bind(client) as unknown as (name:string,args:Record<string,unknown>)=>ReturnType<RecordActionRpc>;
  const receipt=await resumeRecordMediaCleanup(args=>invoke('admin_record_action',args),createRecordMediaTransport(client),auth.userId,input.data.operationId,admission);
  return response({success:true,receipt});
 } catch(error) {
  return error instanceof RecordActionError ? response({success:false,code:error.code},error.status) : response({success:false,code:'RECORD_ACTION_UNCERTAIN'},503);
 }
}
