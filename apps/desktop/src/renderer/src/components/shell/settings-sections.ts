export const SETTINGS_SECTIONS = {
  general: { id: "settings-general", label: "General" },
  appearance: { id: "settings-appearance", label: "Appearance" },
  permissions: { id: "settings-permissions", label: "Permissions" },
  notifications: { id: "settings-notifications", label: "Notifications" },
  apps: { id: "settings-apps", label: "Apps & connections" },
  about: { id: "settings-about", label: "About & updates" },
} as const;

export const SETTINGS_SECTION_IDS = [
  SETTINGS_SECTIONS.general.id,
  SETTINGS_SECTIONS.appearance.id,
  SETTINGS_SECTIONS.permissions.id,
  SETTINGS_SECTIONS.notifications.id,
  SETTINGS_SECTIONS.apps.id,
  SETTINGS_SECTIONS.about.id,
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
