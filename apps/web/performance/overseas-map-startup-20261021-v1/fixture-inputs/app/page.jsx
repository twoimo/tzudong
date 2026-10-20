import Client from './client';export default async function Page({searchParams}){const query=await searchParams;return <Client baseline={query.baseline==='1'}/>;}
