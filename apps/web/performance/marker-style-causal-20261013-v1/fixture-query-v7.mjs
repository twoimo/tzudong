// Scoped PostgREST fixture. Unsupported grammar fails instead of returning
// an unfiltered catalog. Known nullable columns absent from synthetic rows
// have SQL NULL semantics, including alias/address candidate lookups.
const columns = new Set(['id','unique_id','name','approved_name','origin_name','naver_name','google_name',
  'road_address','jibun_address','english_address','categories','status','lat','lng','review_count',
  'weekly_search_count','search_count','created_at','updated_at','youtube_link','youtube_meta',
  'tzuyang_review','evaluation_results','reasoning_basis','channel_name','phone','description',
  'source_type','origin_address','address_elements','geocoding_success','geocoding_false_stage',
  'is_missing','is_not_selected','ai_rating','visit_count','created_by','updated_by_admin_id',
  'db_error_message','db_error_details','trace_id','trace_id_name_source','description_map_url','recollect_version']);
const controls = new Set(['select','order','limit','offset','or']);
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
  if(predicate==='not.is.null')return value!==null&&value!==undefined;
  if(predicate==='is.null')return value===null||value===undefined;
  if(value===null||value===undefined)return false;
  if(predicate.startsWith('in.('))return valuesIn(predicate).includes(String(value));
  if(predicate.startsWith('eq.'))return String(value)===predicate.slice(3);
  if(predicate.startsWith('ilike.')){
    const expression=predicate.slice(6).split(/[%*]/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    return new RegExp(`^${expression}$`,'i').test(String(value??''));
  }
  if(predicate.startsWith('gt.'))return value!=null&&Number(value)>Number(predicate.slice(3));
  if(predicate.startsWith('lt.'))return value!=null&&Number(value)<Number(predicate.slice(3));
  if(predicate.startsWith('gte.'))return value!=null&&Number(value)>=Number(predicate.slice(4));
  if(predicate.startsWith('lte.'))return value!=null&&Number(value)<=Number(predicate.slice(4));
  throw Error('fixture_predicate_unsupported');
}
export function fixtureQuery(rows,parameters) {
  for(const field of parameters.keys()){
    if(!columns.has(field)&&!controls.has(field))throw Error('fixture_column_unsupported');
    if(controls.has(field)&&parameters.getAll(field).length!==1)throw Error('fixture_control_unsupported');
  }
  let data=rows;
  for(const field of columns){
    if(field==='categories')continue;
    for(const predicate of parameters.getAll(field)){matches(0,predicate);data=data.filter(row=>matches(row[field],predicate));}
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
    if(predicates.some(([field])=>!columns.has(field)))throw Error('fixture_column_unsupported');
    for(const [,predicate] of predicates)matches(0,predicate);
    data=data.filter(row=>predicates.some(([field,predicate])=>matches(row[field],predicate)));
  }
  const order=parameters.get('order');
  if(order){
    const parts=order.split('.'),[field,direction,nulls]=parts;
    if(parts.length<2||parts.length>3||!['approved_name','id','weekly_search_count','search_count','created_at','youtube_meta->>publishedAt'].includes(field)
      ||!['asc','desc'].includes(direction)||(nulls&&!['nullsfirst','nullslast'].includes(nulls)))throw Error('fixture_order_unsupported');
    const value=row=>field==='youtube_meta->>publishedAt'?row.youtube_meta?.publishedAt:row[field];
    const nullsFirst=nulls?nulls==='nullsfirst':direction==='desc';
    data=[...data].sort((left,right)=>{
      const a=value(left),b=value(right);
      if(a==null||b==null)return a==null&&b==null?0:(a==null?-1:1)*(nullsFirst?1:-1);
      return (a<b?-1:a>b?1:0)*(direction==='asc'?1:-1);
    });
  }
  const total=data.length,limit=Number(parameters.get('limit')??total),offset=Number(parameters.get('offset')??0);
  if(!Number.isSafeInteger(limit)||limit<0||!Number.isSafeInteger(offset)||offset<0)throw Error('fixture_range_unsupported');
  data=data.slice(offset,offset+limit);
  const select=parameters.get('select')??'*';
  if(select!=='*'){
    const selected=select.split(',').map(value=>value.trim().split(':'));
    if(selected.some(parts=>parts.length>2||parts.some(part=>!/^[a-z_][a-z0-9_]*$/i.test(part))
      ||!columns.has(parts[1]??parts[0])))throw Error('fixture_select_unsupported');
    data=data.map(row=>Object.fromEntries(selected.map(parts=>[parts[0],row[parts[1]??parts[0]]??null])));
  }
  return {data,total};
}
