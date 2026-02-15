from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.config.db import get_db
from app.repositories.target_repo import QueryParams, query_items, total_count
from app.schemas.target import TargetItem, TargetListResponse

router = APIRouter(prefix="", tags=["target"])


@router.get("/items", response_model=TargetListResponse)
def get_items(
    status: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    keyword: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    sort_by: str = Query(default="created_at"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> TargetListResponse:
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

    try:
        items = query_items(db, params)
        total = total_count(db, params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TargetListResponse(
        total=total,
        page=page,
        size=min(size, 100),
        items=[TargetItem.model_validate(item, from_attributes=True) for item in items],
    )
