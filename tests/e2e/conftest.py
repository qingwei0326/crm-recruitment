"""E2E-only fixtures.

These browser tests target a running local app, so they should not reuse the
API unit-test database fixture from ``tests/conftest.py``. They also use
Playwright's async API, while ``pytest-playwright`` exposes sync fixtures.
"""

import pytest_asyncio
from playwright.async_api import async_playwright


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    yield


@pytest_asyncio.fixture
async def page():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="zh-CN",
        )
        page = await context.new_page()
        try:
            yield page
        finally:
            await context.close()
            await browser.close()
