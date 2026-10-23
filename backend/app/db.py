"""SQLAlchemy engine and session factory.

The engine is created only when a DATABASE_URL is present. Importing this
module does not connect to PostgreSQL, so the health endpoint can run
without credentials.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models.base import Base

__all__ = ["Base", "get_engine", "get_session", "check_database"]

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            settings.sqlalchemy_url(),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def get_session() -> Generator[Session, None, None]:
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()


def check_database() -> None:
    """Open a short connection and run SELECT 1. Raises if DB is down or unset."""
    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
