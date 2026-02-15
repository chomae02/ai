from functools import lru_cache

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    db_url: str = Field(..., alias="DB_URL", description="Database connection URL")
    db_echo: bool = Field(default=False, alias="DB_ECHO")
    app_auth_token: str = Field(default="", alias="APP_AUTH_TOKEN")
    basic_auth_username: str = Field(default="", alias="BASIC_AUTH_USERNAME")
    basic_auth_password: str = Field(default="", alias="BASIC_AUTH_PASSWORD")


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        raise RuntimeError(
            "환경변수 설정 오류: DB_URL이 필요합니다. .env 파일을 확인하세요."
        ) from exc
