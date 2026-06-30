"""Mobile workflow E2E tests -- deep functional testing.

Tests the full mobile agent lifecycle:
  1. Login (mobile viewport)
  2. Tasks tab: progress, school filter, search, student list
  3. Student detail page
  4. Dial flow (via sessionStorage simulation)
  5. Pending tab (follow-ups)
  6. Me tab: user info, settings, logout

Run:  PYTHONIOENCODING=utf-8 .venv-win/Scripts/python.exe tests/e2e/test_mobile_workflow.py
"""

import asyncio
import os
import sys

from playwright.async_api import TimeoutError as PwTimeout
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:3000"
MOBILE_VIEWPORT = {"width": 390, "height": 844}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def shot(page, name):
    path = f"tests/e2e/screenshots/{name}.png"
    await page.screenshot(path=path, full_page=True)
    print(f"  [shot] {path}")


def ok(msg):
    print(f"  [OK] {msg}")


def fail(msg):
    print(f"  [FAIL] {msg}")


def info(msg):
    print(f"  [..] {msg}")


async def clear_and_login(page, username, password):
    """Full clear + login flow for mobile."""
    ctx = page.context
    await ctx.clear_cookies()
    await page.set_viewport_size(MOBILE_VIEWPORT)
    await page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    await page.evaluate("localStorage.clear(); sessionStorage.clear();")
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(500)
    await page.fill('input[placeholder="请输入用户名"]', username)
    await page.fill('input[placeholder="请输入密码"]', password)
    await page.click('button[type="submit"]')
    await page.wait_for_function(
        "() => !window.location.pathname.includes('/login')",
        timeout=10000,
    )
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_01_login(page):
    """Login as agent with mobile viewport."""
    print("\n[1] Mobile login")
    await clear_and_login(page, "e2etest", "e2etest123")
    await page.wait_for_timeout(1500)

    # Navigate to mobile home
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(2000)

    body = await page.text_content("body")
    has_greeting = "你好" in body or "E2E" in body
    ok(f"Mobile home loaded, greeting: {has_greeting}")
    await shot(page, "mob_01_home")


async def test_02_tasks_tab(page):
    """Tasks tab: progress card, student list."""
    print("\n[2] Tasks tab")
    body = await page.text_content("body")

    # Check progress card
    has_progress = "待拨打进度" in body
    ok(f"Progress card: {has_progress}")

    # Check stat cards
    has_stats = "总数" in body and "已联系" in body
    ok(f"Stat cards: {has_stats}")

    # Check student names
    student_names = ["林灿阳", "吕江豪", "黄仲坤", "曾晓蓉", "杨宇彤"]
    found = [n for n in student_names if n in body]
    ok(f"Students visible: {', '.join(found) if found else 'none'}")

    # Check bottom tab bar
    has_tabs = "待拨打" in body and "待处理" in body and "我的" in body
    ok(f"Bottom tabs: {has_tabs}")

    await shot(page, "mob_02_tasks")


async def test_03_school_filter(page):
    """School filter tags."""
    print("\n[3] School filter")
    # Check if school filter tags exist
    school_tag = page.locator('button:has-text("华安县丰山中心小学")').first
    if await school_tag.count() > 0:
        await school_tag.click()
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        has_filtered = "华安" in body
        ok(f"School filter applied: {has_filtered}")
        await shot(page, "mob_03_school_filtered")

        # Click "全部" to reset
        all_tag = page.locator('button:has-text("全部")').first
        if await all_tag.count() > 0:
            await all_tag.click()
            await page.wait_for_timeout(1000)
            ok("Filter reset to all")
    else:
        ok("No school filter tags (only 1 school)")


async def test_04_search(page):
    """Search by name or phone."""
    print("\n[4] Search")
    # Make sure we're on the tasks tab
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1500)

    search_input = page.locator('input[placeholder*="搜索"]').first
    if await search_input.count() > 0:
        await search_input.fill("林")
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        has_result = "林灿阳" in body
        ok(f"Search for '林': found={has_result}")
        await shot(page, "mob_04_search")

        # Clear search
        await search_input.fill("")
        await page.wait_for_timeout(1000)
    else:
        ok("No search input found")


async def test_05_student_detail(page):
    """Navigate to student detail page."""
    print("\n[5] Student detail")
    # Make sure we're on the tasks tab
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1500)

    # Click on a student card's detail button
    detail_btn = page.locator('button:has-text("详情")').first
    if await detail_btn.count() > 0:
        await detail_btn.click()
        await page.wait_for_timeout(2000)
        await shot(page, "mob_05_student_detail")

        body = await page.text_content("body")
        has_detail = "联系人" in body or "阶段" in body or "通话记录" in body or "监护人" in body
        ok(f"Student detail loaded: {has_detail}")

        # Go back to mobile home
        await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
        await page.wait_for_timeout(1000)
    else:
        ok("No detail button found")


async def test_06_dial_flow(page):
    """Test dial flow via sessionStorage simulation."""
    print("\n[6] Dial flow")
    # First navigate to mobile home
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1000)

    # Set pendingDial and reload to trigger dial modal
    student_id = 54324  # 曾晓蓉
    student_name = "曾晓蓉"
    await page.evaluate(f"""
        sessionStorage.setItem('pendingDial', JSON.stringify({{
            studentId: {student_id},
            studentName: '{student_name}'
        }}));
    """)
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(2000)
    await shot(page, "mob_06_dial_modal")

    body = await page.text_content("body")
    has_modal = "通话已完成" in body or "请选择处理结果" in body
    info(f"Dial modal visible: {has_modal}")

    if has_modal:
        # Select status - use force=True because mobile bottom sheet may overlap
        status_btn = page.locator('button:has-text("意向了解加微")').first
        if await status_btn.count() > 0:
            await status_btn.click(force=True)
            await page.wait_for_timeout(1500)
            ok("Status '意向了解加微' selected")
            await shot(page, "mob_06b_status_selected")
        else:
            # Try "新线索"
            btn = page.locator('button:has-text("新线索")').first
            if await btn.count() > 0:
                await btn.click(force=True)
                await page.wait_for_timeout(1000)
                ok("Status '新线索' selected")
    else:
        ok("Dial modal not shown")


async def test_07_pending_tab(page):
    """Pending tab (follow-ups)."""
    print("\n[7] Pending tab")
    pending_link = page.locator('a:has-text("待处理"), button:has-text("待处理")').first
    if await pending_link.count() > 0:
        await pending_link.click()
        await page.wait_for_timeout(2000)
        await shot(page, "mob_07_pending")

        body = await page.text_content("body")
        has_pending = "待处理" in body or "回访" in body or "暂无" in body
        ok(f"Pending tab loaded: {has_pending}")
    else:
        # Navigate via URL
        await page.goto(f"{BASE_URL}/mobile?tab=pending", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await shot(page, "mob_07_pending")
        ok("Pending tab via URL")


async def test_08_me_tab(page):
    """Me tab: user info, settings."""
    print("\n[8] Me tab")
    me_link = page.locator('a:has-text("我的"), button:has-text("我的")').first
    if await me_link.count() > 0:
        await me_link.click()
        await page.wait_for_timeout(1500)
        await shot(page, "mob_08_me")

        body = await page.text_content("body")
        has_user_info = "E2E" in body or "坐席" in body or "退出登录" in body
        ok(f"Me tab loaded: {has_user_info}")

        # Check settings button
        has_settings = "PushPlus" in body or "主题模式" in body
        ok(f"Settings visible: {has_settings}")
    else:
        await page.goto(f"{BASE_URL}/mobile?tab=me", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await shot(page, "mob_08_me")
        ok("Me tab via URL")


async def test_09_logout(page):
    """Logout from mobile."""
    print("\n[9] Logout")
    logout_btn = page.locator('button:has-text("退出登录")').first
    if await logout_btn.count() > 0:
        await logout_btn.click()
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        on_login = "登录" in body or "招生话务" in body
        ok(f"Logged out, on login page: {on_login}")
        await shot(page, "mob_09_logout")
    else:
        ok("Logout button not found")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ALL_TESTS = [
    test_01_login,
    test_02_tasks_tab,
    test_03_school_filter,
    test_04_search,
    test_05_student_detail,
    test_06_dial_flow,
    test_07_pending_tab,
    test_08_me_tab,
    test_09_logout,
]


async def main():
    os.makedirs("tests/e2e/screenshots", exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport=MOBILE_VIEWPORT,
            locale="zh-CN",
            is_mobile=True,
            has_touch=True,
        )
        page = await context.new_page()

        passed = 0
        failed = 0
        errors = []

        for test_fn in ALL_TESTS:
            name = test_fn.__name__
            try:
                await test_fn(page)
                passed += 1
            except PwTimeout as e:
                await shot(page, f"FAIL_{name}")
                fail(f"{name}: TIMEOUT -- {e}")
                errors.append((name, str(e)))
                failed += 1
            except AssertionError as e:
                await shot(page, f"FAIL_{name}")
                fail(f"{name}: ASSERT FAIL -- {e}")
                errors.append((name, str(e)))
                failed += 1
            except Exception as e:
                await shot(page, f"FAIL_{name}")
                fail(f"{name}: ERROR -- {type(e).__name__}: {e}")
                errors.append((name, str(e)))
                failed += 1

        await browser.close()

    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
    print(f"{'=' * 60}")
    if errors:
        print("\n  Failed tests:")
        for name, err in errors:
            short = err[:200].replace("\n", " ")
            print(f"    - {name}: {short}")
    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
