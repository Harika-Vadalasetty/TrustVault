"""Stage 2: health endpoint works without a database."""

from fastapi.testclient import TestClient
import pytest

from app.config import get_settings
from app.main import app

client = TestClient(app)


def test_health_ok_without_database() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "trustvault-api"
    assert "database_configured" in body
    assert "storage_configured" in body


def test_health_db_unavailable_without_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()
    try:
        response = client.get("/health/db")
        assert response.status_code == 503
        assert "DATABASE_URL" in response.json()["detail"]
    finally:
        get_settings.cache_clear()

