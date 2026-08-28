import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="space-y-3" aria-label="Loading Platform workspace">
        <Skeleton className="h-24 w-full rounded-sm" />
        <Skeleton className="h-48 w-full rounded-sm" />
      </div>
    </main>
  );
}
