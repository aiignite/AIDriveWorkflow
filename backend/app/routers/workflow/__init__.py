"""Workflow module – centralized router registration."""
from fastapi import FastAPI

from app.routers.workflow import workflows


def register_routers(app: FastAPI, prefix: str = "") -> None:
    """Register all workflow-related routers."""
    app.include_router(workflows.router, prefix=prefix)
    app.include_router(workflows.instance_router, prefix=prefix)
    app.include_router(workflows.task_router, prefix=prefix)
    app.include_router(workflows.integration_router, prefix=prefix)
