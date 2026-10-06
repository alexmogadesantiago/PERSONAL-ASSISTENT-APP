/** Shown on every screen while demo mode is on: sample data, nothing is sent. */
import { useDemoMode, useMemoryMutations } from "@/hooks/platform";
import { Button } from "@/components/ui";

export function DemoBanner() {
  const demo = useDemoMode();
  const m = useMemoryMutations();
  if (!demo) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-accent/15 px-4 py-1.5 text-xs text-fg">
      <span className="font-semibold text-accent">Demo mode</span>
      <span className="text-muted">Sample data · nothing is sent and your accounts are not touched</span>
      <Button size="xs" variant="ghost" loading={m.setPreference.isPending} onClick={() => m.setPreference.mutate({ key: "demo_mode", value: false })}>
        Turn off
      </Button>
    </div>
  );
}
