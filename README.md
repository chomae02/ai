# Infostock 미국 테마DB 수집기

`www.infostock.co.kr` 로그인 후 **테마 > 미국 테마DB > 미국 테마 한눈에 보기** 화면에서,
각 테마를 클릭해 아래 데이터를 MariaDB에 저장하는 파이썬 스크립트입니다.

- 테마 설명
- 테마 히스토리 (일자, 내용)
- 국내 관련테마 (버튼/칩)
- 관련종목 (종목명, 테마기업 요약)

## 1) 설치

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

## 2) 실행

```bash
python us_theme_scraper.py \
  --base-url https://www.infostock.co.kr \
  --login-url https://www.infostock.co.kr/login \
  --username YOUR_ID \
  --password YOUR_PASSWORD \
  --db-host 127.0.0.1 --db-port 3306 \
  --db-user root --db-password YOUR_DB_PASSWORD \
  --db-name infostock \
  --headless
```

> 로그인 input/selectors가 다르면 아래 옵션으로 조정하세요.

- `--username-selector`
- `--password-selector`
- `--login-submit-selector`

## 3) 생성/사용 테이블

스크립트 실행 시 아래 테이블이 자동 생성됩니다.

- `us_themes`
- `us_theme_histories`
- `us_theme_related_domestic`
- `us_theme_stocks`

`theme_name` 기준으로 upsert하고, 하위 데이터(히스토리/국내관련테마/관련종목)는 해당 테마 기준으로 삭제 후 재삽입합니다.

## 4) 팁

- 페이지 구조가 바뀌면 `us_theme_scraper.py` 내 selector 후보를 보강하세요.
- 디버깅 시 `--headless`를 빼고 실행하면 동작 확인이 쉽습니다.
- 샘플 테스트는 `--max-themes 3` 같이 제한해서 먼저 검증하세요.
