import { useEffect, useMemo, useRef, useState } from "react";
import { WS_URL } from "@/config";
import { getAccessToken } from "@/api/tokenStore";
import { refreshAccessToken } from "@/api/client";
import { createReconnectingSocket, type SocketStatus } from "@/websocket/socket";
import type { HostMetrics, ServiceState, ServiceStatus } from "@/api/types";

export interface MonitorServiceStatus {
  name: string;
  status: ServiceStatus;
  online: boolean | null;
  configured: boolean;
  latency_ms: number | null;
  detail: string;
  updatedAt: string;
  /** Probe context: AI provider and model, n8n key validity, profile counts. */
  meta?: Record<string, unknown>;
}

/** Healthy statuses. `configured` is the healthy state for services you cannot
 *  ping (profile data in Postgres). */
const HEALTHY: ServiceStatus[] = ["online", "configured"];
const FAILED: ServiceStatus[] = ["offline", "invalid"];

/** Dashboard reading order: infrastructure first, then integrations. */
export const SERVICE_ORDER = ["postgres", "n8n", "playwright", "profile", "ai"];

export function serviceRank(name: string): number {
  const i = SERVICE_ORDER.indexOf(name);
  return i === -1 ? SERVICE_ORDER.length : i;
}

export interface MonitorPoint {
  t: string;
  cpu: number;
  memory: number;
  disk: number;
}

interface MetricsEvent {
  type: "system.metrics";
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  detail: HostMetrics;
}

interface ServiceEvent {
  type: "service.status";
  timestamp: string;
  service: string;
  status: ServiceStatus;
  configured?: boolean;
  latency_ms: number | null;
  detail: string;
  checked_at?: string;
  meta?: Record<string, unknown>;
}

const HISTORY_LIMIT = 60;

export interface MonitorState {
  status: SocketStatus;
  live: boolean;
  latest: HostMetrics | null;
  history: MonitorPoint[];
  services: MonitorServiceStatus[];
  lastEventAt: string | null;
}

export function useMonitorWebSocket(): MonitorState {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [latest, setLatest] = useState<HostMetrics | null>(null);
  const [history, setHistory] = useState<MonitorPoint[]>([]);
  const [services, setServices] = useState<Record<string, MonitorServiceStatus>>({});
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    const socket = createReconnectingSocket({
      url: () => {
        const token = getAccessToken();
        return token ? `${WS_URL}/ws/monitor?token=${encodeURIComponent(token)}` : null;
      },
      onStatus: setStatus,
      onMessage: (raw) => {
        const evt = raw as MetricsEvent | ServiceEvent | { type: string };
        if (evt.type === "system.metrics") {
          const m = evt as MetricsEvent;
          setLatest(m.detail);
          setLastEventAt(m.timestamp);
          setHistory((prev) =>
            [...prev, { t: m.timestamp, cpu: m.cpu, memory: m.memory, disk: m.disk }].slice(-HISTORY_LIMIT),
          );
        } else if (evt.type === "service.status") {
          const s = evt as ServiceEvent;
          setLastEventAt(s.timestamp);
          setServices((prev) => ({
            ...prev,
            [s.service]: {
              name: s.service,
              status: s.status,
              online: HEALTHY.includes(s.status)
                ? true
                : FAILED.includes(s.status)
                  ? false
                  : null,
              configured: s.configured ?? s.status !== "not_configured",
              latency_ms: s.latency_ms,
              detail: s.detail,
              updatedAt: s.checked_at ?? s.timestamp,
              meta: s.meta,
            },
          }));
        }
      },
      shouldRetry: (event) => {
        // 1008 = policy violation → token rejected. Refresh once, then retry.
        if (event.code === 1008 && !refreshing.current) {
          refreshing.current = true;
          void refreshAccessToken().finally(() => {
            refreshing.current = false;
          });
        }
        return true;
      },
    });

    return () => socket.close();
  }, []);

  const serviceList = useMemo(
    () =>
      Object.values(services).sort(
        (a, b) => serviceRank(a.name) - serviceRank(b.name) || a.name.localeCompare(b.name),
      ),
    [services],
  );

  return {
    status,
    live: status === "open",
    latest,
    history,
    services: serviceList,
    lastEventAt,
  };
}

export type { ServiceState };
