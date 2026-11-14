"""FastAPI application entry point.

Run (from backend/):  uvicorn app.main:app --host 0.0.0.0 --port 8000
Interactive API docs: http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .api import analytics, datasets, ml, system, telemetry
from .config import settings
from .database import init_db, session_scope
from .services.events import log_event
from .services.monitor import monitor_loop
from .services.simulator import simulator

for _stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("landslide")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.artifact_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    with session_scope() as db:
        log_event(db, "system", "BACKEND_STARTED", f"Backend v{settings.app_version} started.")
    task = None
    if settings.enable_background_tasks:
        task = asyncio.create_task(monitor_loop(settings.monitor_interval_sec))
    yield
    await simulator.stop(log_it=False)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Backend for the IoT-Based Multi-Parameter Landslide Risk Monitoring and AI-Assisted Early Warning "
        "System (ESP32 prototype). Risk states are PROTOTYPE categories from an experimental miniature slope; "
        "scores are not landslide probabilities."
    ),
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2048)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = [{k: v for k, v in e.items() if k != "ctx"} | ({"ctx": {k: str(v) for k, v in e["ctx"].items()}} if "ctx" in e else {})
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "Request validation failed", "errors": jsonable_encoder(errors)})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. See backend logs."})


for r in (telemetry.router, analytics.router, datasets.router, ml.router, system.router):
    app.include_router(r)


@app.get("/", include_in_schema=False)
def root():
    return {"app": settings.app_name, "docs": "/docs", "health": "/api/health"}
