"""Central metrics hub.

ONE background loop samples host metrics + probes every service, then publishes
structured events to all subscribers. N connected WebSocket clients cause N
queues, not N sampling loops.
"""
from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging

from app.config import get_settings
from app.services.metrics import as_dict, collect_host_metrics
from app.services.services_probe import probe_services

log = logging.getLogger("monitor")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class MetricsHub:
    def __init__(self, interval: float | None = None):
        self.interval = interval or get_settings().monitor_interval_seconds
        self._subscribers: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self._latest: list[dict] = []

    # -- lifecycle -------------------------------------------------------------

    async def start(self) -> None:
        if self._task is None or self._task.done():
            # one synchronous sample so a client that connects immediately gets
            # a real snapshot instead of waiting a full interval
            if not self._latest:
                self._publish(await self.collect_once())
            self._task = asyncio.create_task(self._loop(), name="metrics-hub")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    # -- pub/sub -------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        for event in self._latest:  # immediate snapshot for the new client
            q.put_nowait(event)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    # -- internals -------------------------------------------------------------

    async def collect_once(self) -> list[dict]:
        ts = _now()
        events: list[dict] = []
        try:
            m = as_dict(collect_host_metrics(cpu_sample_seconds=0.0))
            events.append(
                {
                    "type": "system.metrics",
                    "timestamp": ts,
                    "cpu": m["cpu_percent"],
                    "memory": m["memory_percent"],
                    "disk": m["disk_percent"],
                    "detail": m,
                }
            )
        except Exception as exc:  # noqa: BLE001 - never let sampling kill the loop
            log.warning("metrics sample failed: %s", exc)

        try:
            for s in await probe_services():
                events.append(
                    {
                        "type": "service.status",
                        "timestamp": ts,
                        "service": s.name,
                        "status": s.status,
                        "configured": s.configured,
                        "latency_ms": s.latency_ms,
                        "detail": s.detail,
                        "checked_at": s.checked_at,
                        # Probe-supplied context (AI provider and model, n8n key
                        # validity, profile counts). Never a secret - the probes
                        # build `meta` from labels and booleans only.
                        "meta": s.meta,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            log.warning("service probe failed: %s", exc)
        return events

    def _publish(self, events: list[dict]) -> None:
        self._latest = events
        for q in list(self._subscribers):
            for event in events:
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    # slow consumer: drop it, it will get the next snapshot
                    self._subscribers.discard(q)

    async def _loop(self) -> None:
        log.info("metrics hub started (interval=%ss)", self.interval)
        try:
            while True:
                self._publish(await self.collect_once())
                await asyncio.sleep(self.interval)
        except asyncio.CancelledError:
            raise
        finally:
            log.info("metrics hub stopped")


hub = MetricsHub()
