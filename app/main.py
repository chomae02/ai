from fastapi import Depends, FastAPI
from fastapi.security import HTTPAuthorizationCredentials, HTTPBasicCredentials

from app.middlewares.audit import AuditMiddleware
from app.middlewares.auth import basic_scheme, bearer_scheme, verify_internal_auth
from app.middlewares.limit import QuerySizeLimitMiddleware
from app.routers import export, target, ui

app = FastAPI(title="Task Master Search API")

app.add_middleware(QuerySizeLimitMiddleware, max_size=200)
app.add_middleware(AuditMiddleware)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def auth_dependency(
    basic: HTTPBasicCredentials | None = Depends(basic_scheme),
    bearer: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> None:
    verify_internal_auth(basic, bearer)


app.include_router(target.router, dependencies=[Depends(auth_dependency)])
app.include_router(export.router, dependencies=[Depends(auth_dependency)])
app.include_router(ui.router)
