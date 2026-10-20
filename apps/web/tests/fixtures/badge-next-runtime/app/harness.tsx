"use client";

import { useEffect, useState } from "react";
import { PopularityBadge } from "@/components/restaurant/PopularityBadge";

export default function Harness({ enabled }: { enabled: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => { setHydrated(true); }, []);
  return <section data-hydrated={hydrated}>
    <button onClick={() => setVisible(false)}>Unmount badge</button>
    {visible ? <PopularityBadge tier="fire" experimental3D={enabled} /> : null}
  </section>;
}
