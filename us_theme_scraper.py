#!/usr/bin/env python3
"""
Infostock 미국 테마 DB 페이지를 로그인 후 순회하며 MariaDB에 적재하는 스크립트.

사용 예:
python us_theme_scraper.py \
  --base-url https://www.infostock.co.kr \
  --login-url https://www.infostock.co.kr/login \
  --username your_id \
  --password your_pw \
  --db-host 127.0.0.1 --db-port 3306 --db-user root --db-password pass --db-name infostock
"""

from __future__ import annotations

import argparse
import contextlib
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, List, Optional, Sequence, Tuple

import mariadb
from bs4 import BeautifulSoup
from playwright.sync_api import Locator, Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

LOGGER = logging.getLogger("infostock.us_theme")


@dataclass
class ThemeHistory:
    history_date: Optional[str]
    content: str


@dataclass
class ThemeStock:
    stock_name: str
    summary: str


@dataclass
class ThemeRecord:
    name: str
    description: str
    histories: List[ThemeHistory]
    domestic_related_themes: List[str]
    stocks: List[ThemeStock]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Infostock 미국 테마DB 파서 + MariaDB 적재")

    parser.add_argument("--base-url", required=True, help="예: https://www.infostock.co.kr")
    parser.add_argument("--login-url", required=True, help="로그인 페이지 URL")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)

    parser.add_argument("--username-selector", default="input[name='user_id'], input#user_id, input[type='text']")
    parser.add_argument("--password-selector", default="input[name='user_pw'], input#user_pw, input[type='password']")
    parser.add_argument("--login-submit-selector", default="button[type='submit'], button:has-text('로그인'), input[type='submit']")

    parser.add_argument("--headless", action="store_true", default=False, help="브라우저 헤드리스 모드")
    parser.add_argument("--slow-mo", type=int, default=0, help="Playwright slow_mo(ms)")
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("--max-themes", type=int, default=0, help="0이면 전체")

    parser.add_argument("--db-host", required=True)
    parser.add_argument("--db-port", type=int, default=3306)
    parser.add_argument("--db-user", required=True)
    parser.add_argument("--db-password", required=True)
    parser.add_argument("--db-name", required=True)
    parser.add_argument("--db-charset", default="utf8mb4")

    parser.add_argument("--log-level", default="INFO")
    return parser


def click_first(page: Page, selectors: Sequence[str], timeout_ms: int) -> bool:
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            locator.first.click(timeout=timeout_ms)
            return True
        except Exception:
            continue
    return False


def click_by_text(page: Page, texts: Sequence[str], timeout_ms: int) -> None:
    errors = []
    for text in texts:
        locator = page.get_by_text(text, exact=False)
        if locator.count() == 0:
            continue
        try:
            locator.first.click(timeout=timeout_ms)
            return
        except Exception as exc:
            errors.append(f"{text}: {exc}")
    raise RuntimeError(f"텍스트 기반 클릭 실패: {texts} / details={errors}")


def parse_date(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    if not raw:
        return None

    # 2024-01-31 / 2024.01.31 / 20240131 대응
    nums = re.sub(r"[^0-9]", "", raw)
    if len(nums) == 8:
        try:
            dt = datetime.strptime(nums, "%Y%m%d")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            return raw
    return raw


def normalize_text(s: str) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip())
    return s


def extract_theme_list_items(page: Page) -> List[Locator]:
    """
    좌측/상단 목록의 테마 클릭 대상 후보를 폭넓게 수집.
    페이지 구조가 조금 달라도 동작하도록 여러 패턴을 시도한다.
    """
    candidates = [
        "table tbody tr",
        ".theme-list tbody tr",
        ".themeList tbody tr",
        ".left-list tbody tr",
        "ul.theme-list > li",
        "ul.themeList > li",
    ]

    for selector in candidates:
        loc = page.locator(selector)
        if loc.count() > 0:
            return [loc.nth(i) for i in range(loc.count())]
    return []


def row_text(locator: Locator) -> str:
    with contextlib.suppress(Exception):
        return normalize_text(locator.inner_text())
    return ""


def locate_detail_root(page: Page) -> Locator:
    # 상세 정보가 표시되는 컨테이너 후보
    candidates = [
        ".theme-detail",
        ".detail-wrap",
        ".right-detail",
        "#themeDetail",
        "#detail",
        "main",
        "body",
    ]
    for selector in candidates:
        loc = page.locator(selector)
        if loc.count() > 0:
            return loc.first
    return page.locator("body")


def parse_detail_panel(page: Page, fallback_name: str = "") -> ThemeRecord:
    root = locate_detail_root(page)
    html = root.inner_html()
    soup = BeautifulSoup(html, "html.parser")

    # 테마명
    name_candidates = [
        soup.select_one("h1"),
        soup.select_one("h2"),
        soup.select_one("h3"),
        soup.select_one(".theme-name"),
        soup.select_one(".title"),
    ]
    theme_name = next((normalize_text(n.get_text(" ")) for n in name_candidates if n and normalize_text(n.get_text(" "))), "")
    if not theme_name:
        theme_name = fallback_name

    # 설명
    description = ""
    for selector in [".theme-desc", ".description", ".summary", "#themeSummary", "p"]:
        node = soup.select_one(selector)
        if node:
            text = normalize_text(node.get_text(" "))
            if len(text) >= 8:
                description = text
                break

    # 섹션 구분(헤더 텍스트 기반)
    all_tables = soup.select("table")

    histories: List[ThemeHistory] = []
    stocks: List[ThemeStock] = []

    for table in all_tables:
        headers = [normalize_text(th.get_text(" ")) for th in table.select("th")]

        if any("일자" in h for h in headers) and any("내용" in h for h in headers):
            for tr in table.select("tbody tr") or table.select("tr"):
                tds = tr.select("td")
                if len(tds) < 2:
                    continue
                date_text = parse_date(tds[0].get_text(" "))
                content = normalize_text(tds[1].get_text(" "))
                if content:
                    histories.append(ThemeHistory(history_date=date_text, content=content))

        if any("종목" in h for h in headers) and any("요약" in h or "기업" in h for h in headers):
            for tr in table.select("tbody tr") or table.select("tr"):
                tds = tr.select("td")
                if len(tds) < 2:
                    continue
                stock_name = normalize_text(tds[0].get_text(" "))
                summary = normalize_text(tds[1].get_text(" "))
                if stock_name:
                    stocks.append(ThemeStock(stock_name=stock_name, summary=summary))

    # 국내 관련테마(버튼/칩)
    related_themes: List[str] = []
    for selector in [
        "button",
        ".chip",
        ".badge",
        ".related-theme button",
        ".related-theme a",
        "a.btn",
    ]:
        for node in soup.select(selector):
            text = normalize_text(node.get_text(" "))
            if not text:
                continue
            # 너무 일반적인 텍스트 필터
            if text in {"상세", "더보기", "조회", "닫기"}:
                continue
            if 1 <= len(text) <= 40:
                related_themes.append(text)

    # 중복 제거
    related_themes = list(dict.fromkeys(related_themes))

    return ThemeRecord(
        name=theme_name,
        description=description,
        histories=histories,
        domestic_related_themes=related_themes,
        stocks=stocks,
    )


def ensure_schema(conn: mariadb.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS us_themes (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          theme_name VARCHAR(255) NOT NULL,
          description TEXT NULL,
          last_crawled_at DATETIME NOT NULL,
          UNIQUE KEY uk_theme_name (theme_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS us_theme_histories (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          theme_id BIGINT NOT NULL,
          history_date DATE NULL,
          content TEXT NOT NULL,
          sort_no INT NOT NULL DEFAULT 0,
          FOREIGN KEY (theme_id) REFERENCES us_themes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS us_theme_related_domestic (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          theme_id BIGINT NOT NULL,
          related_theme_name VARCHAR(255) NOT NULL,
          FOREIGN KEY (theme_id) REFERENCES us_themes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS us_theme_stocks (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          theme_id BIGINT NOT NULL,
          stock_name VARCHAR(255) NOT NULL,
          summary TEXT NULL,
          FOREIGN KEY (theme_id) REFERENCES us_themes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    conn.commit()


def upsert_theme(conn: mariadb.Connection, theme: ThemeRecord) -> int:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO us_themes (theme_name, description, last_crawled_at)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description),
          last_crawled_at = VALUES(last_crawled_at)
        """,
        (theme.name, theme.description, now),
    )

    cur.execute("SELECT id FROM us_themes WHERE theme_name = ?", (theme.name,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"테마 upsert 후 ID 조회 실패: {theme.name}")
    theme_id = int(row[0])

    # 전체 재적재 방식(단순/안정)
    cur.execute("DELETE FROM us_theme_histories WHERE theme_id = ?", (theme_id,))
    cur.execute("DELETE FROM us_theme_related_domestic WHERE theme_id = ?", (theme_id,))
    cur.execute("DELETE FROM us_theme_stocks WHERE theme_id = ?", (theme_id,))

    for idx, h in enumerate(theme.histories, start=1):
        history_date = h.history_date if h.history_date and re.match(r"^\d{4}-\d{2}-\d{2}$", h.history_date) else None
        cur.execute(
            """
            INSERT INTO us_theme_histories (theme_id, history_date, content, sort_no)
            VALUES (?, ?, ?, ?)
            """,
            (theme_id, history_date, h.content, idx),
        )

    for related in theme.domestic_related_themes:
        cur.execute(
            """
            INSERT INTO us_theme_related_domestic (theme_id, related_theme_name)
            VALUES (?, ?)
            """,
            (theme_id, related),
        )

    for s in theme.stocks:
        cur.execute(
            """
            INSERT INTO us_theme_stocks (theme_id, stock_name, summary)
            VALUES (?, ?, ?)
            """,
            (theme_id, s.stock_name, s.summary),
        )

    conn.commit()
    return theme_id


def login(page: Page, args: argparse.Namespace) -> None:
    page.goto(args.login_url, wait_until="domcontentloaded", timeout=args.timeout_ms)

    user = page.locator(args.username_selector).first
    pw = page.locator(args.password_selector).first

    if user.count() == 0 or pw.count() == 0:
        raise RuntimeError("로그인 input selector를 찾지 못했습니다. selector 인자를 확인하세요.")

    user.fill(args.username)
    pw.fill(args.password)

    submit_ok = click_first(page, [args.login_submit_selector], args.timeout_ms)
    if not submit_ok:
        raise RuntimeError("로그인 버튼 클릭 실패. --login-submit-selector 확인 필요")

    page.wait_for_load_state("networkidle", timeout=args.timeout_ms)


def goto_us_theme_page(page: Page, args: argparse.Namespace) -> None:
    page.goto(args.base_url, wait_until="domcontentloaded", timeout=args.timeout_ms)

    # 메뉴: 테마 > 미국 테마DB > 미국 테마 한눈에 보기
    click_by_text(page, ["테마"], args.timeout_ms)
    page.wait_for_timeout(500)
    click_by_text(page, ["미국 테마DB", "미국테마DB"], args.timeout_ms)
    page.wait_for_timeout(700)
    click_by_text(page, ["미국 테마 한눈에 보기"], args.timeout_ms)

    with contextlib.suppress(PlaywrightTimeoutError):
        page.wait_for_load_state("networkidle", timeout=args.timeout_ms)


def crawl_themes(page: Page, max_themes: int, timeout_ms: int) -> Iterable[ThemeRecord]:
    items = extract_theme_list_items(page)
    if not items:
        raise RuntimeError("테마 목록을 찾지 못했습니다. selector 보강이 필요합니다.")

    LOGGER.info("테마 목록 %d건 감지", len(items))

    total = len(items) if max_themes <= 0 else min(len(items), max_themes)

    for idx in range(total):
        item = items[idx]
        fallback_name = row_text(item).split(" ")[0] if row_text(item) else f"theme_{idx+1}"

        item.click(timeout=timeout_ms)
        # 상세패널 렌더링 대기
        page.wait_for_timeout(350)

        record = parse_detail_panel(page, fallback_name=fallback_name)
        if not record.name:
            record.name = fallback_name

        LOGGER.info(
            "[%d/%d] %s (history=%d, related=%d, stocks=%d)",
            idx + 1,
            total,
            record.name,
            len(record.histories),
            len(record.domestic_related_themes),
            len(record.stocks),
        )
        yield record


def run(args: argparse.Namespace) -> None:
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    conn = mariadb.connect(
        host=args.db_host,
        port=args.db_port,
        user=args.db_user,
        password=args.db_password,
        database=args.db_name,
        autocommit=False,
        charset=args.db_charset,
    )

    ensure_schema(conn)

    start = time.time()
    count = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless, slow_mo=args.slow_mo)
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(args.timeout_ms)

        login(page, args)
        goto_us_theme_page(page, args)

        for record in crawl_themes(page, args.max_themes, args.timeout_ms):
            upsert_theme(conn, record)
            count += 1

        context.close()
        browser.close()

    LOGGER.info("완료: %d건 저장 (%.1fs)", count, time.time() - start)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
