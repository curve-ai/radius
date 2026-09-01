import type { ReactNode } from "react";

import { messageFileIconKind } from "./message-file-icon-utils";

export function MessageFileIcon({ fileName }: { fileName: string }): ReactNode {
  return (
    <span
      aria-hidden
      className="radius-message-file-icon"
      data-file-icon={messageFileIconKind(fileName)}
    />
  );
}
