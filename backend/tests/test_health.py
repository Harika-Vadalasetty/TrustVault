"""Stage 2: health endpoint works without a database."""

from fastapi.testclient import TestClient

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


def test_health_db_unavailable_without_database_url() -> None:
    response = client.get("/health/db")
    assert response.status_code == 503
    assert "DATABASE_URL" in response.json()["detail"]
