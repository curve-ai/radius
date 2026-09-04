import type { ReactNode } from "react";

import { SETTINGS_SECTIONS } from "@renderer/components/shell/settings-sections";
import { ThemeSwitch } from "@renderer/components/ui/theme-switch";
import { AboutUpdates } from "./about-updates";
import { PlatformSyncSettings } from "./platform-sync-settings";
import { SettingsCard, SettingsRow } from "./settings-primitives";
import {
  AppConnectionSettings,
  NotificationSettings,
  PermissionSettings,
  WorkDefaults,
} from "./work-settings";

export function SettingsPage(): ReactNode {
  return (
    <div className="mx-auto w-full max-w-[800px] px-10 pb-20 pt-[4.25rem]">
      <div id={SETTINGS_SECTIONS.general.id} className="scroll-mt-8">
        <h1 className="type-md-lg">{SETTINGS_SECTIONS.general.label}</h1>

        <section className="mt-11" aria-labelledby="settings-work-title">
          <h2 id="settings-work-title" className="type-base">
            Work defaults
          </h2>
          <WorkDefaults />
        </section>
      </div>

      <section
        id={SETTINGS_SECTIONS.appearance.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-appearance-title"
      >
        <h2 id="settings-appearance-title" className="type-base">
          {SETTINGS_SECTIONS.appearance.label}
        </h2>
        <SettingsCard>
          <SettingsRow
            label="Theme"
            description="Follow this computer or choose a light or dark appearance."
          >
            <ThemeSwitch className="shrink-0" />
          </SettingsRow>
        </SettingsCard>
      </section>

      <section
        id={SETTINGS_SECTIONS.permissions.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-permissions-title"
      >
        <h2 id="settings-permissions-title" className="type-base">
          {SETTINGS_SECTIONS.permissions.label}
        </h2>
        <PermissionSettings />
      </section>

      <section
        id={SETTINGS_SECTIONS.notifications.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-notifications-title"
      >
        <h2 id="settings-notifications-title" className="type-base">
          {SETTINGS_SECTIONS.notifications.label}
        </h2>
        <NotificationSettings />
      </section>

      <section
        id={SETTINGS_SECTIONS.apps.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-apps-title"
      >
        <h2 id="settings-apps-title" className="type-base">
          {SETTINGS_SECTIONS.apps.label}
        </h2>
        <AppConnectionSettings />
      </section>

      <section
        id={SETTINGS_SECTIONS.cloud.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-cloud-title"
      >
        <h2 id="settings-cloud-title" className="type-base">
          {SETTINGS_SECTIONS.cloud.label}
        </h2>
        <PlatformSyncSettings />
      </section>

      <section
        id={SETTINGS_SECTIONS.about.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-about-title"
      >
        <h2 id="settings-about-title" className="type-base">
          {SETTINGS_SECTIONS.about.label}
        </h2>
        <AboutUpdates />
      </section>
    </div>
  );
}
