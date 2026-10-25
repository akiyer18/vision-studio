"""Initial production schema.

Revision ID: 001_initial
Revises:
Create Date: 2026-10-25

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("plan", sa.String(length=32), nullable=False, server_default="free"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("brief", sa.JSON(), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False, server_default="full"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="idle"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_jobs_user_id", "jobs", ["user_id"])
    op.create_index("ix_jobs_kind", "jobs", ["kind"])
    op.create_index("ix_jobs_status", "jobs", ["status"])

    op.create_table(
        "ideas",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False, server_default=""),
        sa.Column("brief", sa.JSON(), nullable=False),
        sa.Column("prompts", sa.JSON(), nullable=False),
        sa.Column("selected_layers", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ideas_user_id", "ideas", ["user_id"])
    op.create_index("ix_ideas_session_id", "ideas", ["session_id"])

    op.create_table(
        "renders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("layer", sa.String(length=32), nullable=False),
        sa.Column("variant", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("take", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("object_key", sa.String(length=512), nullable=False),
        sa.Column("bpm", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_renders_session_id", "renders", ["session_id"])
    op.create_index("ix_renders_job_id", "renders", ["job_id"])

    op.create_table(
        "exercises",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=32), nullable=False),
        sa.Column("template_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("setup", sa.JSON(), nullable=False),
        sa.Column("audio_key", sa.String(length=512), nullable=True),
        sa.Column("midi_key", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_exercises_user_id", "exercises", ["user_id"])

    op.create_table(
        "attempts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("exercise_id", sa.String(length=36), sa.ForeignKey("exercises.id"), nullable=False),
        sa.Column("upload_key", sa.String(length=512), nullable=True),
        sa.Column("feedback", sa.JSON(), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_attempts_exercise_id", "attempts", ["exercise_id"])

    op.create_table(
        "analyses",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("source_key", sa.String(length=512), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_analyses_user_id", "analyses", ["user_id"])
    op.create_index("ix_analyses_job_id", "analyses", ["job_id"])

    op.create_table(
        "usage",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("units", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_usage_user_id", "usage", ["user_id"])
    op.create_index("ix_usage_job_id", "usage", ["job_id"])
    op.create_index("ix_usage_kind", "usage", ["kind"])


def downgrade() -> None:
    op.drop_table("usage")
    op.drop_table("analyses")
    op.drop_table("attempts")
    op.drop_table("exercises")
    op.drop_table("renders")
    op.drop_table("ideas")
    op.drop_table("jobs")
    op.drop_table("sessions")
    op.drop_table("users")
