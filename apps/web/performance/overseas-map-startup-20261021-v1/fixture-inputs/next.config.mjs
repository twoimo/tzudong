import {prepareMapLibreWorkerAssets} from "/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong/apps/web/scripts/prepare-maplibre-worker-assets.mjs";
const workerAssets=prepareMapLibreWorkerAssets("/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong/apps/web");
export default {
 env:{NEXT_PUBLIC_MAPLIBRE_WORKER_URL:workerAssets.workerUrl},
 async headers(){return [{source:'/scripts/maplibre/:path*',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]}]},
 experimental:{externalDir:true},
 webpack(config){config.resolve.alias['@/hooks/use-restaurants$']="/var/folders/8d/nwv_19w124zbq0dxqx2r1jn40000gn/T/tzudong-overseas-next-20261021-l0sl_zm6/fixture-restaurants.ts";config.resolve.alias['@']="/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong/apps/web";return config;}
};
