"""Migrations: fresh databases, and databases created before Alembic, keep their data."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.db import Base, alembic_config, engine, init_db


def _wipe():
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


def _head_revision():
    with engine.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def test_fresh_database_matches_the_models():
    _wipe()
    init_db()
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], diff  # migrations and models describe the same schema
    assert _head_revision() == "0003"
    _wipe()


def test_pre_alembic_database_is_upgraded_in_place():
    _wipe()
    with engine.begin() as conn:  # a database from before migrations: 0001 schema, no version table
        command.upgrade(alembic_config(conn), "0001")
        conn.execute(text("DROP TABLE alembic_version"))
        conn.execute(
            text(
                "INSERT INTO users (id, email, name, password_hash, is_demo, created_at) "
                "VALUES ('u1', 'old@example.com', 'Old', 'x', false, CURRENT_TIMESTAMP)"
            )
        )
    init_db()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT email, token_version FROM users")).one()
    assert tuple(row) == ("old@example.com", 0)  # data kept, new column defaulted
    assert inspect(engine).has_table("password_reset_tokens")
    assert _head_revision() == "0003"
    _wipe()


def test_create_all_database_with_current_schema_is_only_stamped():
    _wipe()
    Base.metadata.create_all(engine)
    init_db()  # must not try to add columns that already exist
    assert _head_revision() == "0003"
    init_db()  # and running again is a no-op
    _wipe()
