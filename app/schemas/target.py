from datetime import datetime

from pydantic import BaseModel


class TargetItem(BaseModel):
    id: int
    title: str
    status: str
    created_at: datetime


class TargetListResponse(BaseModel):
    total: int
    page: int
    size: int
    items: list[TargetItem]
