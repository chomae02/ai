import logging
import os
from datetime import datetime

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

os.makedirs("logs", exist_ok=True)

logger = logging.getLogger("audit")
if not logger.handlers:
    handler = logging.FileHandler("logs/audit.log")
    formatter = logging.Formatter("%(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        user = request.headers.get("x-user", "anonymous")
        logger.info(
            "time=%s method=%s path=%s query=%s user=%s status=%s",
            datetime.utcnow().isoformat(),
            request.method,
            request.url.path,
            request.url.query,
            user,
            response.status_code,
        )
        return response
