import csv
from datetime import datetime
from io import StringIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config.db import get_db
from app.repositories.target_repo import QueryParams, query_items

router = APIRouter(tags=["export"])


@router.get("/export")
def export_csv(
    status: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    keyword: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    order: str = Query(default="desc"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    params = QueryParams(
        status=status,
        start=start,
        end=end,
        keyword=keyword,
        page=1,
        size=100,
        sort_by=sort_by,
        order=order,
    )
    items = query_items(db, params)

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "title", "status", "created_at"])
    for item in items:
        writer.writerow([item.id, item.title, item.status, item.created_at.isoformat()])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=items.csv"},
    )
