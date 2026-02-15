import secrets

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBasic, HTTPBasicCredentials, HTTPBearer

from app.config.settings import get_settings

basic_scheme = HTTPBasic(auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)


def verify_internal_auth(
    basic: HTTPBasicCredentials | None,
    bearer: HTTPAuthorizationCredentials | None,
) -> None:
    settings = get_settings()

    if bearer and settings.app_auth_token:
        if secrets.compare_digest(bearer.credentials, settings.app_auth_token):
            return

    if basic and settings.basic_auth_username and settings.basic_auth_password:
        valid_user = secrets.compare_digest(basic.username, settings.basic_auth_username)
        valid_pw = secrets.compare_digest(basic.password, settings.basic_auth_password)
        if valid_user and valid_pw:
            return

    raise HTTPException(status_code=401, detail="Unauthorized")
