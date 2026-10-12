"""SQLAlchemy model registry — importing modules registers their tables on Base.metadata."""
from app.models.user import User
from app.models.org import Department, Role, UserRole
from app.models.ai import *  # noqa: F401,F403
