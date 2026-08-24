import { Avatar, AvatarFallback } from "@renderer/components/ui/avatar";
import type { ReactNode } from "react";

export function UserAvatar({ size = 24 }: { size?: number }): ReactNode {
  return (
    <Avatar style={{ width: size, height: size }}>
      <AvatarFallback className="bg-primary text-[0.5rem] leading-none text-primary-foreground">
        R
      </AvatarFallback>
    </Avatar>
  );
}
