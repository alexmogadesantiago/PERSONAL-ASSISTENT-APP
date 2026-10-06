import type { FC, SVGProps } from "react";
import {
  IActivity,
  IAlert,
  IBolt,
  ICalendar,
  ICheck,
  IHome,
  IMail,
  IPlug,
  IServer,
  IShield,
  ISettings,
  ISparkles,
  IUser,
} from "@/components/icons2";

export interface NavItem {
  to: string;
  label: string;
  icon: FC<SVGProps<SVGSVGElement>>;
  admin?: boolean;
  /** key into the live counters the shell shows next to the label */
  badge?: "errors";
  /** shown in the phone tab bar */
  mobile?: boolean;
}

/** The product's spine: your assistant, what it does, what it is connected to. */
export const primaryNav: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: IHome, mobile: true },
  { to: "/assistant", label: "Assistant", icon: ISparkles, mobile: true },
  { to: "/inbox", label: "Inbox", icon: IMail },
  { to: "/calendar", label: "Calendar", icon: ICalendar },
  { to: "/tasks", label: "Tasks", icon: ICheck },
  { to: "/automations", label: "Automations", icon: IBolt, mobile: true },
  { to: "/integrations", label: "Integrations", icon: IPlug, mobile: true },
  { to: "/activity", label: "Activity", icon: IActivity },
  { to: "/errors", label: "Errors", icon: IAlert, badge: "errors" },
];

export const personalNav: NavItem[] = [
  { to: "/profiles", label: "Profile", icon: IUser },
  { to: "/settings", label: "Settings", icon: ISettings },
];

/** Kept for compatibility: tools that used to live in the sidebar. */
export const toolsNav: NavItem[] = [];

export const adminNav: NavItem[] = [
  { to: "/admin/users", label: "Users", icon: IUser, admin: true },
  { to: "/admin/system", label: "System", icon: IServer, admin: true },
  { to: "/admin/security", label: "Security", icon: IShield, admin: true },
];

/** Page titles for the header and the command palette. */
export const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/dashboard", title: "Home" },
  { prefix: "/assistant", title: "Assistant" },
  { prefix: "/inbox", title: "Inbox" },
  { prefix: "/calendar", title: "Calendar" },
  { prefix: "/tasks", title: "Tasks" },
  { prefix: "/engine", title: "Automation engine" },
  { prefix: "/presentation", title: "Presentation" },
  { prefix: "/automations/new", title: "New automation" },
  { prefix: "/automations", title: "Automations" },
  { prefix: "/integrations", title: "Integrations" },
  { prefix: "/activity", title: "Activity" },
  { prefix: "/executions", title: "Run details" },
  { prefix: "/errors", title: "Errors" },
  { prefix: "/profiles", title: "Profile" },
  { prefix: "/settings", title: "Settings" },
  { prefix: "/onboarding", title: "Welcome" },
  { prefix: "/admin", title: "Administration" },
];

export function titleFor(pathname: string): string {
  return PAGE_TITLES.find((p) => pathname.startsWith(p.prefix))?.title ?? "Personal Assistant";
}
