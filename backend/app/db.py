from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _fk_on(conn, _):  # SQLite ignores FK constraints unless enabled per connection
            conn.execute("PRAGMA foreign_keys=ON")

        return engine
    # Supabase gives postgres:// or postgresql:// URLs; use the psycopg 3 driver.
    url = url.replace("postgres://", "postgresql+psycopg://", 1).replace(
        "postgresql://", "postgresql+psycopg://", 1
    )
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def alembic_config(connection):
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["connection"] = connection
    return cfg


def init_db() -> None:
    """Bring the schema to the latest migration without touching existing data."""
    from alembic import command

    with engine.begin() as conn:
        cfg = alembic_config(conn)
        insp = inspect(conn)
        if insp.has_table("users") and not insp.has_table("alembic_version"):
            # Created by `create_all` before migrations existed: record which revision it
            # matches so `upgrade` only adds what is missing.
            cols = {c["name"] for c in insp.get_columns("users")}
            rev = (
                "0003"
                if "email_verified" in cols
                else "0002"
                if "token_version" in cols
                else "0001"
            )
            command.stamp(cfg, rev)
        command.upgrade(cfg, "head")
    if engine.dialect.name == "postgresql":
        # Supabase exposes the public schema through its Data API (anon key). RLS with no
        # policies denies that path entirely; the backend connects as the table owner,
        # which bypasses RLS, so data access is only possible through this API.
        with engine.begin() as conn:
            for name in [t.name for t in Base.metadata.sorted_tables] + ["alembic_version"]:
                conn.execute(text(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY'))
