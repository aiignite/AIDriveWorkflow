"""AIDriveWorkflow FastAPI application."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.exceptions import AppException
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.ai import router as ai_router
from app.routers.admin.users import router as admin_users_router
from app.services.ai.seed_service import AISeedService
from app.services.admin_bootstrap import AdminBootstrap
import app.ai_tools  # noqa: F401 — register AI tools
import app.models.ai  # noqa: F401 — register AI tables
import app.models.org  # noqa: F401 — register org tables
import app.models.workflow  # noqa: F401 — register workflow tables
import app.models.notification  # noqa: F401 — register notification tables

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("AIDRIVE_TESTING") != "1":
        async with AsyncSessionLocal() as db:
            await AISeedService.ensure_platform_seed(db)
            await AdminBootstrap.ensure_configured_admin(db)
            await db.commit()

        async def _seed_workflows_task():
            try:
                from app.seed_workflows import seed_workflows
                await seed_workflows()
            except Exception:  # noqa: BLE001
                logger.exception("Workflow template seeding failed")

        asyncio.create_task(_seed_workflows_task())
    yield


app = FastAPI(
    title=settings.APP_NAME,
    lifespan=lifespan,
    docs_url="/docs" if settings.API_DOCS_ENABLED else None,
    redoc_url="/redoc" if settings.API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if settings.API_DOCS_ENABLED else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

from app.routers.system import router as system_router  # noqa: E402
from app.routers.notifications import router as notifications_router  # noqa: E402
from app.routers.files import router as files_router  # noqa: E402
from app.routers.workflow import register_routers  # noqa: E402

app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(users_router, prefix=API_PREFIX)
app.include_router(admin_users_router, prefix=API_PREFIX)
app.include_router(system_router, prefix=API_PREFIX)
app.include_router(notifications_router, prefix=API_PREFIX)
app.include_router(files_router, prefix=API_PREFIX)
app.include_router(ai_router, prefix=API_PREFIX)
register_routers(app, API_PREFIX)


@app.exception_handler(AppException)
async def app_exception_handler(_request, exc: AppException):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
