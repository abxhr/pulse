"""Baseline the schema that predates Alembic.

Fresh installations create the model metadata before this revision is stamped;
existing installations are likewise non-destructively adopted.
"""
revision = "001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    from alembic import op
    from app.db import Base
    from app import models  # noqa: F401
    Base.metadata.create_all(bind=op.get_bind())


def downgrade():
    from alembic import op
    from app.db import Base
    from app import models  # noqa: F401
    Base.metadata.drop_all(bind=op.get_bind())
