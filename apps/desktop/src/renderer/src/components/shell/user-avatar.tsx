import { Avatar, AvatarFallback } from "@renderer/components/ui/avatar";
import type { ReactNode } from "react";
import {
  accountInitials,
  accountLabel,
  useAuthentication,
} from "@renderer/app/auth/authentication-context";

export function UserAvatar({ size = 24 }: { size?: number }): ReactNode {
  const status = useAuthentication();
  const label = accountLabel(status?.profile);
  return (
    <Avatar style={{ width: size, height: size }} aria-hidden="true">
      <AvatarFallback className="bg-primary text-[0.625rem] leading-none text-primary-foreground">
        {accountInitials(label)}
      </AvatarFallback>
    </Avatar>
  );
}
