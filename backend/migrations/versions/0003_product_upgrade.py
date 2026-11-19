"""OAuth identities, admin-editable settings, templates, upload dedupe and private mode.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

KINDS = {"Invoice": "invoice", "Receipt": "receipt"}


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("password_hash", existing_type=sa.String(100), nullable=True)
        batch.add_column(
            sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    with op.batch_alter_table("extraction_schemas") as batch:
        batch.add_column(sa.Column("kind", sa.String(30), nullable=True))
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("content_sha256", sa.String(64), nullable=True))
        batch.add_column(sa.Column("mode", sa.String(10), nullable=False, server_default="auto"))
        batch.create_index("ix_documents_content_sha256", ["content_sha256"])
    # Existing users' built-in templates keep working as typed templates.
    for name, kind in KINDS.items():
        op.execute(
            sa.text("UPDATE extraction_schemas SET kind = :k WHERE name = :n").bindparams(
                k=kind, n=name
            )
        )
    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("provider", "subject", name="uq_oauth_provider_subject"),
    )
    op.create_index("ix_oauth_identities_user_id", "oauth_identities", ["user_id"])
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("oauth_identities")
    with op.batch_alter_table("documents") as batch:
        batch.drop_index("ix_documents_content_sha256")
        batch.drop_column("mode")
        batch.drop_column("content_sha256")
    with op.batch_alter_table("extraction_schemas") as batch:
        batch.drop_column("kind")
    # Rows without a password cannot go back to NOT NULL; '!' is not a valid bcrypt hash.
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verified")
        batch.alter_column("password_hash", existing_type=sa.String(100), nullable=False)
