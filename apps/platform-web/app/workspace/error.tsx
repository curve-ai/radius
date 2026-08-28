"use client";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md">
        <h1 className="type-md-lg font-normal text-foreground">
          Platform unavailable
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Check the Platform API origin and server-side access token, then try
          again.
        </p>
        <Button type="button" className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
