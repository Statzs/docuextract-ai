import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import init_db
from app.routers import admin, auth, documents, extraction_schemas, oauth, usage
from app.services.processing import recover_interrupted_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("docuextract")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    recovered = recover_interrupted_jobs()
    if recovered:
        log.warning("marked %s interrupted extraction(s) as failed", recovered)
    yield


settings = get_settings()
app = FastAPI(
    title="DocuExtract AI API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Origin lock: behind Vercel, only requests carrying the shared secret are served.
    # The health check stays open so the host's probe works.
    if settings.origin_secret and request.url.path != "/api/health":
        sent = request.headers.get("x-origin-secret", "")
        if not hmac.compare_digest(sent.encode(), settings.origin_secret.encode()):
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    # Reject oversized bodies before Starlette spools the multipart upload to disk.
    # shortcut: chunked requests without Content-Length are still bounded only by the
    # reverse proxy's body limit; set one (e.g. 12 MB) at the platform level.
    max_body = (settings.max_upload_mb + 1) * 1024 * 1024
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > max_body:
        return JSONResponse(
            {"detail": f"The file exceeds the {settings.max_upload_mb} MB limit."}, status_code=413
        )
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error."}, status_code=500)


for r in (
    auth.router,
    oauth.router,
    extraction_schemas.router,
    documents.router,
    usage.router,
    admin.router,
):
    app.include_router(r)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}
