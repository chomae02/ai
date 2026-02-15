# Task Master FastAPI + MariaDB

## 1) 준비
```bash
cp .env.example .env
```

필수 환경변수:
- `DB_URL` (예: `mysql+pymysql://app_user:app_password@mariadb:3306/app_db`)

## 2) Docker로 실행
```bash
docker compose up --build
```

기동 확인:
- API: http://localhost:8000
- Health: http://localhost:8000/health
- Swagger: http://localhost:8000/docs

## 3) API 사용
인증은 아래 둘 중 하나:
- `Authorization: Bearer <APP_AUTH_TOKEN>`
- Basic Auth (`BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`)

예시:
```bash
curl -H "Authorization: Bearer changeme-token" "http://localhost:8000/items?page=2&size=20"
```

## 4) 주요 기능
- `/items` 필터: status/start/end/keyword/page/size/sort_by/order
- `/` 웹 UI: 검색 폼 + 결과 테이블 + 페이지네이션
- `/export` CSV 다운로드 (현재 필터 반영)
- middleware:
  - 과다조회 방어(size<=200)
  - 내부 인증
  - 감사 로그(`logs/audit.log`)

## 5) 로컬 실행(옵션)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
