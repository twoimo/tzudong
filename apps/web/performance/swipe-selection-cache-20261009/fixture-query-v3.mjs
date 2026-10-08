function valuesIn(text) {
  if(!text.startsWith('in.(')||!text.endsWith(')'))throw Error('fixture_predicate_unsupported');
  const body=text.slice(4,-1),values=[];let token='',quoted=false,escaped=false;
  for(const character of body){
    if(escaped){token+=character;escaped=false;continue;}
    if(quoted&&character==='\\'){token+=character;escaped=true;continue;}
    if(character==='"'){quoted=!quoted;token+=character;continue;}
    if(character===','&&!quoted){values.push(token);token='';}else token+=character;
  }
  if(quoted||escaped)throw Error('fixture_predicate_unsupported');
  if(token)values.push(token);
  return values.map(value=>value.startsWith('"')?JSON.parse(value):value);
}
function matches(value,predicate) {
  if(predicate.startsWith('in.('))return valuesIn(predicate).includes(String(value));
  if(predicate.startsWith('eq.'))return String(value)===predicate.slice(3);
  if(predicate.startsWith('ilike.')){
    const expression=predicate.slice(6).split(/[%*]/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp(`^${expression}$`,'i').test(String(value??''));
  }
  if(predicate.startsWith('gte.'))return Number(value)>=Number(predicate.slice(4));
  if(predicate.startsWith('lte.'))return Number(value)<=Number(predicate.slice(4));
  throw Error('fixture_predicate_unsupported');
}
export function fixtureQuery(rows,parameters) {
  let data=rows;
  for(const field of ['id','approved_name','status','lat','lng','review_count']){
    for(const predicate of parameters.getAll(field))data=data.filter(row=>matches(row[field],predicate));
  }
  const category=parameters.get('categories');
  if(category){
    if(!/^(?:ov|cs)\.\{[^{}]*\}$/.test(category))throw Error('fixture_predicate_unsupported');
    const values=category.slice(4,-1).split(',').map(value=>value.replace(/^"|"$/g,''));
    data=data.filter(row=>category.startsWith('cs.')?values.every(value=>row.categories?.includes(value)):values.some(value=>row.categories?.includes(value)));
  }
  const or=parameters.get('or');
  if(or){
    if(!/^\([^()]*\)$/.test(or))throw Error('fixture_predicate_unsupported');
    const predicates=or.slice(1,-1).split(',').map(value=>{const dot=value.indexOf('.');return [value.slice(0,dot),value.slice(dot+1)];});
    if(predicates.some(([field])=>!['approved_name','road_address','jibun_address','english_address'].includes(field)))throw Error('fixture_predicate_unsupported');
    data=data.filter(row=>predicates.some(([field,predicate])=>matches(row[field],predicate)));
  }
  const order=parameters.get('order');
  if(order){const [field,direction]=order.split('.');if(!['approved_name','id'].includes(field)||!['asc','desc'].includes(direction))throw Error('fixture_order_unsupported');data=[...data].sort((left,right)=>{const a=String(left[field]),b=String(right[field]);return (a<b?-1:a>b?1:0)*(direction==='asc'?1:-1);});}
  const total=data.length,limit=Number(parameters.get('limit')??total),offset=Number(parameters.get('offset')??0);
  if(!Number.isSafeInteger(limit)||limit<0||!Number.isSafeInteger(offset)||offset<0)throw Error('fixture_range_unsupported');
  data=data.slice(offset,offset+limit);
  const select=parameters.get('select')??'*';
  if(select!=='*'){
    const columns=select.split(',').map(value=>value.trim().split(':'));
    if(columns.some(parts=>parts.length>2||parts.some(part=>!/^[a-z_][a-z0-9_]*$/i.test(part))))throw Error('fixture_select_unsupported');
    data=data.map(row=>Object.fromEntries(columns.map(parts=>[parts[0],row[parts[1]??parts[0]]??null])));
  }
  return {data,total};
}
