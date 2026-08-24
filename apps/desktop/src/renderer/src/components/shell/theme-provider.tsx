import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ThemeContext,
  type ThemeContextValue,
} from "@renderer/components/shell/theme-context";
import {
  applyThemePreference,
  isThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  writeThemePreference,
  type ThemePreference,
} from "@renderer/lib/theme";

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference);

  const setTheme = useCallback((preference: ThemePreference): void => {
    writeThemePreference(preference);
    setThemeState(preference);
  }, []);

  useEffect(() => {
    applyThemePreference(theme);
    void window.radius.setNativeTheme(theme);

    if (theme !== "system") return;

    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = (): void => applyThemePreference("system");
    colorScheme.addEventListener("change", applySystemTheme);

    return () => colorScheme.removeEventListener("change", applySystemTheme);
  }, [theme]);

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY) return;

      const nextTheme = isThemePreference(event.newValue)
        ? event.newValue
        : "system";
      setThemeState(nextTheme);
    };

    window.addEventListener("storage", syncStoredTheme);
    return () => window.removeEventListener("storage", syncStoredTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [setTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
