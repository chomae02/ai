from urllib.parse import parse_qs

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class QuerySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_size: int = 200):
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next):
        params = parse_qs(request.url.query)
        size = params.get("size", [None])[0]

        if size is not None:
            try:
                size_value = int(size)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "size must be integer"})

            if size_value > self.max_size:
                return JSONResponse(status_code=400, content={"detail": f"size must be <= {self.max_size}"})

        return await call_next(request)
