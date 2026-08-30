import { type ReactNode } from "react";

import { NativeControlMenuButton } from "@renderer/components/shell/native-control-menu-button";
import type { NativeControlMenuPoint } from "../../../../radius-api";

export function ProjectActionMenu({
  onOpen,
  open,
  projectName,
}: {
  onOpen: (point: NativeControlMenuPoint) => void;
  open: boolean;
  projectName: string;
}): ReactNode {
  return (
    <NativeControlMenuButton
      open={open}
      onOpen={onOpen}
      ariaLabel={`More actions for ${projectName}`}
    />
  );
}

export function RecentsActionMenu({
  onOpen,
  open,
}: {
  onOpen: (point: NativeControlMenuPoint) => void;
  open: boolean;
}): ReactNode {
  return (
    <NativeControlMenuButton
      open={open}
      onOpen={onOpen}
      ariaLabel="More actions for Recents"
    />
  );
}
