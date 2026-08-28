"use client";

import type { PlatformIdentityResponse } from "@curve-ai/platform-client";
import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORM_ORGANIZATION_COOKIE } from "@/lib/platform-auth";

type Organization = PlatformIdentityResponse["organizations"][number];

export function OrganizationSwitcher({
  organizations,
  selected,
}: {
  organizations: readonly Organization[];
  selected: Organization;
}) {
  const router = useRouter();
  return (
    <Select
      value={selected.slug}
      onValueChange={(slug) => {
        if (!organizations.some((organization) => organization.slug === slug)) {
          return;
        }
        document.cookie = `${PLATFORM_ORGANIZATION_COOKIE}=${encodeURIComponent(slug)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        router.push("/workspace");
        router.refresh();
      }}
    >
      <SelectTrigger
        aria-label="Organization"
        className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus:ring-1 focus:ring-ring focus:ring-offset-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {organizations.map((organization) => (
          <SelectItem key={organization.id} value={organization.slug}>
            {organization.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
