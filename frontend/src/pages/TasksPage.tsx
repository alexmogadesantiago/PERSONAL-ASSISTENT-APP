/**
 * Tasks - what you have to do, usually extracted from an email.
 * Add one yourself, tick it off, see what is overdue. Stored locally.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTaskMutations, useTasks, type Task } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { ICheck, IClock, ITrash } from "@/components/icons2";
import { cn } from "@/utils/cn";

function due(t: Task) {
  if (!t.due_at) return null;
  return new Date(t.due_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function TasksPage() {
  const toast = useToast();
  const [view, setView] = useState<"open" | "done">("open");
  const tasks = useTasks(view);
  const m = useTaskMutations();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const list = tasks.data ?? [];

  async function add() {
    try {
      await m.create.mutateAsync({ title: title.trim(), due: date || null });
      setTitle("");
      setDate("");
    } catch (e) {
      toast.error("Could not add it", errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Tasks"
        title="What you have to do"
        description="Tasks the assistant finds in your email, plus the ones you add. Deadlines also appear in your briefing."
        actions={<Segmented label="Task list" size="sm" value={view} onChange={setView} options={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }]} />}
      />
      <Card className="mb-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void add();
          }}
        >
          <Input aria-label="New task" placeholder="Send the TDR presentation" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="Due date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
          <Button type="submit" disabled={!title.trim()} loading={m.create.isPending}>
            Add task
          </Button>
        </form>
      </Card>

      {tasks.isLoading ? (
        <Skeleton className="h-40" />
      ) : tasks.isError ? (
        <EmptyState title="Tasks could not be loaded" description={errorMessage(tasks.error)} action={<Button onClick={() => tasks.refetch()}>Try again</Button>} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ICheck />}
          title={view === "open" ? "Nothing to do" : "No finished tasks yet"}
          description={view === "open" ? "Open an email and the assistant will point out what it asks of you." : "Tasks you complete show up here."}
          action={view === "open" ? <Link className="text-sm font-medium text-brand hover:underline" to="/inbox">Open your inbox</Link> : undefined}
        />
      ) : (
        <ul className="card divide-y divide-border">
          {list.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={t.status === "done"}
                aria-label={t.status === "done" ? `Reopen ${t.title}` : `Complete ${t.title}`}
                onClick={() => m.update.mutate({ id: t.id, patch: { status: t.status === "done" ? "open" : "done" } })}
                className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 ring-inset transition", t.status === "done" ? "bg-ok/20 text-ok ring-ok/40" : "ring-border-strong hover:ring-brand")}
              >
                {t.status === "done" && <ICheck width={13} height={13} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm text-fg", t.status === "done" && "text-muted line-through")}>{t.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {due(t) && (
                    <Badge tone={t.overdue ? "danger" : t.due_soon ? "warning" : "neutral"}>
                      <IClock width={11} height={11} /> {t.overdue ? "Overdue · " : ""}
                      {due(t)}
                    </Badge>
                  )}
                  {t.source.message_id && (
                    <Link to={`/inbox?id=${t.source.message_id}`} className="text-brand hover:underline">
                      From an email{t.source.from ? ` · ${t.source.from.split("<")[0].trim()}` : ""}
                    </Link>
                  )}
                </p>
              </div>
              <Button size="xs" variant="ghost" icon={<ITrash width={13} height={13} />} aria-label={`Delete ${t.title}`} onClick={() => m.remove.mutate(t.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
