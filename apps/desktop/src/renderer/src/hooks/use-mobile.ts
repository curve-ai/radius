import * as React from "react";

// Radius is a desktop application whose native window cannot be narrower than
// 480px. Keep desktop navigation behavior across every supported window size.
const MOBILE_BREAKPOINT = 480;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    );
    const update = (): void =>
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mediaQuery.addEventListener("change", update);
    update();

    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
}
