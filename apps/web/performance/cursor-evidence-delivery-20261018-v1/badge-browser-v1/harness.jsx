import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { PopularityBadge } from '../../../components/restaurant/PopularityBadge';
import '../../../styles/interface-motion.css';
function Harness() {
 const [identity,setIdentity]=useState('a');
 const [tier,setTier]=useState('fire');
 return <main data-harness="actual-badge-component">
  <p>Local synthetic public-tier fixture; no service/account data</p>
  <button onClick={()=>setTier(tier==='fire'?'rainbow':'fire')}>Change tier</button>
  <button onClick={()=>setIdentity(identity==='a'?'b':'a')}>Change restaurant</button>
  <section data-fixture-restaurant={identity}>
   <PopularityBadge key={`${identity}:${tier}`} tier={tier} experimental3D />
  </section>
 </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);
