"""The blocks an automation is built from.

One description serves three readers: the builder UI (labels, fields, which
integration a block needs), the validator (required params, allowed values) and
the engine (`app.services.automations.actions` implements every key here).

Kinds:
    trigger    when the automation starts (exactly one)
    condition  keeps or drops each item
    ai         asks the configured model and adds fields to each item
    action     does something in a connected service
    transform  reshapes the item stream (no service)

Every field that accepts text can use {{field}} placeholders from the item
(e.g. {{subject}}, {{from}}, {{summary}}). The builder lists, per block, the
fields it adds so the UI can offer them.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    type: str = "text"  # text | textarea | number | select | bool | time | weekday
    required: bool = False
    default: object = None
    placeholder: str = ""
    help: str = ""
    options: tuple[tuple[str, str], ...] = ()
    templated: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key, "label": self.label, "type": self.type, "required": self.required,
            "default": self.default, "placeholder": self.placeholder, "help": self.help,
            "options": [{"value": v, "label": lbl} for v, lbl in self.options], "templated": self.templated,
        }


@dataclass(frozen=True)
class Block:
    key: str
    kind: str
    label: str
    description: str
    provider: str | None = None
    service: str | None = None
    params: tuple[Param, ...] = ()
    #: fields this block adds to (or produces on) each item
    outputs: tuple[str, ...] = ()
    icon: str = ""
    #: polling triggers need the engine to remember what it already returned
    polling: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key, "kind": self.kind, "label": self.label, "description": self.description,
            "provider": self.provider, "service": self.service, "icon": self.icon,
            "params": [p.as_dict() for p in self.params], "outputs": list(self.outputs), "polling": self.polling,
        }


EMAIL_FIELDS = ("from", "to", "subject", "date", "snippet", "text", "has_attachments", "link")
EVERY_MINUTES = Param("every_minutes", "Check every", "select", default="5",
                      options=(("5", "5 minutes"), ("15", "15 minutes"), ("60", "hour")))

BLOCKS: tuple[Block, ...] = (
    # ------------------------------------------------------------ triggers --
    Block("schedule", "trigger", "On a schedule", "Run every day, week or hour.", icon="clock",
          params=(
              Param("every", "Repeat", "select", True, "day",
                    options=(("hour", "Every hour"), ("day", "Every day"), ("weekdays", "Weekdays"), ("week", "Every week"))),
              Param("at", "At", "time", default="08:00"),
              Param("weekday", "On", "weekday", default="1", help="Only for weekly"),
          ), outputs=("now",)),
    Block("manual", "trigger", "Manually", "Only when you press Run.", icon="play", outputs=("now",)),
    Block("gmail.new_email", "trigger", "New email in Gmail", "Matching a Gmail search.", "google", "gmail",
          params=(Param("query", "Gmail search", default="in:inbox is:unread", placeholder="from:billing has:attachment",
                        help="Same syntax as the Gmail search box"), EVERY_MINUTES),
          outputs=EMAIL_FIELDS, icon="mail", polling=True),
    Block("outlook.new_email", "trigger", "New email in Outlook", "Unread mail in your inbox.", "microsoft", "outlook",
          params=(Param("search", "Contains", placeholder="invoice"), EVERY_MINUTES),
          outputs=EMAIL_FIELDS, icon="mail", polling=True),
    Block("github.notifications", "trigger", "New GitHub notification", "Mentions, reviews, CI.", "github", "notifications",
          params=(EVERY_MINUTES,), outputs=("title", "repo", "type", "reason", "link", "updated_at"),
          icon="github", polling=True),
    # --------------------------------------------------------- conditions --
    Block("condition.match", "condition", "Only if…", "Keep the items that match.", icon="filter",
          params=(
              Param("field", "Field", required=True, default="subject", placeholder="subject"),
              Param("operator", "Is", "select", True, "contains",
                    options=(("contains", "contains"), ("not_contains", "does not contain"), ("equals", "equals"),
                             ("starts_with", "starts with"), ("is_true", "is true"), ("is_false", "is false"),
                             ("is_empty", "is empty"), ("not_empty", "is not empty"))),
              Param("value", "Value", placeholder="invoice", help="Several values: separate with |"),
          )),
    # ----------------------------------------------------------------- AI --
    Block("ai.summarize", "ai", "Summarize", "A short summary of each item.", icon="sparkles",
          params=(Param("instruction", "Focus", "textarea", default="Summarize in two sentences.", templated=True),),
          outputs=("summary",)),
    Block("ai.classify", "ai", "Classify", "Pick a category for each item.", icon="sparkles",
          params=(Param("categories", "Categories", required=True, default="urgent, important, normal, ignore",
                        help="Comma separated"),
                  Param("instruction", "Guidance", "textarea", templated=True)),
          outputs=("category", "reason")),
    Block("ai.extract", "ai", "Extract information", "Pull named fields out of each item.", icon="sparkles",
          params=(Param("fields", "Fields", required=True, default="amount, due_date, vendor",
                        help="Comma separated; each becomes a field"),
                  Param("instruction", "Guidance", "textarea", templated=True)),
          outputs=("extracted",)),
    Block("ai.compose", "ai", "Write with AI", "Free-form: draft a reply, a post, a digest.", icon="sparkles",
          params=(Param("prompt", "Instruction", "textarea", True, templated=True,
                        placeholder="Write a polite reply to {{from}} about {{subject}}"),),
          outputs=("text",)),
    # ---------------------------------------------------------- transform --
    Block("transform.combine", "transform", "Combine into one", "Merge all items into a single digest item.",
          icon="layers", outputs=("items", "count")),
    # ------------------------------------------------------------ actions --
    Block("telegram.send", "action", "Send a Telegram message", "To the chat you linked.", "telegram", "messages",
          params=(Param("message", "Message", "textarea", True, "{{summary}}", templated=True),),
          outputs=("telegram_message_id",), icon="send"),
    Block("gmail.search", "action", "Find emails", "Search Gmail now.", "google", "gmail",
          params=(Param("query", "Gmail search", required=True, default="is:unread newer_than:7d"),
                  Param("max", "At most", "number", default=20)),
          outputs=EMAIL_FIELDS, icon="mail"),
    Block("gmail.send", "action", "Send an email", "From your Gmail account.", "google", "gmail",
          params=(Param("to", "To", required=True, templated=True), Param("subject", "Subject", required=True, templated=True),
                  Param("body", "Body", "textarea", True, templated=True)),
          outputs=("sent_message_id",), icon="mail"),
    Block("calendar.list_events", "action", "Get upcoming events", "From your primary calendar.", "google", "calendar",
          params=(Param("days", "Next", "select", default="1", options=(("1", "24 hours"), ("7", "7 days"))),),
          outputs=("title", "start", "end", "location", "link"), icon="calendar"),
    Block("calendar.create_event", "action", "Create a calendar event", "In your primary calendar.", "google", "calendar",
          params=(Param("title", "Title", required=True, templated=True), Param("start", "Starts", required=True, templated=True,
                        help="ISO date-time, e.g. {{extracted.date}}"),
                  Param("duration_minutes", "Duration (min)", "number", default=30),
                  Param("description", "Notes", "textarea", templated=True)),
          outputs=("event_link",), icon="calendar"),
    Block("drive.save_text", "action", "Save a file to Drive", "As a text/Markdown file.", "google", "drive",
          params=(Param("name", "File name", required=True, default="{{subject}}.md", templated=True),
                  Param("content", "Content", "textarea", True, "{{summary}}", templated=True)),
          outputs=("drive_link",), icon="drive"),
    Block("sheets.append_row", "action", "Add a row to Sheets", "Append values to a spreadsheet.", "google", "sheets",
          params=(Param("spreadsheet_id", "Spreadsheet ID", required=True, help="The long id in the sheet's URL"),
                  Param("sheet", "Sheet", default="Sheet1"),
                  Param("values", "Columns", required=True, default="{{date}} | {{from}} | {{subject}}", templated=True,
                        help="Separate columns with |")),
          outputs=("updated_range",), icon="table"),
    Block("docs.create", "action", "Create a Google Doc", "With the given content.", "google", "docs",
          params=(Param("title", "Title", required=True, templated=True), Param("content", "Content", "textarea", True, templated=True)),
          outputs=("doc_link",), icon="doc"),
    Block("outlook.send", "action", "Send an Outlook email", "From your Microsoft account.", "microsoft", "outlook",
          params=(Param("to", "To", required=True, templated=True), Param("subject", "Subject", required=True, templated=True),
                  Param("body", "Body", "textarea", True, templated=True)),
          outputs=(), icon="mail"),
    Block("outlook_calendar.list_events", "action", "Get Outlook events", "Upcoming events.", "microsoft", "calendar",
          params=(Param("days", "Next", "select", default="1", options=(("1", "24 hours"), ("7", "7 days"))),),
          outputs=("title", "start", "end", "location", "link"), icon="calendar"),
    Block("onedrive.save_text", "action", "Save a file to OneDrive", "In the Personal Assistant folder.", "microsoft", "onedrive",
          params=(Param("name", "File name", required=True, default="{{subject}}.md", templated=True),
                  Param("content", "Content", "textarea", True, "{{summary}}", templated=True)),
          outputs=("onedrive_link",), icon="drive"),
    Block("teams.post", "action", "Post to a Teams channel", "As you.", "microsoft", "teams",
          params=(Param("team_id", "Team ID", required=True), Param("channel_id", "Channel ID", required=True),
                  Param("message", "Message", "textarea", True, templated=True)),
          outputs=(), icon="chat"),
    Block("github.pull_requests", "action", "PRs waiting for my review", "Open pull requests requesting you.", "github", "repos",
          outputs=("title", "repo", "link", "author", "updated_at"), icon="github"),
    Block("github.releases", "action", "Latest releases", "Of a repository.", "github", "repos",
          params=(Param("repo", "Repository", required=True, placeholder="owner/name"),),
          outputs=("title", "tag", "link", "published_at"), icon="github"),
    Block("github.create_issue", "action", "Open a GitHub issue", "In a repository you can write to.", "github", "repos",
          params=(Param("repo", "Repository", required=True, placeholder="owner/name"),
                  Param("title", "Title", required=True, templated=True), Param("body", "Body", "textarea", templated=True)),
          outputs=("issue_link",), icon="github"),
)

BY_KEY: dict[str, Block] = {b.key: b for b in BLOCKS}


def get(key: str) -> Block | None:
    return BY_KEY.get(key)


def as_list() -> list[dict]:
    return [b.as_dict() for b in BLOCKS]
