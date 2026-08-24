import type { ThemePreference } from "../../../radius-api";

export type { ThemePreference } from "../../../radius-api";

export const THEME_STORAGE_KEY = "radius-theme";

export type ResolvedTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

export function readThemePreference(): ThemePreference {
  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this renderer session.
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  const resolvedTheme = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const root = document.documentElement;

  root.classList.toggle("light", resolvedTheme === "light");
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = preference;
}

export function initializeTheme(): ThemePreference {
  const preference = readThemePreference();
  applyThemePreference(preference);
  return preference;
}
