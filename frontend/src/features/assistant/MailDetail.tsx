/**
 * One email, opened: the AI's reading of it and everything you can do next.
 *
 * Nothing sensitive happens on its own. Replies are drafted (any of four
 * tones), edited by you, and sent only after an explicit confirmation. Archive
 * and "mark important" need the optional "Organize Gmail" permission; when it
 * is missing the message says so and points to the connection.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { assistantApi, automationsApi, type MailAnalysis, type MailItem, type Tone } from "@/api/platform";
import { useTaskMutations } from "@/hooks/platform";
import { useToast } from "@/stores/toast";
import { errorMessage } from "@/components/common";
import { Badge, Button, ButtonLink, ConfirmDialog, Drawer, Segmented, Skeleton } from "@/components/ui";
import { IBolt, ICalendar, ICheck, IMail, ISend, ISparkles } from "@/components/icons2";
import { formatDateTime } from "@/utils/format";
import { PriorityBadge, PriorityWhy } from "./PriorityBadge";

export function senderName(from: string) {
  return from.split("<")[0].replace(/"/g, "").trim() || from;
}

const TONES: { value: Tone; label: string }[] = [
  { value: "formal", label: "Formal" },
  { value: "informal", label: "Informal" },
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
];

export function MailDetail({ m, onClose }: { m: MailItem; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tasks = useTaskMutations();
  const full = useQuery({ queryKey: ["mail", m.id], queryFn: () => assistantApi.read(m.id) });
  const analyze = useMutation({
    mutationFn: () => assistantApi.analyze(m.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assistant", "mail"] }),
  });
  const draft = useMutation({ mutationFn: (tone: Tone) => assistantApi.draft(m.id, "", tone) });
  const send = useMutation({ mutationFn: (body: string) => assistantApi.reply(m.id, body) });
  const [reply, setReply] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("default");
  const [confirmSend, setConfirmSend] = useState(false);
  const [addedTasks, setAddedTasks] = useState<string[]>([]);
  const a: MailAnalysis | undefined = analyze.data;
  const body = full.data?.text || m.snippet;

  async function writeReply(t: Tone) {
    setTone(t);
    try {
      setReply((await draft.mutateAsync(t)).body);
    } catch (e) {
      toast.error("Could not draft a reply", errorMessage(e));
    }
  }

  async function addToCalendar() {
    if (!a?.deadline) return;
    try {
      const r = await automationsApi.test({
        name: "Reminder",
        description: "",
        trigger: { block: "manual", params: {} },
        steps: [
          {
            block: "calendar.create_event",
            params: { title: a.deadline_title || m.subject, start: a.deadline, duration_minutes: 30, description: `From: ${m.from}\n${a.summary}` },
          },
        ],
      });
      if (r.ok) toast.success("Added to your calendar", a.deadline_title ?? m.subject);
      else toast.error("Could not add it", r.steps.find((x) => !x.ok)?.error?.message);
    } catch (e) {
      toast.error("Could not add it", errorMessage(e));
    }
  }

  async function createTask(title: string, due: string | null) {
    try {
      await tasks.create.mutateAsync({ title, due, source: { type: "email", message_id: m.id, subject: m.subject, from: m.from } });
      setAddedTasks((l) => [...l, title]);
      toast.success("Task created", title);
    } catch (e) {
      toast.error("Could not create the task", errorMessage(e));
    }
  }

  async function modify(action: "archive" | "important") {
    try {
      const r = await assistantApi.modify(m.id, action);
      if (r.demo) toast.info("Demo mode", r.message);
      else {
        toast.success(action === "archive" ? "Archived" : "Marked important");
        qc.invalidateQueries({ queryKey: ["assistant", "mail"] });
        if (action === "archive") onClose();
      }
    } catch (e) {
      toast.error(action === "archive" ? "Could not archive" : "Could not mark it", errorMessage(e));
    }
  }

  function automateSender() {
    const addr = a?.sender || (m.from.match(/<([^>]+)>/)?.[1] ?? m.from);
    navigate(`/automations/new?prompt=${encodeURIComponent(`When I receive an email from ${addr}, summarise it and send it to me on Telegram`)}`);
  }

  const detected = (a?.tasks ?? []).filter((t) => t.title);

  return (
    <Drawer open onClose={onClose} width="lg" title={m.subject || "(no subject)"} description={`${m.from} · ${formatDateTime(m.date)}`}>
      <div className="space-y-5">
        {/* ------------------------------------------------------ AI analysis */}
        <section aria-label="AI analysis" className="ai-surface rounded-2xl border border-brand/20 p-4">
          {!a ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">Let the assistant read it: priority, what to do, deadlines.</p>
              <Button variant="ai" size="sm" loading={analyze.isPending} icon={<ISparkles width={14} height={14} />} onClick={() => analyze.mutate()}>
                {analyze.isPending ? "Reading…" : "Analyze with AI"}
              </Button>
              {analyze.isError && <p className="w-full text-xs text-danger">{errorMessage(analyze.error)}</p>}
            </div>
          ) : (
            <div className="animate-in-up space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <PriorityBadge level={a.priority}>Priority: {a.priority}</PriorityBadge>
                <Badge tone="brand">{a.category}</Badge>
                <Badge tone={a.action_required ? "warning" : "neutral"}>Action required: {a.action_required ? "yes" : "no"}</Badge>
                {a.demo && <Badge tone="accent">demo</Badge>}
              </div>
              <p className="text-sm text-fg">{a.summary}</p>
              {a.suggested_action && <p className="text-xs text-muted">Suggested: {a.suggested_action}</p>}
              <PriorityWhy level={a.priority} reasons={a.priority_reasons ?? []} />

              {a.deadline && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface/70 p-2.5 text-sm">
                  <ICalendar width={15} height={15} className="text-info" />
                  <span className="min-w-0 flex-1 text-fg">
                    Deadline detected · {formatDateTime(a.deadline)}
                  </span>
                  <Button size="xs" variant="secondary" onClick={addToCalendar}>
                    Add to Calendar
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => createTask(a.deadline_title || m.subject, a.deadline)}>
                    Create task
                  </Button>
                </div>
              )}

              {detected.map((t) => (
                <div key={t.title} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface/70 p-2.5 text-sm">
                  <ICheck width={15} height={15} className="text-ok" />
                  <span className="min-w-0 flex-1 text-fg">
                    <span className="text-xs text-muted">Action detected</span>
                    <br />
                    {t.title}
                    {t.due && <span className="text-xs text-muted"> · due {formatDateTime(t.due)}</span>}
                  </span>
                  <Button size="xs" variant="secondary" disabled={addedTasks.includes(t.title)} onClick={() => createTask(t.title, t.due)}>
                    {addedTasks.includes(t.title) ? "Created" : "Create task"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ AI actions */}
        <section aria-label="Actions">
          <p className="eyebrow mb-2">Do something with it</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<ISparkles width={14} height={14} />} loading={analyze.isPending} onClick={() => analyze.mutate()}>
              {a ? "Summarize again" : "Summarize"}
            </Button>
            <Button size="sm" variant="secondary" icon={<IMail width={14} height={14} />} loading={draft.isPending && tone === "default"} onClick={() => writeReply("default")}>
              Reply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => writeReply("formal")}>
              Reply professionally
            </Button>
            <Button size="sm" variant="secondary" onClick={() => writeReply("concise")}>
              Reply briefly
            </Button>
            <Button size="sm" variant="ghost" onClick={() => modify("important")}>
              Mark important
            </Button>
            <Button size="sm" variant="ghost" onClick={() => modify("archive")}>
              Archive
            </Button>
            <Button size="sm" variant="ghost" icon={<IBolt width={14} height={14} />} onClick={automateSender}>
              Automate emails from this sender
            </Button>
          </div>
        </section>

        <div>
          <p className="eyebrow mb-2">Message</p>
          {full.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <pre className="max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2/60 p-4 font-sans text-sm text-fg">{body}</pre>
          )}
          {m.attachments?.length > 0 && <p className="mt-2 text-xs text-muted">📎 {m.attachments.map((x) => x.filename).join(", ")}</p>}
        </div>

        {/* ------------------------------------------------------------ reply */}
        {(reply !== null || draft.isPending) && (
          <section aria-label="Reply" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="eyebrow">Your reply · nothing is sent until you confirm</p>
              <Segmented label="Tone" size="sm" value={tone === "default" ? "formal" : tone} onChange={(t) => writeReply(t)} options={TONES} />
            </div>
            {draft.isPending ? (
              <Skeleton className="h-36" />
            ) : (
              <textarea value={reply ?? ""} onChange={(e) => setReply(e.target.value)} rows={6} className="input resize-y" aria-label="Reply" />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReply(null)}>
                Discard
              </Button>
              <Button icon={<ISend width={14} height={14} />} disabled={!reply?.trim() || draft.isPending} onClick={() => setConfirmSend(true)}>
                Review and send
              </Button>
            </div>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {reply === null && !draft.isPending && (
            <Button variant="ghost" size="sm" onClick={() => setReply("")}>
              Write a reply myself
            </Button>
          )}
          <ButtonLink to={m.link} variant="ghost" size="sm">
            Open in Gmail
          </ButtonLink>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        title={`Send this reply to ${senderName(m.from)}?`}
        message={(reply ?? "").slice(0, 400)}
        confirmLabel="Send reply"
        onConfirm={async () => {
          try {
            const r = await send.mutateAsync(reply ?? "");
            if (r.demo) toast.info("Demo mode", "Nothing was sent.");
            else {
              toast.success("Reply sent", `To ${senderName(m.from)}`);
              onClose();
            }
          } catch (e) {
            toast.error("Not sent", errorMessage(e));
          }
        }}
      />
    </Drawer>
  );
}
