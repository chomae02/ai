from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, asc, desc, func, select
from sqlalchemy.orm import Session

from app.models.target import Target

MAX_LIMIT = 100
ALLOWED_SORT_COLUMNS = {
    "id": Target.id,
    "title": Target.title,
    "status": Target.status,
    "created_at": Target.created_at,
}


@dataclass
class QueryParams:
    status: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    keyword: str | None = None
    page: int = 1
    size: int = 20
    sort_by: str = "created_at"
    order: str = "desc"


def _build_query(params: QueryParams) -> Select[tuple[Target]]:
    stmt = select(Target)

    if params.status:
        stmt = stmt.where(Target.status == params.status)

    if params.start and params.end:
        stmt = stmt.where(Target.created_at.between(params.start, params.end))
    elif params.start:
        stmt = stmt.where(Target.created_at >= params.start)
    elif params.end:
        stmt = stmt.where(Target.created_at <= params.end)

    if params.keyword:
        stmt = stmt.where(Target.title.ilike(f"%{params.keyword}%"))

    sort_column = ALLOWED_SORT_COLUMNS.get(params.sort_by)
    if sort_column is None:
        raise ValueError(f"sort_by must be one of: {', '.join(ALLOWED_SORT_COLUMNS.keys())}")

    if params.order.lower() == "asc":
        stmt = stmt.order_by(asc(sort_column))
    else:
        stmt = stmt.order_by(desc(sort_column))

    return stmt


def total_count(db: Session, params: QueryParams) -> int:
    stmt = _build_query(params)
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    return db.scalar(count_stmt) or 0


def query_items(db: Session, params: QueryParams) -> list[Target]:
    page = max(1, params.page)
    size = min(MAX_LIMIT, max(1, params.size))
    offset = (page - 1) * size

    stmt = _build_query(params).offset(offset).limit(size)
    return list(db.scalars(stmt).all())
