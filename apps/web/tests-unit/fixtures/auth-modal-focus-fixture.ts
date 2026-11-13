import { join } from "node:path";

const root = join(import.meta.dir, "../..");

export async function buildAuthModalFocusFixture(keepMounted: boolean) {
  const mocks: Record<string, string> = {
    "next/image": "import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}",
    "@/hooks/useDeviceType": "export const useImmediateMobileOrTablet=()=>false;export const useIsMobile=()=>false;",
    "@/integrations/supabase/client": "export const supabase={auth:{}};export const getSupabaseBrowserClient=()=>supabase;export const commitSupabaseBrowserSession=async()=>{throw new Error('FIXTURE_AUTH_WRITES_FORBIDDEN')};",
    "@/lib/no-toast": "export const toast={success(){},error(){},info(){}};",
  };
  const entry = `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import AuthModal from './components/auth/AuthModal';
    globalThis.__authFocusWrites=0;
    globalThis.fetch=async(_input,init)=>{
      if(init?.method && init.method!=='GET')globalThis.__authFocusWrites++;
      return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
    };
    function App(){
      const [open,setOpen]=useState(false);
      return <><button onClick={()=>setOpen(true)}>상단 로그인 열기</button>
        <button onClick={()=>setOpen(true)}>다른 위치에서 로그인 열기</button>
        {(${JSON.stringify(keepMounted)}||open)&&<AuthModal isOpen={open} onClose={()=>setOpen(false)}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const result = await Bun.build({
    entrypoints: ["auth-focus-entry"], target: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "auth-modal-focus-fixture", setup(builder) {
      builder.onResolve({ filter: /^auth-focus-entry$/ }, () => ({ path: "entry", namespace: "auth-focus" }));
      builder.onLoad({ filter: /.*/, namespace: "auth-focus" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, (args) =>
        mocks[args.path] ? { path: args.path, namespace: "auth-focus-mock" }
          : args.path.startsWith("@/") ? { path: Bun.resolveSync("./" + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "auth-focus-mock" }, (args) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  if (!result.success) throw new Error("AUTH_FOCUS_FIXTURE_BUILD_FAILED");
  const script = result.outputs.find((output) => output.path.endsWith(".js"));
  if (!script) throw new Error("AUTH_FOCUS_FIXTURE_SCRIPT_MISSING");
  return script.text();
}
