import { describe,expect,test } from 'bun:test';
import { EvaluationWarningStream } from '@/lib/admin/evaluation-warning-stream';
import { findSameVideoDuplicateWarningCandidates,formatSameVideoDuplicateWarning } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';

describe('bounded warning streams',()=>{
  test('matches whole-video counts, first evidence and top candidates across all page boundaries',()=>{
    const target={id:'target',origin_name:'같은 식당',approved_name:'같은 식당',youtube_link:'https://youtu.be/ABCDEFGHIJK',status:'pending'};
    const related=Array.from({length:10011},(_,i)=>({id:String(i),origin_name:i%3===0?'다른 식당':'같은 식당',approved_name:'같은 식당',
      status:i%4===0?'deleted':'pending',youtube_link:'https://youtu.be/ABCDEFGHIJK'}));
    const candidates=findSameVideoDuplicateWarningCandidates(target,related);
    const expected={sameVideo:{count:candidates.length,candidates:candidates.slice(0,3),message:formatSameVideoDuplicateWarning(candidates)},
      identity:findRestaurantIdentityWarnings(target,related)};
    for(const size of [1,50,200,777]){
      const stream=new EvaluationWarningStream(target);
      for(let i=0;i<related.length;i+=size)stream.add(related.slice(i,i+size));
      expect(stream.result()).toEqual(expected);
      expect(stream.result().sameVideo.candidates.length).toBeLessThanOrEqual(3);
    }
  });
  test('deleted targets keep every warning empty',()=>{
    const target={id:'target',origin_name:'same',status:'deleted',youtube_link:'https://youtu.be/ABCDEFGHIJK'};
    const stream=new EvaluationWarningStream(target);stream.add([{...target,id:'other'}]);
    expect(stream.result()).toEqual({sameVideo:{count:0,candidates:[],message:''},identity:[]});
  });
});
