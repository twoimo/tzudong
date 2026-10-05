import { execFileSync } from 'node:child_process';
const result = await Bun.build({entrypoints:['.omx/artifacts/astra-web-contract-modal/entry.jsx'],target:'browser',outdir:'.omx/artifacts/astra-web-contract-modal/bundle-baseline',plugins:[{name:'baseline-modal',setup(build){build.onLoad({filter:/components\/ui\/(?:alert-dialog|dialog)\.tsx$/},args=>({contents:execFileSync('git',['show','4295fd54411ac8a4c304dce89efbb6f96e90935c:apps/web/components/ui/'+args.path.split('/').at(-1)],{encoding:'utf8'}),loader:'tsx'}));}}]});
if (!result.success) throw new Error('FIXTURE_BUILD_FAILED');
console.log('Baseline component fixture built');
