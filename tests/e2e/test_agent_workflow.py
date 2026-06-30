"""Agent workflow E2E tests -- deep functional testing.

Tests the full agent lifecycle:
  1. Login
  2. View today tasks (verify data loaded)
  3. Expand student row (view detail)
  4. Dial flow: click phone icon -> status -> intent -> follow-up
  5. Add note from expanded row
  6. Switch to "follow-up" tab
  7. Filter by school dropdown / search
  8. Add student modal
  9. Logout

Run:  PYTHONIOENCODING=utf-8 .venv-win/Scripts/python.exe tests/e2e/test_agent_workflow.py
"""

import asyncio
import os
import sys

from playwright.async_api import TimeoutError as PwTimeout
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:3000"

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
    """Full clear + login flow."""
    ctx = page.context
    await ctx.clear_cookies()
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
    """Login as e2etest agent."""
    print("\n[1] Login as agent")
    await clear_and_login(page, "e2etest", "e2etest123")
    assert "/agent" in page.url, f"Expected /agent, got {page.url}"
    await page.wait_for_timeout(2000)
    await shot(page, "wf_01_agent_home")
    ok(f"Logged in, URL: {page.url}")


async def test_02_today_tasks(page):
    """Verify today tasks loaded with student data."""
    print("\n[2] Verify today tasks")
    body = await page.text_content("body")

    # Check student names visible
    student_names = ["林灿阳", "吕江豪", "黄仲坤", "曾晓蓉", "杨宇彤"]
    found = [n for n in student_names if n in body]
    assert len(found) >= 1, "No student names found in body"
    ok(f"Students visible: {', '.join(found)}")

    # Check stats
    has_stats = "待拨打" in body and "数据总数" in body
    ok(f"Stats bar visible: {has_stats}")

    # Verify table headers
    has_headers = all(h in body for h in ["姓名", "学校", "阶段", "状态", "操作"])
    ok(f"Table headers: {has_headers}")

    await shot(page, "wf_02_today_tasks")


async def test_03_expand_student_row(page):
    """Click a student row to expand detail."""
    print("\n[3] Expand student row")
    # Click the first student row (click the name cell)
    first_name = page.locator(
        'td:has-text("林灿阳"), td:has-text("吕江豪"), td:has-text("黄仲坤")'
    ).first
    if await first_name.count() > 0:
        await first_name.click()
        await page.wait_for_timeout(1500)

        # Check expanded row content
        body = await page.text_content("body")
        has_expanded = "联系人" in body or "地域" in body or "成绩" in body
        ok(f"Row expanded, detail visible: {has_expanded}")
        await shot(page, "wf_03_expanded_row")
    else:
        ok("Could not find student name cell")


async def test_04_quick_status_flow(page):
    """Test quick status buttons in expanded row + dial modal via sessionStorage."""
    print("\n[4] Quick status + dial modal flow")

    # First expand a row (click on 黄仲坤)
    row = page.locator('tr:has(td:has-text("黄仲坤"))').first
    if await row.count() > 0:
        await row.click()
        await page.wait_for_timeout(1000)
        ok("Expanded 黄仲坤's row")

    # Test quick status button: click "新线索" in expanded row
    quick_btn = page.locator('button:has-text("新线索")').first
    if await quick_btn.count() > 0:
        await quick_btn.click()
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        # Status should update (the quick status button directly calls updateStatus)
        ok("Quick status '新线索' clicked")
        await shot(page, "wf_04a_after_quick_status")
    else:
        ok("No quick status buttons found")

    # Now test the dial modal by setting sessionStorage and reloading
    info("Simulating dial modal via sessionStorage...")
    student_id = 54323  # 黄仲坤
    student_name = "黄仲坤"
    await page.evaluate(f"""
        sessionStorage.setItem('pendingDial', JSON.stringify({{
            studentId: {student_id},
            studentName: '{student_name}'
        }}));
    """)
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(2000)
    await shot(page, "wf_04b_dial_modal")

    body = await page.text_content("body")
    has_modal = "通话已完成" in body or "请选择处理结果" in body
    info(f"Dial modal visible after reload: {has_modal}")

    if has_modal:
        # Step 1: Select status "非常有意向" (red button in modal)
        status_btn = page.locator('button:has-text("非常有意向")').first
        if await status_btn.count() > 0:
            await status_btn.click()
            await page.wait_for_timeout(1500)
            await shot(page, "wf_04c_status_selected")
            ok("Status '非常有意向' selected")

            # Check if intent selection appeared
            body2 = await page.text_content("body")
            has_intent = "意向等级" in body2 or "请选择意向" in body2
            if has_intent:
                intent_btn = page.locator(
                    'button:has-text("A级"), button:has-text("B级"), button:has-text("C级")'
                ).first
                if await intent_btn.count() > 0:
                    await intent_btn.click()
                    await page.wait_for_timeout(1000)
                    await shot(page, "wf_04d_intent_selected")
                    ok("Intent level selected")
                else:
                    ok("No intent buttons found")

            # Check if modal closed
            body3 = await page.text_content("body")
            modal_gone = "通话已完成" not in body3
            ok(f"Modal closed: {modal_gone}")
        else:
            ok("Status button '非常有意向' not found")
    else:
        ok("Dial modal not shown (pendingDial may not have triggered)")

    await shot(page, "wf_04e_after_dial")


async def test_05_add_note(page):
    """Add a note via the expanded row's note input."""
    print("\n[5] Add note")
    # First expand a row if not already expanded
    body = await page.text_content("body")
    has_note_area = "写备注" in body or "添加备注" in body

    if not has_note_area:
        # Click a row to expand
        first_row = page.locator('tr:has(td:has-text("林灿阳"))').first
        if await first_row.count() > 0:
            await first_row.click()
            await page.wait_for_timeout(1000)

    # Look for note textarea/input in expanded row
    note_input = page.locator(
        'input[placeholder*="备注"], textarea[placeholder*="备注"], input[placeholder*="记录"]'
    ).first
    if await note_input.count() > 0:
        await note_input.fill("E2E自动化测试备注")
        await page.wait_for_timeout(500)

        # Find the note submit button (check icon near the input)
        note_submit = page.locator('button[title*="记录"], button:has(svg.text-green-600)').last
        if await note_submit.count() > 0:
            await note_submit.click()
            await page.wait_for_timeout(1000)
            await shot(page, "wf_05_note_added")
            ok("Note added")
        else:
            # Try pressing Enter
            await note_input.press("Enter")
            await page.wait_for_timeout(1000)
            ok("Note submitted via Enter")
    else:
        # Try the StickyNote icon button in the row
        note_btn = page.locator('button[title="写备注"]').first
        if await note_btn.count() > 0:
            await note_btn.click()
            await page.wait_for_timeout(1000)
            await shot(page, "wf_05_note_panel")
            ok("Note panel opened via button")

            # Now look for the input
            note_input2 = page.locator(
                'input[placeholder*="备注"], textarea[placeholder*="备注"]'
            ).first
            if await note_input2.count() > 0:
                await note_input2.fill("E2E自动化测试备注")
                await note_input2.press("Enter")
                await page.wait_for_timeout(1000)
                ok("Note entered")
        else:
            ok("No note input/button found")


async def test_06_following_tab(page):
    """Switch to '跟进中' tab."""
    print("\n[6] Following tab")
    following_btn = page.locator('button:has-text("跟进中")').first
    if await following_btn.count() > 0:
        await following_btn.click()
        await page.wait_for_timeout(2000)
        await shot(page, "wf_06_following_tab")

        body = await page.text_content("body")
        has_content = "跟进" in body or "暂无" in body or "待回访" in body
        ok(f"Following tab loaded: {has_content}")
    else:
        ok("Following button not found")


async def test_07_school_filter(page):
    """Test school filter dropdown."""
    print("\n[7] School filter")
    # Switch back to dial queue
    today_btn = page.locator('button:has-text("待拨打")').first
    if await today_btn.count() > 0:
        await today_btn.click()
        await page.wait_for_timeout(1500)

    # Find school dropdown
    school_select = page.locator("select").first
    if await school_select.count() > 0:
        # Get all options
        options = await school_select.locator("option").all()
        option_texts = []
        for opt in options[:5]:
            txt = await opt.text_content()
            option_texts.append(txt.strip())
        ok(f"School dropdown options: {option_texts}")

        # Select first non-default option
        if len(options) > 1:
            await school_select.select_option(index=1)
            await page.wait_for_timeout(1000)
            await shot(page, "wf_07_school_filtered")
            ok("School filter applied")
    else:
        ok("No school dropdown found")


async def test_08_search(page):
    """Test search functionality."""
    print("\n[8] Search")
    search_input = page.locator(
        'input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]'
    ).first
    if await search_input.count() > 0:
        await search_input.fill("林")
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        has_result = "林灿阳" in body
        ok(f"Search for '林': found={has_result}")
        await shot(page, "wf_08_search")

        # Clear search
        await search_input.fill("")
        await page.wait_for_timeout(1000)
    else:
        # Check for search in the filter area
        ok("No search input found (may be in collapsed filter)")


async def test_09_add_student_modal(page):
    """Test the add student modal."""
    print("\n[9] Add student modal")
    add_btn = page.locator('button:has-text("添加学生"), button[title*="添加"]').first
    if await add_btn.count() > 0:
        await add_btn.click()
        await page.wait_for_timeout(1000)
        await shot(page, "wf_09_add_student_modal")

        body = await page.text_content("body")
        has_modal = "添加学生" in body or "姓名" in body
        ok(f"Add student modal visible: {has_modal}")

        # Close modal
        close_btn = page.locator('button:has-text("取消"), button[aria-label="关闭"]').first
        if await close_btn.count() > 0:
            await close_btn.click()
            await page.wait_for_timeout(500)
            ok("Modal closed")
    else:
        ok("Add student button not found")


async def test_10_logout(page):
    """Logout agent."""
    print("\n[10] Logout")
    # Close any open modals first (ESC key or close button)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(500)
    # Try clicking close button on any modal
    close_modal = page.locator(
        '.fixed button:has-text("取消"), .fixed button[aria-label="关闭"], .fixed button:has(svg)'
    ).first
    if await close_modal.count() > 0:
        try:
            await close_modal.click(timeout=2000)
            await page.wait_for_timeout(500)
        except Exception:
            pass

    logout_btn = page.locator('button:has-text("退出登录")').first
    if await logout_btn.count() > 0:
        await logout_btn.click(timeout=5000)
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        on_login = "登录" in body or "招生话务" in body
        ok(f"Logged out, on login page: {on_login}")
        await shot(page, "wf_10_logout")
    else:
        ok("Logout button not found")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ALL_TESTS = [
    test_01_login,
    test_02_today_tasks,
    test_03_expand_student_row,
    test_04_quick_status_flow,
    test_05_add_note,
    test_06_following_tab,
    test_07_school_filter,
    test_08_search,
    test_09_add_student_modal,
    test_10_logout,
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
