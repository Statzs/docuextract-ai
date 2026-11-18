"""Alembic environment: reuses the app's engine and models, so URLs and types match."""

from alembic import context

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base, engine

target_metadata = Base.metadata


def run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=connection.dialect.name == "sqlite",  # SQLite cannot ALTER most things
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline (SQL script) mode is not supported; run against a database.")

# init_db() passes its own connection; the CLI opens one from the app's engine.
conn = context.config.attributes.get("connection")
if conn is not None:
    run(conn)
else:
    with engine.begin() as c:
        run(c)
