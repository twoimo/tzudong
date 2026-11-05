'use client';
import {useState,useEffect} from 'react';
const EMPTY:never[]=[];
export function useRestaurants(){const[pending,setPending]=useState(true);useEffect(()=>{const done=()=>setPending(false);window.addEventListener('fixture-data-ready',done);return()=>window.removeEventListener('fixture-data-ready',done)},[]);return{data:EMPTY,isLoading:pending};}
