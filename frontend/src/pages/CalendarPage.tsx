/**
 * Calendar - your next days, and a way to add to them.
 *
 * Reads and creates events in the primary Google Calendar through the
 * connection from Integrations. Creating an event is an explicit action: you
 * fill the form and press Add. Nothing is ever deleted from here.
 */
import { useMemo, useState } from "react";
import { ApiError } from "@/api";
import type { CalendarEvent } from "@/api/platform";
import { useCalendar, useCreateEvent } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, Card, CardTitle, EmptyState, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { ICalendar, IPlus, IRefresh, ProviderMark } from "@/components/icons2";

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function dayKey(iso: string | null) {
  return iso ? iso.slice(0, 10) : "";
}

function time(e: CalendarEvent) {
  if (!e.start || e.start.length <= 10) return "All day";
  const d = new Date(e.start);
  return Number.isNaN(d.getTime()) ? e.start.slice(11, 16) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function CalendarPage() {
  const toast = useToast();
  const [days, setDays] = useState<1 | 7 | 14>(7);
  const cal = useCalendar(days);
  const create = useCreateEvent();
  const soon = new Date(Date.now() + 3600e3);
  soon.setMinutes(0, 0, 0);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(localInput(soon));
  const [minutes, setMinutes] = useState("30");
  const notConnected = cal.error instanceof ApiError && cal.error.status === 409;
  const events = useMemo(() => cal.data?.data ?? [], [cal.data]);

  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) map.set(dayKey(e.start), [...(map.get(dayKey(e.start)) ?? []), e]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  async function add() {
    try {
      const r = await create.mutateAsync({ title: title.trim(), start, duration_minutes: Number(minutes) || 30 });
      if (r.created) {
        toast.success("Event added to your calendar", title.trim());
        setTitle("");
      } else toast.info("Demo mode", r.message);
    } catch (e) {
      toast.error("Could not add the event", errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Calendar"
        title="Your next days"
        description="Events from your Google Calendar. Add one here and it lands in your real calendar."
        actions={
          <>
            <Segmented
              label="Range"
              size="sm"
              value={String(days) as "1" | "7" | "14"}
              onChange={(v) => setDays(Number(v) as 1 | 7 | 14)}
              options={[{ value: "1", label: "Today" }, { value: "7", label: "7 days" }, { value: "14", label: "14 days" }]}
            />
            <Button variant="ghost" icon={<IRefresh width={15} height={15} />} loading={cal.isFetching} onClick={() => cal.refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      {notConnected ? (
        <EmptyState
          icon={<ProviderMark provider="google" size={24} />}
          title="Connect Google Calendar"
          description={errorMessage(cal.error)}
          action={<ButtonLink to="/integrations/google" variant="primary">Connect Google</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {cal.isLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading your calendar">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : cal.isError ? (
              <EmptyState
                icon={<ICalendar />}
                title="Your calendar could not be reached"
                description={`${errorMessage(cal.error)} Your email and tasks are still available.`}
                action={<Button onClick={() => cal.refetch()}>Try again</Button>}
              />
            ) : groups.length === 0 ? (
              <EmptyState icon={<ICalendar />} title="Nothing scheduled" description="No events in this range. Add one on the right." />
            ) : (
              groups.map(([day, list]) => (
                <Card key={day}>
                  <CardTitle>
                    {new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                  </CardTitle>
                  <ul className="divide-y divide-border">
                    {list.map((e, i) => (
                      <li key={`${e.title}-${i}`} className="flex items-start gap-3 py-2.5">
                        <span className="w-14 shrink-0 pt-0.5 text-sm tabular-nums text-muted">{time(e)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-fg">{e.title}</p>
                          {e.location && <p className="truncate text-xs text-muted">{e.location}</p>}
                        </div>
                        {e.link && (
                          <a href={e.link} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                            Open
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))
            )}
            {cal.data?.demo && <Badge tone="accent">Demo data</Badge>}
          </div>

          <Card className="h-fit">
            <CardTitle icon={<IPlus width={16} height={16} />} description="Created in your primary Google Calendar.">
              New event
            </CardTitle>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) void add();
              }}
            >
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunión con la tutora" />
              <Input label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              <Input label="Duration (minutes)" type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              <Button type="submit" className="w-full" disabled={!title.trim() || !start} loading={create.isPending}>
                Add to calendar
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
