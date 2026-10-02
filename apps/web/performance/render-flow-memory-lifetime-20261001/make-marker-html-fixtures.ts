import {createIndividualMarkerHTML as before} from './original-cluster-marker.fixture';
import {createIndividualMarkerHTML as after} from '../../lib/cluster-marker';
import {writeFileSync} from 'node:fs';
const rows=[];
for(const category of ['한식','분식','중식'])for(const selected of [false,true])for(const visits of [0,2,99,199]){
 const id='synthetic-<escaped>-marker';rows.push({category,selected,visits,before:before(category,selected,visits,id),after:after(category,selected,visits,id)});
}
writeFileSync(new URL(process.argv[2]||'marker-html-fixtures-v1.json',import.meta.url),JSON.stringify(rows)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:rows.length,codeGeneratedFixture:true,requestBody:false}));
