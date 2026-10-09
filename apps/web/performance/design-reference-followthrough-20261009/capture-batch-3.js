await fs.mkdir('./artifacts/design-reference-followthrough-20261009', {recursive:true});
console.log({captureRoot:pwd});
const refsBatch3 = [{"index": 9, "name": "Transitions", "url": "https://transitions.dev/"}, {"index": 10, "name": "shadcn/ui", "url": "https://ui.shadcn.com/"}, {"index": 11, "name": "21st.dev", "url": "https://21st.dev/"}, {"index": 12, "name": "Tremor", "url": "https://tremor.so/"}];
const recordsBatch3 = [];
for (const ref of refsBatch3) {
 let ownedPage;
 try {
  ownedPage = await openTab(ref.url);
  const state = await snapshot(ownedPage, {interactive:true});
  console.log(state.tree);
  const name = String(ref.index).padStart(2,'0')+'-reference.png';
  await fs.writeFile('./artifacts/design-reference-followthrough-20261009/'+name, Buffer.from(await ownedPage.screenshot()));
  recordsBatch3.push({...ref, actualUrl:ownedPage.url(), title:await ownedPage.title(), screenshot:name});
 } catch { recordsBatch3.push({...ref, failure:'browser_capture_unavailable'}); }
 finally { if (ownedPage) await closeTab(ownedPage); }
 await fs.writeFile('./artifacts/design-reference-followthrough-20261009/records-batch-3.json', JSON.stringify(recordsBatch3,null,2));
}
console.log({captureRoot:pwd,records:recordsBatch3});
