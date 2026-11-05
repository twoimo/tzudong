import type {NextRequest} from 'next/server';
import {proxy as candidate} from "/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong/apps/web/proxy";
import {proxy as baseline} from './baseline-proxy';
export function proxy(request: NextRequest){return request.nextUrl.searchParams.get('baseline')==='1'?baseline(request):candidate(request)}
export const config={matcher:['/']};
