"use server";

import { revalidatePath } from "next/cache";

import { RadiusPlatformError } from "@curve-ai/platform-client";
import { formString, isUuid } from "@/app/workspace/action-input";
import { getPlatformContext } from "@/lib/platform-server";
import type { RevokeSyncDeviceActionState } from "./action-state";

export async function revokeSyncDeviceAction(
  _previousState: RevokeSyncDeviceActionState,
  formData: FormData,
): Promise<RevokeSyncDeviceActionState> {
  try {
    const context = await getPlatformContext();
    const expected = formData.get("organization");
    if (!context.organization || expected !== context.organization.slug) {
      return {
        status: "error",
        message: "The selected organization changed. Refresh and try again.",
      };
    }
    const deviceId = formString(formData, "deviceId");
    if (!isUuid(deviceId)) {
      return { status: "error", message: "The sync device is invalid." };
    }
    const result = await context.client.revokeSyncDevice(deviceId);
    revalidatePath("/workspace/sync");
    return {
      status: "success",
      message: `${result.device.displayName} can no longer sync.`,
    };
  } catch (error) {
    if (error instanceof RadiusPlatformError && error.status === 404) {
      return {
        status: "error",
        message: "That device is already revoked or is not yours.",
      };
    }
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "The device could not be revoked.",
    };
  }
}
