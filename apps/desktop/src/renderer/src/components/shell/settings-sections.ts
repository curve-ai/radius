export const SETTINGS_SECTIONS = {
  general: { id: "settings-general", label: "General" },
  appearance: { id: "settings-appearance", label: "Appearance" },
  dataSync: { id: "data-sync", label: "Data & sync" },
} as const;

export const SETTINGS_SECTION_IDS = [
  SETTINGS_SECTIONS.general.id,
  SETTINGS_SECTIONS.appearance.id,
  SETTINGS_SECTIONS.dataSync.id,
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
