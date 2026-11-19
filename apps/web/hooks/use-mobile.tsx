import * as React from "react";
import { TABLET_MIN_WIDTH_QUERY } from "@/lib/viewport-breakpoints";

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(TABLET_MIN_WIDTH_QUERY);
    const onChange = () => {
      setIsMobile(!mql.matches);
    };
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
