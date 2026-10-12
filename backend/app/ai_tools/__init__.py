"""AI tool registry bootstrap — importing modules registers their tools."""
from app.ai_tools import workflow_tools  # noqa: F401 — register tools on import
