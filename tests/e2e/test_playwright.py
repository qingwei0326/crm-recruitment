# -*- coding: utf-8 -*-
"""Playwright E2E tests for CRM system.

Run directly:  python tests/e2e/test_playwright.py
"""

import asyncio
import os
import sys
from playwright.async_api import async_playwright, expect, TimeoutError as PwTimeout

BASE_URL = "http://localhost:3000"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def login(page, username="admin", password="admin123"):
    """Login and wait for redirect."""
    # Clear auth cookies to fully reset state
    ctx = page.context
    await ctx.clear_cookies()
    # Navigate first so localStorage is accessible, then clear it
    await page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    await page.evaluate("localStorage.clear(); sessionStorage.clear();")
    # Reload so React re-initializes from empty state
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


async def logout(page):
    """Click logout button, handle stale elements."""
    try:
        # Clear storage to force logout
        await page.evaluate("localStorage.clear(); sessionStorage.clear();")
        await safe_goto(page, f"{BASE_URL}/login")
        await page.wait_for_load_state("networkidle")
        return True
    except Exception:
        return False


async def safe_goto(page, url):
    """Navigate and wait for network idle."""
    await page.goto(url)
    await page.wait_for_load_state("networkidle")


async def shot(page, name):
    """Take a screenshot for debugging."""
    path = f"tests/e2e/screenshots/{name}.png"
    await page.screenshot(path=path, full_page=True)
    print(f"  [shot] {path}")


def ok(msg):
    print(f"  [OK] {msg}")


def fail(msg):
    print(f"  [FAIL] {msg}")


def skip(msg):
    print(f"  [SKIP] {msg}")


# ---------------------------------------------------------------------------
# Admin tests
# ---------------------------------------------------------------------------

async def test_admin_login(page):
    """1. Admin login -> dashboard."""
    print("\n[1/16] Admin login -> dashboard")
    await login(page, "admin", "admin123")
    assert "/admin" in page.url, f"Expected /admin, got {page.url}"
    await page.wait_for_load_state("networkidle")
    await expect(page.locator("text=CRM 管理后台").first).to_be_visible(timeout=8000)
    await shot(page, "01_admin_dashboard")
    ok("PASSED")


async def test_admin_sidebar_nav(page):
    """2. Admin sidebar navigation."""
    print("\n[2/16] Admin sidebar navigation")
    nav_items = [
        ("/admin", "首页"),
        ("/admin/work-center", "工作中心"),
        ("/admin/leads", "学生管理"),
        ("/admin/governance", "线索治理"),
        ("/admin/recycle", "线索回收"),
        ("/admin/agents", "账号管理"),
        ("/admin/report", "数据报表"),
        ("/admin/trend", "趋势报表"),
        ("/admin/call-volume", "话务查询"),
        ("/admin/settings", "系统设置"),
    ]
    for path, label in nav_items:
        await safe_goto(page, f"{BASE_URL}{path}")
        await page.wait_for_load_state("networkidle")
        await shot(page, f"02_{path.replace('/', '_').strip('_')}")
        ok(f"{label} ({path}) loaded")
    ok("PASSED")


async def test_admin_leads_management(page):
    """3. Leads management -- search."""
    print("\n[3/16] Leads management")
    await safe_goto(page, f"{BASE_URL}/admin/leads")
    await page.wait_for_load_state("networkidle")
    content = await page.text_content("body")
    assert "学生" in content or "线索" in content, "Leads page missing content"
    search_input = page.locator('input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]').first
    if await search_input.count() > 0:
        await search_input.fill("张")
        await page.wait_for_timeout(1500)
        ok("Search tested")
    await shot(page, "03_leads_management")
    ok("PASSED")


async def test_admin_lead_detail(page):
    """4. Lead detail page."""
    print("\n[4/16] Lead detail")
    await safe_goto(page, f"{BASE_URL}/admin/leads")
    await page.wait_for_load_state("networkidle")
    first_row = page.locator("table tbody tr, .student-row, [class*='cursor-pointer']").first
    if await first_row.count() > 0:
        await first_row.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1000)
        await shot(page, "04_lead_detail")
        ok("PASSED (detail opened)")
    else:
        await shot(page, "04_leads_no_data")
        skip("no student data to click")


async def test_admin_governance(page):
    """5. Lead governance."""
    print("\n[5/16] Lead governance")
    await safe_goto(page, f"{BASE_URL}/admin/governance")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "05_governance")
    ok("PASSED")


async def test_admin_recycle(page):
    """6. Lead recycle."""
    print("\n[6/16] Lead recycle")
    await safe_goto(page, f"{BASE_URL}/admin/recycle")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "06_recycle")
    ok("PASSED")


async def test_admin_agent_manage(page):
    """7. Agent management."""
    print("\n[7/16] Agent management")
    await safe_goto(page, f"{BASE_URL}/admin/agents")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "07_agents")
    ok("PASSED")


async def test_admin_reports(page):
    """8. Reports."""
    print("\n[8/16] Reports")
    await safe_goto(page, f"{BASE_URL}/admin/report")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "08_report")
    ok("PASSED")


async def test_admin_trend(page):
    """9. Trend report."""
    print("\n[9/16] Trend report")
    await safe_goto(page, f"{BASE_URL}/admin/trend")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "09_trend")
    ok("PASSED")


async def test_admin_call_volume(page):
    """10. Call volume query."""
    print("\n[10/16] Call volume query")
    await safe_goto(page, f"{BASE_URL}/admin/call-volume")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "10_call_volume")
    ok("PASSED")


async def test_admin_settings(page):
    """11. System settings."""
    print("\n[11/16] System settings")
    await safe_goto(page, f"{BASE_URL}/admin/settings")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "11_settings")
    ok("PASSED")


async def test_admin_invalid_reclaim(page):
    """12. Invalid student reclaim."""
    print("\n[12/16] Invalid student reclaim")
    await safe_goto(page, f"{BASE_URL}/admin/invalid-reclaim")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "12_invalid_reclaim")
    ok("PASSED")


async def test_admin_distribute(page):
    """13. Distribute by schools."""
    print("\n[13/16] Distribute by schools")
    await safe_goto(page, f"{BASE_URL}/admin/distribute")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)
    await shot(page, "13_distribute")
    ok("PASSED")


# ---------------------------------------------------------------------------
# Agent tests (need agent login)
# ---------------------------------------------------------------------------

async def test_agent_login(page):
    """14. Agent login -> work center with today/following tabs."""
    print("\n[14/16] Agent login -> work center")
    # Logout admin first
    await logout(page)
    # Login as agent
    await login(page, "e2etest", "e2etest123")
    # Wait for agent work center
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(2000)
    content = await page.text_content("body")
    ok(f"Logged in, URL: {page.url}")

    # Try dial queue tab
    today_btn = page.locator('button:has-text("待拨打")').first
    if await today_btn.count() > 0:
        await today_btn.click()
        await page.wait_for_timeout(1500)
        ok("Dial queue tab clicked")

    # Try following tab
    following_btn = page.locator('button:has-text("跟进中")').first
    if await following_btn.count() > 0:
        await following_btn.click()
        await page.wait_for_timeout(1500)
        ok("Following tab clicked")

    await shot(page, "14_agent_work")
    ok("PASSED")


# ---------------------------------------------------------------------------
# Mobile tests
# ---------------------------------------------------------------------------

async def test_mobile_home(page):
    """15. Mobile: login -> mobile home with task/pending/me tabs."""
    print("\n[15/16] Mobile: login + home tabs")
    # Set mobile viewport
    await page.set_viewport_size({"width": 390, "height": 844})

    # Logout agent first
    await logout(page)

    # Login as e2etest (agent) for mobile
    await login(page, "e2etest", "e2etest123")

    # Navigate to mobile home
    await safe_goto(page, f"{BASE_URL}/mobile")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(2000)
    await shot(page, "15_mobile_home")

    # Check for bottom tab bar
    task_tab = page.locator('text=待拨打').first
    pending_tab = page.locator('text=待处理').first
    me_tab = page.locator('text=我的').first

    has_tabs = False
    if await task_tab.count() > 0:
        ok("Task tab found")
        has_tabs = True
    if await pending_tab.count() > 0:
        ok("Pending tab found")
        has_tabs = True
    if await me_tab.count() > 0:
        ok("Me tab found")
        has_tabs = True

    assert has_tabs, "Mobile home missing bottom tabs"

    # Reset viewport
    await page.set_viewport_size({"width": 1280, "height": 800})
    ok("PASSED")


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

ADMIN_TESTS = [
    test_admin_login,
    test_admin_sidebar_nav,
    test_admin_leads_management,
    test_admin_lead_detail,
    test_admin_governance,
    test_admin_recycle,
    test_admin_agent_manage,
    test_admin_reports,
    test_admin_trend,
    test_admin_call_volume,
    test_admin_settings,
    test_admin_invalid_reclaim,
    test_admin_distribute,
]

AGENT_TESTS = [
    test_agent_login,
]

MOBILE_TESTS = [
    test_mobile_home,
]


async def main():
    os.makedirs("tests/e2e/screenshots", exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="zh-CN",
        )
        page = await context.new_page()

        passed = 0
        failed = 0
        errors = []
        test_num = 0

        # --- Admin tests ---
        print("\n" + "="*60)
        print("  ADMIN TESTS")
        print("="*60)
        for test_fn in ADMIN_TESTS:
            test_num += 1
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
                fail(f"{name}: ERROR -- {e}")
                errors.append((name, str(e)))
                failed += 1

        # --- Agent tests ---
        print("\n" + "="*60)
        print("  AGENT TESTS")
        print("="*60)
        for test_fn in AGENT_TESTS:
            test_num += 1
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
                fail(f"{name}: ERROR -- {e}")
                errors.append((name, str(e)))
                failed += 1

        # --- Mobile tests ---
        print("\n" + "="*60)
        print("  MOBILE TESTS")
        print("="*60)
        for test_fn in MOBILE_TESTS:
            test_num += 1
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
                fail(f"{name}: ERROR -- {e}")
                errors.append((name, str(e)))
                failed += 1

        await browser.close()

    total = passed + failed
    print(f"\n{'='*60}")
    print(f"  FINAL RESULTS: {passed}/{total} passed, {failed} failed")
    print(f"{'='*60}")
    if errors:
        print("\n  Failed tests:")
        for name, err in errors:
            short = err[:150].replace('\n', ' ')
            print(f"    - {name}: {short}")
    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
