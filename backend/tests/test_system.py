from __future__ import annotations


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "automation-center-backend"


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "ok"
    assert body["environment"] == "testing"
    assert body["status"] in ("ok", "degraded")


def test_openapi_served(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    assert "/api/system/status" in r.json()["paths"]


def test_metrics_are_real_numbers(client):
    r = client.get("/api/system/metrics")
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["cpu_percent"] <= 100.0
    assert body["memory_total_mb"] > 0
    assert body["disk_total_gb"] > 0


def test_system_status_probes_every_service(client):
    r = client.get("/api/system/status")
    assert r.status_code == 200
    body = r.json()
    by_name = {s["name"]: s for s in body["services"]}
    assert set(by_name) == {"postgres", "n8n", "playwright", "profile", "ai"}

    # postgres is checked via the application's own engine -> online in the sandbox
    assert by_name["postgres"]["status"] == "online"
    assert by_name["postgres"]["online"] is True

    # no n8n key / sidecar URLs configured in the test env -> NOT_CONFIGURED,
    # which must NOT count as an outage.
    for name in ("n8n", "playwright", "profile", "ai"):
        assert by_name[name]["status"] == "not_configured"
        assert by_name[name]["online"] is None

    assert body["state"] == "operational"
    assert body["operational"] is True
    assert body["degraded_services"] == []
    assert set(body["not_configured_services"]) == {"n8n", "playwright", "profile", "ai"}

    # target strings must never leak a connection URL with credentials
    assert by_name["postgres"]["target"] == "application database"


def test_security_headers(client):
    r = client.get("/")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-request-id"]
