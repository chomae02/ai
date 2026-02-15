from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Target(Base):
    __tablename__ = "targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, nullable=False, server_default=func.now(), index=True)
