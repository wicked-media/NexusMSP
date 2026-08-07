import { Skeleton } from "@/components/ui/skeleton";

export default function NexusPageSkeleton({
  label = "Loading workspace",
  tiles = 6,
  showSidebar = true,
}) {
  return (
    <div className="space-y-5" role="status" aria-live="polite" data-testid="nexus-page-skeleton">
      <span className="sr-only">{label}</span>
      <div className="rounded-2xl border border-border/70 bg-card/80 p-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-full max-w-sm" />
            <Skeleton className="h-3 w-full max-w-xl" />
          </div>
          <div className="hidden gap-2 lg:flex">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: tiles }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/70 bg-card/75 p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-7 w-7 rounded-lg" />
            </div>
            <Skeleton className="mt-4 h-7 w-20" />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className={`${showSidebar ? "col-span-12 xl:col-span-8" : "col-span-12"} rounded-xl border border-border/70 bg-card/75 p-5`}>
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-full max-w-lg" />
                  <Skeleton className="h-2.5 w-full max-w-xs" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {showSidebar && (
          <div className="col-span-12 space-y-4 xl:col-span-4">
            <div className="rounded-xl border border-border/70 bg-card/75 p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-5 h-24 w-full" />
            </div>
            <div className="rounded-xl border border-border/70 bg-card/75 p-5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
