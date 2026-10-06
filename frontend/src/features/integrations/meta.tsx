import type { ReactNode } from "react";
import type { Health, Integration } from "@/api/platform";
import { ICalendar, IChat, IDoc, IDrive, IGitHub, IMail, ISend, ITable, IBell } from "@/components/icons2";

export const SERVICE_ICON: Record<string, (p: { width?: number; height?: number }) => ReactNode> = {
  gmail: IMail,
  outlook: IMail,
  calendar: ICalendar,
  drive: IDrive,
  onedrive: IDrive,
  sheets: ITable,
  docs: IDoc,
  teams: IChat,
  messages: ISend,
  notifications: IBell,
  repos: IGitHub,
};

export function ServiceIcon({ service, size = 16 }: { service: string; size?: number }) {
  const C = SERVICE_ICON[service] ?? IMail;
  return <>{C({ width: size, height: size })}</>;
}

/** The one thing to do next with an integration, in words. */
export function primaryAction(i: Integration): { label: string; intent: "connect" | "manage" | "reconnect" | "finish" } {
  if (!i.connected) return { label: "Connect", intent: "connect" };
  if (i.status === "expired" || i.status === "auth_required") return { label: "Reconnect", intent: "reconnect" };
  if (i.status === "pending") return { label: "Finish setup", intent: "finish" };
  return { label: "Manage", intent: "manage" };
}

export function isUnhealthy(h: Health): boolean {
  return h === "expired" || h === "auth_required" || h === "error" || h === "degraded";
}

export const OAUTH_ERROR_TEXT: Record<string, string> = {
  access_denied: "You cancelled, or access was not granted. Nothing was changed.",
  invalid_state: "That sign-in link expired or was already used. Start again.",
  missing_code: "The provider did not send an authorization code. Start again.",
  app_not_configured: "Sign-in for this service has not been set up yet.",
  invalid_grant: "The provider rejected the authorization. Start again.",
  invalid_client: "The OAuth app credentials are wrong - check them in Advanced setup.",
  incorrect_client_credentials: "The OAuth app credentials are wrong - check them in Advanced setup.",
  network: "The provider could not be reached. Check the connection and try again.",
};
