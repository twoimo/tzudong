import { useState } from 'react';
import { useHomeViewportMode } from '@/hooks/useHomeViewportMode';
import { useDeviceType, useImmediateMobileOrTablet } from '@/hooks/useDeviceType';
import { useIsMobile } from '@/hooks/use-mobile';

export function NativeViewportProbe() {
  const home = useHomeViewportMode();
  const device = useDeviceType();
  const mobile = useIsMobile();

  return <output id="viewport-probe" data-home={home} data-mobile={String(mobile)}>
    {JSON.stringify(device)}
  </output>;
}

export function ImmediateViewportProbe() {
  const mobileOrTablet = useImmediateMobileOrTablet();
  const [initialMobileOrTablet] = useState(mobileOrTablet);
  return <output id="immediate-probe" data-initial-mobile={String(initialMobileOrTablet)}>{String(mobileOrTablet)}</output>;
}
