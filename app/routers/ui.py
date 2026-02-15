from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.config.db import get_db
from app.repositories.target_repo import QueryParams, query_items, total_count

router = APIRouter(tags=["ui"])
templates = Jinja2Templates(directory="templates")


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    status: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    keyword: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    sort_by: str = Query(default="created_at"),
    order: str = Query(default="desc"),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    params = QueryParams(
        status=status,
        start=start,
        end=end,
        keyword=keyword,
        page=page,
        size=size,
        sort_by=sort_by,
        order=order,
    )

    items = query_items(db, params)
    total = total_count(db, params)
    total_pages = max(1, (total + min(size, 100) - 1) // min(size, 100))

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "items": items,
            "total": total,
            "page": page,
            "size": min(size, 100),
            "total_pages": total_pages,
            "query": {
                "status": status or "",
                "start": start.isoformat() if start else "",
                "end": end.isoformat() if end else "",
                "keyword": keyword or "",
                "sort_by": sort_by,
                "order": order,
            },
        },
    )
