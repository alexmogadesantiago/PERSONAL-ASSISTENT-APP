/**
 * The shell.
 *
 * Desktop: a calm sidebar (spine of the product, live error count, account) and
 * a slim header (search/command palette, system pulse, notifications, Ask AI).
 * Phone: the sidebar becomes a bottom tab bar for the four places used daily
 * plus a "More" sheet; nothing is hidden, only re-arranged for thumbs.
 */
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { useHealth } from "@/hooks/queries";
import { useErrorCenter, useOverview } from "@/hooks/platform";
import { Avatar, Drawer, Menu } from "@/components/ui";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { NotificationCenter } from "@/components/shell/NotificationCenter";
import { DemoBanner } from "@/components/shell/DemoBanner";
import { ShortcutsDialog, useGlobalShortcuts } from "@/components/shell/Shortcuts";
import { ILogout, IMoon, IMore, ISearch, ISettings, ISparkles, ISun, IUser } from "@/components/icons2";
import { adminNav, personalNav, primaryNav, titleFor, type NavItem } from "./nav";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-glow"
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M12 3.5c.9 3.8 4.7 7.6 8.5 8.5-3.8.9-7.6 4.7-8.5 8.5-.9-3.8-4.7-7.6-8.5-8.5 3.8-.9 7.6-4.7 8.5-8.5Z" />
      </svg>
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <BrandMark />
      <div className="leading-tight">
        <p className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-fg">Personal Assistant <span className="rounded-md bg-brand/15 px-1 text-[10px] font-semibold text-brand">3.0</span></p>
        <p className="text-[11px] text-subtle">AI · Automation · Integrations</p>
      </div>
    </div>
  );
}

function NavList({ items, onNavigate, errors }: { items: NavItem[]; onNavigate?: () => void; errors: number }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition duration-150",
              isActive ? "bg-surface-2 font-medium text-fg shadow-elev-1 ring-1 ring-inset ring-border" : "text-muted hover:bg-surface-2/60 hover:text-fg",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn("transition", isActive ? "text-brand" : "text-subtle group-hover:text-fg")} />
              <span className="flex-1">{label}</span>
              {badge === "errors" && errors > 0 && (
                <span className="rounded-full bg-danger/15 px-1.5 text-[11px] font-semibold tabular-nums text-danger">{errors}</span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function SystemPulse() {
  const overview = useOverview();
  const health = useHealth();
  const navigate = useNavigate();
  const state = health.isError ? "offline" : overview.data?.system.state ?? (health.data ? "operational" : "checking");
  const meta = {
    operational: { dot: "bg-ok", label: "All systems normal", ring: "ring-ok/20" },
    degraded: { dot: "bg-warn", label: "Some things need a look", ring: "ring-warn/25" },
    attention: { dot: "bg-danger", label: "Needs your attention", ring: "ring-danger/25" },
    offline: { dot: "bg-danger", label: "Backend offline", ring: "ring-danger/25" },
    checking: { dot: "bg-subtle", label: "Checking…", ring: "ring-border" },
  }[state as "operational"];
  return (
    <button
      type="button"
      onClick={() => navigate(state === "operational" ? "/activity" : "/errors")}
      className={cn("hidden items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs text-muted ring-1 ring-inset transition hover:text-fg md:inline-flex", meta.ring)}
      title={overview.data?.system.message}
    >
      <span className="relative flex h-2 w-2">
        {state === "operational" && <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />}
        <span className={cn("relative h-2 w-2 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </button>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  return (
    <Menu
      label="Account"
      trigger={({ toggle: t, open }) => (
        <button
          type="button"
          onClick={t}
          aria-expanded={open}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-xl p-1 transition hover:bg-surface-2"
        >
          <Avatar name={user?.username ?? "?"} size={30} />
        </button>
      )}
      items={[
        { label: user?.email ?? user?.username ?? "Account", icon: <IUser width={16} height={16} />, onSelect: () => navigate("/settings/account") },
        { label: "Settings", icon: <ISettings width={16} height={16} />, onSelect: () => navigate("/settings") },
        { label: theme === "dark" ? "Light mode" : "Dark mode", icon: theme === "dark" ? <ISun width={16} height={16} /> : <IMoon width={16} height={16} />, onSelect: toggle },
        "separator",
        {
          label: "Log out",
          icon: <ILogout width={16} height={16} />,
          danger: true,
          onSelect: async () => {
            await logout();
            navigate("/login", { replace: true });
          },
        },
      ]}
    />
  );
}

function SidebarFooter() {
  const { user } = useAuth();
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-surface-2/50 px-2.5 py-2">
      <Avatar name={user?.username ?? "?"} size={30} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium text-fg">{user?.username ?? "—"}</p>
        <p className="truncate text-[11px] text-subtle">{user?.role === "admin" ? "Owner · admin" : "Member"}</p>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const errors = useErrorCenter();
  const errorCount = errors.data?.data.length ?? 0;
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => setMoreOpen(false), [location.pathname]);
  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Personal Assistant`;
  }, [location.pathname]);

  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useGlobalShortcuts({ onPalette: togglePalette, onHelp: openHelp });

  const mobileItems = primaryNav.filter((i) => i.mobile);

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="sticky top-0 hidden h-screen w-[256px] shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-4 lg:flex">
        <Brand />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mx-1 mt-5 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-subtle transition hover:border-border-strong hover:text-muted"
        >
          <ISearch width={16} height={16} />
          <span className="flex-1">Search or ask…</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>
        <div className="mt-4 flex flex-1 flex-col overflow-y-auto pr-0.5">
          <NavList items={primaryNav} errors={errorCount} />
          <p className="mb-1 mt-6 px-3 text-[11px] font-medium text-subtle">You</p>
          <NavList items={personalNav} errors={errorCount} />
          {isAdmin && (
            <>
              <p className="mb-1 mt-6 px-3 text-[11px] font-medium text-subtle">Administration</p>
              <NavList items={adminNav} errors={errorCount} />
            </>
          )}
        </div>
        <SidebarFooter />
        <button type="button" onClick={openHelp} className="mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] text-subtle transition hover:bg-surface-2/60 hover:text-muted">
          Keyboard shortcuts <kbd className="kbd">Ctrl /</kbd>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <header className="sticky top-0 z-header flex h-14 items-center gap-2 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark size={28} />
          </div>
          <h2 className="truncate text-sm font-semibold text-fg lg:hidden">{titleFor(location.pathname)}</h2>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden max-w-sm flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-left text-sm text-subtle transition hover:border-border-strong sm:flex lg:hidden"
          >
            <ISearch width={16} height={16} /> Search or ask…
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg sm:hidden"
          >
            <ISearch />
          </button>
          <SystemPulse />
          <button
            type="button"
            onClick={() => navigate("/assistant")}
            className="hidden h-9 items-center gap-1.5 rounded-xl bg-brand/10 px-3 text-sm font-medium text-brand transition hover:bg-brand/15 sm:inline-flex"
          >
            <ISparkles width={16} height={16} /> Ask AI
          </button>
          <NotificationCenter />
          <AccountMenu />
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-6 md:px-8 lg:pb-12">
          <div key={location.pathname} className="animate-in-up">
            <Outlet />
          </div>
        </main>
      </div>

      {/* phone tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-tabbar grid grid-cols-5 border-t border-border bg-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur-md lg:hidden"
      >
        {mobileItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn("flex flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium transition", isActive ? "text-brand" : "text-subtle")
            }
          >
            <Icon width={21} height={21} />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="relative flex flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium text-subtle"
        >
          <IMore width={21} height={21} />
          More
          {errorCount > 0 && <span className="absolute right-[30%] top-0.5 h-2 w-2 rounded-full bg-danger" />}
        </button>
      </nav>

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="More" width="sm">
        <div className="space-y-4">
          <NavList items={primaryNav.filter((i) => !i.mobile)} errors={errorCount} />
          <NavList items={personalNav} errors={errorCount} />
          {isAdmin && <NavList items={adminNav} errors={errorCount} />}
        </div>
      </Drawer>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
