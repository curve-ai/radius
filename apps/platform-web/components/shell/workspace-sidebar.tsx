"use client";

import {
  Bot,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PlatformIdentityResponse } from "@curve-ai/platform-client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Wordmark } from "@/components/ui/wordmark";
import type { PlatformWebAuthMode } from "@/lib/platform-auth";
import { canViewInstallations } from "@/lib/platform-permissions";
import { OrganizationSwitcher } from "./organization-switcher";

const links = [
  { label: "Overview", href: "/workspace", icon: LayoutDashboard },
  { label: "Agents", href: "/workspace/agents", icon: Bot },
  { label: "Devices", href: "/workspace/devices", icon: MonitorSmartphone },
  { label: "Sync", href: "/workspace/sync", icon: RefreshCw },
  { label: "Settings", href: "/workspace/settings", icon: Settings },
];

export function WorkspaceSidebar({
  identity,
  organization,
  authMode,
}: {
  identity: PlatformIdentityResponse;
  organization: PlatformIdentityResponse["organizations"][number] | undefined;
  authMode: PlatformWebAuthMode;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="fixed inset-y-0 z-50 h-dvh">
      <div className="flex h-full w-full flex-col bg-background">
        <SidebarHeader className="h-14 justify-center px-2">
          <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-start">
            <Link
              href="/workspace"
              className="min-w-0 flex-1 px-2 group-data-[collapsible=icon]:hidden"
              title="Go to workspace"
            >
              <Wordmark size="sm" showCube={false} />
            </Link>
            <SidebarTrigger className="size-8 shrink-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="pt-2">
            <SidebarGroupContent>
              <nav aria-label="Platform">
                <SidebarMenu>
                  {links
                    .filter(
                      (item) =>
                        item.href !== "/workspace/devices" ||
                        (organization &&
                          canViewInstallations(organization.role)),
                    )
                    .map((item) => {
                      const active =
                        pathname === item.href ||
                        (item.href !== "/workspace" &&
                          pathname.startsWith(`${item.href}/`));
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={item.label}
                          >
                            <Link
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                            >
                              <item.icon aria-hidden />
                              <span>{item.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-2">
          <div className="min-w-0 rounded-md px-2 py-2 group-data-[collapsible=icon]:hidden">
            {organization && identity.organizations.length > 1 ? (
              <OrganizationSwitcher
                organizations={identity.organizations}
                selected={organization}
              />
            ) : (
              <p className="truncate text-sm text-foreground">
                {organization?.displayName ?? "Radius Platform"}
              </p>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {organization
                ? `${organization.slug} - ${organization.role}`
                : identity.accountId}
            </p>
            {authMode === "browser-session" && (
              <form action="/auth/logout" method="post" className="mt-2">
                <button
                  type="submit"
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <LogOut aria-hidden className="size-3.5" />
                  Sign out
                </button>
              </form>
            )}
          </div>
        </SidebarFooter>
      </div>
      <SidebarRail />
    </Sidebar>
  );
}
