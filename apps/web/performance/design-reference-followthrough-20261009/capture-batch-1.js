await fs.mkdir('./artifacts/design-reference-followthrough-20261009', {recursive:true});
console.log({captureRoot:pwd});
const refsBatch1 = [{"index": 1, "name": "Supahero", "url": "https://supahero.io/"}, {"index": 2, "name": "Dark Design", "url": "https://dark.design/"}, {"index": 3, "name": "Mac App Supply", "url": "https://macapp.supply/"}, {"index": 4, "name": "Layers", "url": "https://getlayers.ai/"}];
const recordsBatch1 = [];
for (const ref of refsBatch1) {
 let ownedPage;
 try {
  ownedPage = await openTab(ref.url);
  const state = await snapshot(ownedPage, {interactive:true});
  console.log(state.tree);
  const name = String(ref.index).padStart(2,'0')+'-reference.png';
  await fs.writeFile('./artifacts/design-reference-followthrough-20261009/'+name, Buffer.from(await ownedPage.screenshot()));
  recordsBatch1.push({...ref, actualUrl:ownedPage.url(), title:await ownedPage.title(), screenshot:name});
 } catch { recordsBatch1.push({...ref, failure:'browser_capture_unavailable'}); }
 finally { if (ownedPage) await closeTab(ownedPage); }
 await fs.writeFile('./artifacts/design-reference-followthrough-20261009/records-batch-1.json', JSON.stringify(recordsBatch1,null,2));
}
console.log({captureRoot:pwd,records:recordsBatch1});
