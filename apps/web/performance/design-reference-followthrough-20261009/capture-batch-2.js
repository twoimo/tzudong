await fs.mkdir('./artifacts/design-reference-followthrough-20261009', {recursive:true});
console.log({captureRoot:pwd});
const refsBatch2 = [{"index": 5, "name": "Loadmore", "url": "https://loadmo.re/"}, {"index": 6, "name": "Beautiful UI", "url": "https://beautifului.dev/"}, {"index": 7, "name": "BeUI", "url": "https://beui.dev/"}, {"index": 8, "name": "Rare UI", "url": "https://rareui.com/"}];
const recordsBatch2 = [];
for (const ref of refsBatch2) {
 let ownedPage;
 try {
  ownedPage = await openTab(ref.url);
  const state = await snapshot(ownedPage, {interactive:true});
  console.log(state.tree);
  const name = String(ref.index).padStart(2,'0')+'-reference.png';
  await fs.writeFile('./artifacts/design-reference-followthrough-20261009/'+name, Buffer.from(await ownedPage.screenshot()));
  recordsBatch2.push({...ref, actualUrl:ownedPage.url(), title:await ownedPage.title(), screenshot:name});
 } catch { recordsBatch2.push({...ref, failure:'browser_capture_unavailable'}); }
 finally { if (ownedPage) await closeTab(ownedPage); }
 await fs.writeFile('./artifacts/design-reference-followthrough-20261009/records-batch-2.json', JSON.stringify(recordsBatch2,null,2));
}
console.log({captureRoot:pwd,records:recordsBatch2});
