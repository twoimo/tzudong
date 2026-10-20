'use client';
import {Suspense,lazy,useState,useMemo} from 'react';
import {loadOverseasMap,preloadOverseasMap} from '@/lib/overseas-map-loader';
const Candidate=lazy(loadOverseasMap),Baseline=lazy(()=>import('./baseline-overseas-map'));
export default function Client({baseline}){
 const[shown,setShown]=useState(false),[country,setCountry]=useState('헝가리(부다페스트)');
 const filters=useMemo(()=>({categories:[],minRating:0,minReviews:0,minUserVisits:0,minJjyangVisits:0}),[]);
 const Map=baseline?Baseline:Candidate;
 const prepare=()=>{if(!baseline)preloadOverseasMap()};
 return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}>
  <div style={{height:56,display:'flex',gap:12,alignItems:'center',padding:8,flexShrink:0}}>
   <button onPointerEnter={prepare} onPointerDown={prepare} onFocus={prepare} onClick={()=>setShown(true)}>해외 지도 열기</button>
   <button onClick={()=>setCountry('일본(나고야)')}>일본</button>
   <button onClick={()=>setCountry('헝가리(부다페스트)')}>헝가리</button>
   <button onClick={()=>window.dispatchEvent(new Event('fixture-data-ready'))}>핀 준비 완료</button>
  </div>
  <div style={{flex:1,minHeight:0}}><Suspense fallback={<div role='status'>지도 모듈 준비 중</div>}>
   {shown&&<Map filters={filters} selectedCountry={country} searchedRestaurant={null} selectedRestaurant={null} refreshTrigger={0}/>}
  </Suspense></div>
 </div>
}
