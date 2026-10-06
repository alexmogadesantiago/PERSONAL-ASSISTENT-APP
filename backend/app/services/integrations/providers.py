"""The four integration pillars, described once.

Everything the Integrations Hub shows about a provider - its services, the
scopes each service asks for, the human sentence for every permission, where
its OAuth endpoints live - comes from this module. The OAuth flow, the health
checks and the frontend catalogue all read the same objects, so a scope can
never be requested without the user being told what it means.

Scopes follow least privilege: Drive asks for `drive.file` (only files this
app created or the user opened with it), Calendar for `calendar.events`, Gmail
for read + send rather than full mailbox control.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Permission:
    scope: str
    label: str
    #: "read" | "write" - drives the icon and the sort order in the UI
    access: str = "read"


@dataclass(frozen=True)
class Service:
    key: str
    label: str
    description: str
    permissions: tuple[Permission, ...]
    #: n8n-free capabilities the automation builder can offer for this service
    capabilities: tuple[str, ...] = ()

    @property
    def scopes(self) -> tuple[str, ...]:
        return tuple(p.scope for p in self.permissions)


@dataclass(frozen=True)
class Provider:
    key: str
    label: str
    tagline: str
    description: str
    #: "oauth2" or "bot_token"
    auth: str
    services: tuple[Service, ...]
    #: service_configs row holding the OAuth app (client secret + meta.client_id)
    oauth_app: str = ""
    authorize_url: str = ""
    token_url: str = ""
    revoke_url: str = ""
    #: scopes requested whatever services are picked (identity, refresh)
    base_scopes: tuple[str, ...] = ()
    scope_separator: str = " "
    extra_authorize_params: dict = field(default_factory=dict)
    pkce: bool = True
    docs_url: str = ""
    console_url: str = ""
    #: services ticked by default in the connect dialog
    default_services: tuple[str, ...] = ()

    def service(self, key: str) -> Service | None:
        return next((s for s in self.services if s.key == key), None)

    def scopes_for(self, service_keys: list[str] | tuple[str, ...]) -> list[str]:
        scopes: list[str] = list(self.base_scopes)
        for key in service_keys:
            svc = self.service(key)
            if svc is None:
                continue
            for scope in svc.scopes:
                if scope not in scopes:
                    scopes.append(scope)
        return scopes

    def services_granted(self, granted_scopes: list[str] | set[str]) -> list[str]:
        """A service counts as granted only when every one of its scopes is."""
        granted = set(granted_scopes)
        return [s.key for s in self.services if s.scopes and set(s.scopes) <= granted]


GOOGLE = Provider(
    key="google",
    label="Google Workspace",
    tagline="Gmail, Drive, Calendar, Sheets and Docs",
    description=(
        "Read and triage email, file attachments in Drive, create calendar events "
        "and log rows to Sheets - with your own Google account."
    ),
    auth="oauth2",
    oauth_app="google_oauth",
    authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
    token_url="https://oauth2.googleapis.com/token",
    revoke_url="https://oauth2.googleapis.com/revoke",
    base_scopes=("openid", "email", "profile"),
    # offline + consent is what yields a refresh token on every connect
    extra_authorize_params={"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"},
    docs_url="https://developers.google.com/identity/protocols/oauth2/web-server",
    console_url="https://console.cloud.google.com/apis/credentials",
    default_services=("gmail", "calendar", "drive"),
    services=(
        Service(
            "gmail", "Gmail", "Read, search and send email.",
            (
                Permission("https://www.googleapis.com/auth/gmail.readonly", "Read your email"),
                Permission("https://www.googleapis.com/auth/gmail.send", "Send email as you", "write"),
            ),
            ("gmail.new_email", "gmail.search", "gmail.send"),
        ),
        Service(
            "gmail_manage", "Organize Gmail", "Archive and mark messages important from the Inbox. Optional.",
            (Permission("https://www.googleapis.com/auth/gmail.modify", "Archive and label your email", "write"),),
        ),
        Service(
            "calendar", "Calendar", "See and create events.",
            (Permission("https://www.googleapis.com/auth/calendar.events", "View and edit calendar events", "write"),),
            ("calendar.list_events", "calendar.create_event"),
        ),
        Service(
            "drive", "Drive", "Save files the assistant creates.",
            (Permission("https://www.googleapis.com/auth/drive.file", "Create and manage files made by the assistant", "write"),),
            ("drive.save_text",),
        ),
        Service(
            "sheets", "Sheets", "Append rows to your spreadsheets.",
            (Permission("https://www.googleapis.com/auth/spreadsheets", "Read and edit your spreadsheets", "write"),),
            ("sheets.append_row",),
        ),
        Service(
            "docs", "Docs", "Create documents from summaries.",
            (Permission("https://www.googleapis.com/auth/documents", "Create and edit your documents", "write"),),
            ("docs.create",),
        ),
    ),
)

MICROSOFT = Provider(
    key="microsoft",
    label="Microsoft 365",
    tagline="Outlook, Calendar, OneDrive and Teams",
    description=(
        "The same assistant for Microsoft accounts: triage Outlook mail, schedule "
        "events, save to OneDrive and post to Teams through Microsoft Graph."
    ),
    auth="oauth2",
    oauth_app="microsoft_oauth",
    # `{tenant}` is filled from settings (default "common": personal + work)
    authorize_url="https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    token_url="https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    base_scopes=("openid", "email", "profile", "offline_access", "User.Read"),
    extra_authorize_params={"prompt": "select_account"},
    docs_url="https://learn.microsoft.com/graph/auth-v2-user",
    console_url="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    default_services=("outlook", "calendar"),
    services=(
        Service(
            "outlook", "Outlook", "Read and send mail.",
            (
                Permission("Mail.Read", "Read your mail"),
                Permission("Mail.Send", "Send mail as you", "write"),
            ),
            ("outlook.new_email", "outlook.search", "outlook.send"),
        ),
        Service(
            "calendar", "Calendar", "See and create events.",
            (Permission("Calendars.ReadWrite", "View and edit calendar events", "write"),),
            ("outlook_calendar.list_events",),
        ),
        Service(
            "onedrive", "OneDrive", "Save files the assistant creates.",
            (Permission("Files.ReadWrite", "Read and write your files", "write"),),
            ("onedrive.save_text",),
        ),
        Service(
            "teams", "Teams", "Post messages to channels you belong to.",
            (
                Permission("Team.ReadBasic.All", "See the teams you belong to"),
                Permission("ChannelMessage.Send", "Post messages to channels", "write"),
            ),
            ("teams.post",),
        ),
    ),
)

GITHUB = Provider(
    key="github",
    label="GitHub",
    tagline="Issues, pull requests, notifications and releases",
    description=(
        "Keep up with your repositories: get a digest of notifications and review "
        "requests, and open issues straight from an automation."
    ),
    auth="oauth2",
    oauth_app="github_oauth",
    authorize_url="https://github.com/login/oauth/authorize",
    token_url="https://github.com/login/oauth/access_token",
    base_scopes=("read:user", "user:email"),
    extra_authorize_params={"allow_signup": "false"},
    docs_url="https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
    console_url="https://github.com/settings/developers",
    default_services=("notifications", "repos"),
    services=(
        Service(
            "notifications", "Notifications", "Mentions, review requests and CI alerts.",
            (Permission("notifications", "Read your notifications"),),
            ("github.notifications",),
        ),
        Service(
            "repos", "Issues & pull requests", "Read activity and open issues.",
            (Permission("repo", "Read and write issues and pull requests", "write"),),
            ("github.create_issue", "github.pull_requests", "github.releases"),
        ),
    ),
)

TELEGRAM = Provider(
    key="telegram",
    label="Telegram",
    tagline="Your assistant's voice: messages, alerts and confirmations",
    description=(
        "Connect a bot from @BotFather and link your chat in one tap. Every "
        "automation can then message you, and failures reach you instantly."
    ),
    auth="bot_token",
    pkce=False,
    docs_url="https://core.telegram.org/bots/features#botfather",
    console_url="https://t.me/BotFather",
    default_services=("messages",),
    services=(
        Service(
            "messages", "Messages", "Send summaries, alerts and replies to your chat.",
            (Permission("bot:send", "Send messages to the chat you link", "write"),),
            ("telegram.send",),
        ),
    ),
)

PROVIDERS: dict[str, Provider] = {p.key: p for p in (GOOGLE, TELEGRAM, MICROSOFT, GITHUB)}


def get(key: str) -> Provider | None:
    return PROVIDERS.get((key or "").strip().lower())


def catalogue() -> list[dict]:
    """Browser-safe description of every provider (no configuration state)."""
    out = []
    for p in PROVIDERS.values():
        out.append({
            "key": p.key,
            "label": p.label,
            "tagline": p.tagline,
            "description": p.description,
            "auth": p.auth,
            "docs_url": p.docs_url,
            "console_url": p.console_url,
            "default_services": list(p.default_services),
            "services": [
                {
                    "key": s.key,
                    "label": s.label,
                    "description": s.description,
                    "capabilities": list(s.capabilities),
                    "permissions": [
                        {"scope": perm.scope, "label": perm.label, "access": perm.access}
                        for perm in s.permissions
                    ],
                }
                for s in p.services
            ],
        })
    return out
