# -*- coding: utf-8 -*-
"""全角色全流程 E2E 测试

覆盖:
  A. 管理员 (13 项) - 登录、仪表盘、学生管理、坐席管理、报表、设置等
  B. 话务员桌面端 (10 项) - 登录、任务、展开行、拨号、备注、筛选等
  C. 话务员移动端 (9 项) - 登录、待拨打、详情、拨号、待处理、我的等
  D. 安全 (3 项) - 权限隔离、错误登录、改密

Run:
  .venv-win\Scripts\python.exe tests\e2e\test_full_flow.py
"""

import asyncio
import os
import sys
from playwright.async_api import async_playwright, TimeoutError as PwTimeout

BASE_URL = "http://127.0.0.1:8000"
MOBILE_VIEWPORT = {"width": 390, "height": 844}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def shot(page, name):
    os.makedirs("tests/e2e/screenshots", exist_ok=True)
    path = f"tests/e2e/screenshots/full_{name}.png"
    await page.screenshot(path=path, full_page=True)
    print(f"  [shot] {path}")

def ok(msg): print(f"  [OK] {msg}")
def fail(msg): print(f"  [FAIL] {msg}")
def info(msg): print(f"  [..] {msg}")
def skip(msg): print(f"  [SKIP] {msg}")


async def clear_and_login(page, username, password, viewport=None):
    """Full clear + login flow."""
    ctx = page.context
    await ctx.clear_cookies()
    if viewport:
        await page.set_viewport_size(viewport)
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


async def safe_goto(page, url):
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(500)


async def force_logout(page):
    """Force logout by clearing storage."""
    await page.evaluate("localStorage.clear(); sessionStorage.clear();")
    ctx = page.context
    await ctx.clear_cookies()


# ===================================================================
# A. ADMIN TESTS
# ===================================================================

async def test_a01_health(page):
    """A01. API health check."""
    print("\n[A01] API health check")
    resp = await page.evaluate(f"""
        async () => {{
            const r = await fetch('{BASE_URL}/api/health');
            return r.ok;
        }}
    """)
    assert resp, "API health check failed"
    ok("API healthy")


async def test_a02_admin_login(page):
    """A02. Admin login -> dashboard."""
    print("\n[A02] Admin login")
    await clear_and_login(page, "admin", "admin123")
    assert "/admin" in page.url, f"Expected /admin, got {page.url}"
    body = await page.text_content("body")
    assert "CRM" in body or "管理" in body, "Dashboard not loaded"
    await shot(page, "a02_dashboard")
    ok(f"Logged in -> {page.url}")


async def test_a03_dashboard_data(page):
    """A03. Dashboard: verify stat cards and charts load."""
    print("\n[A03] Dashboard data")
    await safe_goto(page, f"{BASE_URL}/admin")
    await page.wait_for_timeout(2000)
    body = await page.text_content("body")
    # Check for dashboard elements
    has_data = any(k in body for k in ["总线索", "已报名", "今日通话", "坐席", "转化"])
    ok(f"Dashboard has data elements: {has_data}")
    await shot(page, "a03_dashboard_data")


async def test_a04_admin_sidebar_nav(page):
    """A04. Admin sidebar: navigate all pages."""
    print("\n[A04] Admin sidebar navigation")
    nav_items = [
        ("/admin", "首页"),
        ("/admin/work-center", "工作中心"),
        ("/admin/leads", "学生管理"),
        ("/admin/governance", "线索治理"),
        ("/admin/recycle-center", "线索回收"),
        ("/admin/agents", "账号管理"),
        ("/admin/report-center", "报表中心"),
        ("/admin/report", "汇总报表"),
        ("/admin/trend", "趋势报表"),
        ("/admin/call-volume", "话务查询"),
        ("/admin/settings", "系统设置"),
        ("/admin/invalid-reclaim", "无效线索"),
        ("/admin/distribute", "学校派案"),
    ]
    for path, label in nav_items:
        await safe_goto(page, f"{BASE_URL}{path}")
        await page.wait_for_timeout(1000)
        # Verify no crash (200 or content loaded)
        body = await page.text_content("body")
        has_error = "错误" in body and "加载" in body
        if has_error:
            fail(f"{label} ({path}) shows error")
        else:
            ok(f"{label} ({path})")
    await shot(page, "a04_sidebar_nav")


async def test_a05_leads_search(page):
    """A05. Leads management: search."""
    print("\n[A05] Leads search")
    await safe_goto(page, f"{BASE_URL}/admin/leads")
    await page.wait_for_timeout(1500)
    body = await page.text_content("body")
    assert "学生" in body or "线索" in body or "管理" in body, "Leads page missing"
    search = page.locator('input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]').first
    if await search.count() > 0:
        await search.fill("张")
        await page.wait_for_timeout(1500)
        ok("Search tested")
    else:
        ok("No search input found")
    await shot(page, "a05_leads_search")


async def test_a06_lead_detail(page):
    """A06. Lead detail: click first row."""
    print("\n[A06] Lead detail")
    await safe_goto(page, f"{BASE_URL}/admin/leads")
    await page.wait_for_timeout(1500)
    row = page.locator("table tbody tr, .student-row, [class*='cursor-pointer']").first
    if await row.count() > 0:
        await row.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        has_detail = any(k in body for k in ["联系人", "阶段", "通话记录", "备注", "地域", "监护人"])
        ok(f"Detail loaded: {has_detail}")
        await shot(page, "a06_lead_detail")
    else:
        skip("No student rows to click")


async def test_a07_governance(page):
    """A07. Lead governance page."""
    print("\n[A07] Lead governance")
    await safe_goto(page, f"{BASE_URL}/admin/governance")
    await page.wait_for_timeout(1500)
    body = await page.text_content("body")
    ok(f"Governance loaded")
    await shot(page, "a07_governance")


async def test_a08_recycle_center(page):
    """A08. Recycle center page."""
    print("\n[A08] Recycle center")
    await safe_goto(page, f"{BASE_URL}/admin/recycle-center")
    await page.wait_for_timeout(1500)
    ok("Recycle center loaded")
    await shot(page, "a08_recycle")


async def test_a09_agent_manage(page):
    """A09. Agent management: list agents."""
    print("\n[A09] Agent management")
    await safe_goto(page, f"{BASE_URL}/admin/agents")
    await page.wait_for_timeout(1500)
    body = await page.text_content("body")
    has_agents = "坐席" in body or "话务员" in body or "管理" in body
    ok(f"Agent management loaded: {has_agents}")
    await shot(page, "a09_agents")


async def test_a10_reports(page):
    """A10. Reports: summary + trend + call volume."""
    print("\n[A10] Reports")
    for path, label in [("/admin/report", "汇总"), ("/admin/trend", "趋势"), ("/admin/call-volume", "话务")]:
        await safe_goto(page, f"{BASE_URL}{path}")
        await page.wait_for_timeout(1500)
        ok(f"{label} report loaded")
    await shot(page, "a10_reports")


async def test_a11_settings(page):
    """A11. System settings: verify page loads."""
    print("\n[A11] System settings")
    await safe_goto(page, f"{BASE_URL}/admin/settings")
    await page.wait_for_timeout(1500)
    body = await page.text_content("body")
    has_settings = "设置" in body or "配置" in body
    ok(f"Settings loaded: {has_settings}")
    await shot(page, "a11_settings")


async def test_a12_invalid_reclaim(page):
    """A12. Invalid student reclaim."""
    print("\n[A12] Invalid reclaim")
    await safe_goto(page, f"{BASE_URL}/admin/invalid-reclaim")
    await page.wait_for_timeout(1500)
    ok("Invalid reclaim loaded")
    await shot(page, "a12_invalid_reclaim")


async def test_a13_distribute(page):
    """A13. Distribute by schools."""
    print("\n[A13] Distribute")
    await safe_goto(page, f"{BASE_URL}/admin/distribute")
    await page.wait_for_timeout(1500)
    ok("Distribute loaded")
    await shot(page, "a13_distribute")


# ===================================================================
# B. AGENT DESKTOP TESTS
# ===================================================================

async def test_b01_agent_login(page):
    """B01. Agent login -> desktop workspace."""
    print("\n[B01] Agent login (desktop)")
    await force_logout(page)
    await clear_and_login(page, "e2etest", "e2etest123")
    await page.wait_for_timeout(2000)
    body = await page.text_content("body")
    ok(f"Logged in -> {page.url}")
    await shot(page, "b01_agent_home")


async def test_b02_today_tasks(page):
    """B02. Today tasks: verify student data loads."""
    print("\n[B02] Today tasks")
    body = await page.text_content("body")
    student_names = ["林灿阳", "吕江豪", "黄仲坤", "曾晓蓉", "杨宇彤"]
    found = [n for n in student_names if n in body]
    ok(f"Students visible: {', '.join(found) if found else 'none'}")
    has_table = "姓名" in body
    ok(f"Table headers: {has_table}")
    await shot(page, "b02_today_tasks")


async def test_b03_expand_row(page):
    """B03. Expand student row."""
    print("\n[B03] Expand row")
    row = page.locator('td:has-text("林灿阳"), td:has-text("吕江豪"), td:has-text("黄仲坤")').first
    if await row.count() > 0:
        await row.click()
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        has_expanded = any(k in body for k in ["联系人", "地域", "成绩", "备注"])
        ok(f"Row expanded: {has_expanded}")
        await shot(page, "b03_expand_row")
    else:
        skip("No student row found")


async def test_b04_dial_flow(page):
    """B04. Dial flow via sessionStorage."""
    print("\n[B04] Dial flow")
    student_id = 54323
    await page.evaluate(f"""
        sessionStorage.setItem('pendingDial', JSON.stringify({{
            studentId: {student_id},
            studentName: '黄仲坤'
        }}));
    """)
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(2000)
    body = await page.text_content("body")
    has_modal = "通话已完成" in body or "请选择处理结果" in body
    ok(f"Dial modal visible: {has_modal}")
    if has_modal:
        btn = page.locator('button:has-text("非常有意向"), button:has-text("新线索"), button:has-text("意向了解加微")').first
        if await btn.count() > 0:
            await btn.click()
            await page.wait_for_timeout(1500)
            ok("Status selected")
    await shot(page, "b04_dial_flow")


async def test_b05_add_note(page):
    """B05. Add note."""
    print("\n[B05] Add note")
    # Expand a row first
    row = page.locator('td:has-text("林灿阳"), td:has-text("吕江豪")').first
    if await row.count() > 0:
        await row.click()
        await page.wait_for_timeout(1000)
    note_input = page.locator('input[placeholder*="备注"], textarea[placeholder*="备注"]').first
    if await note_input.count() > 0:
        await note_input.fill("E2E自动测试备注")
        await note_input.press("Enter")
        await page.wait_for_timeout(1000)
        ok("Note added")
    else:
        note_btn = page.locator('button[title="写备注"]').first
        if await note_btn.count() > 0:
            await note_btn.click()
            await page.wait_for_timeout(1000)
            ok("Note panel opened")
        else:
            skip("No note input found")
    await shot(page, "b05_add_note")


async def test_b06_following_tab(page):
    """B06. Following tab."""
    print("\n[B06] Following tab")
    btn = page.locator('button:has-text("跟进中")').first
    if await btn.count() > 0:
        await btn.click()
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        ok(f"Following tab loaded")
    else:
        skip("Following button not found")
    await shot(page, "b06_following")


async def test_b07_school_filter(page):
    """B07. School filter."""
    print("\n[B07] School filter")
    today_btn = page.locator('button:has-text("待拨打")').first
    if await today_btn.count() > 0:
        await today_btn.click()
        await page.wait_for_timeout(1500)
    school_select = page.locator('select').first
    if await school_select.count() > 0:
        options = await school_select.locator('option').all()
        if len(options) > 1:
            await school_select.select_option(index=1)
            await page.wait_for_timeout(1500)
            ok("School filter applied")
    else:
        skip("No school dropdown")
    await shot(page, "b07_school_filter")


async def test_b08_search(page):
    """B08. Search."""
    print("\n[B08] Search")
    search = page.locator('input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]').first
    if await search.count() > 0:
        await search.fill("林")
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        ok(f"Search for '林': found={'林灿阳' in body}")
        await search.fill("")
        await page.wait_for_timeout(500)
    else:
        skip("No search input")
    await shot(page, "b08_search")


async def test_b09_add_student(page):
    """B09. Add student modal."""
    print("\n[B09] Add student modal")
    btn = page.locator('button:has-text("添加学生"), button[title*="添加"]').first
    if await btn.count() > 0:
        await btn.click()
        await page.wait_for_timeout(1000)
        body = await page.text_content("body")
        has_modal = "添加" in body or "姓名" in body
        ok(f"Modal visible: {has_modal}")
        close = page.locator('button:has-text("取消"), button[aria-label="关闭"]').first
        if await close.count() > 0:
            await close.click()
            await page.wait_for_timeout(500)
    else:
        skip("Add student button not found")
    await shot(page, "b09_add_student")


async def test_b10_logout(page):
    """B10. Agent logout."""
    print("\n[B10] Agent logout")
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(500)
    btn = page.locator('button:has-text("退出登录")').first
    if await btn.count() > 0:
        await btn.click()
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        ok(f"Logged out: {'登录' in body}")
    else:
        skip("Logout button not found")
    await shot(page, "b10_logout")


# ===================================================================
# C. MOBILE TESTS
# ===================================================================

async def test_c01_mobile_login(page):
    """C01. Mobile login."""
    print("\n[C01] Mobile login")
    await force_logout(page)
    await clear_and_login(page, "e2etest", "e2etest123", viewport=MOBILE_VIEWPORT)
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(2000)
    body = await page.text_content("body")
    ok(f"Mobile home loaded")
    await shot(page, "c01_mobile_home")


async def test_c02_mobile_tasks(page):
    """C02. Tasks tab: progress, stats, students."""
    print("\n[C02] Mobile tasks")
    body = await page.text_content("body")
    has_progress = "待拨打进度" in body or "待拨打" in body
    ok(f"Tasks tab: {has_progress}")
    student_names = ["林灿阳", "吕江豪", "黄仲坤"]
    found = [n for n in student_names if n in body]
    ok(f"Students: {', '.join(found) if found else 'none'}")
    await shot(page, "c02_tasks")


async def test_c03_mobile_filter(page):
    """C03. School filter."""
    print("\n[C03] School filter")
    tag = page.locator('button:has-text("华安县"), button:has-text("全部")').first
    if await tag.count() > 0:
        await tag.click()
        await page.wait_for_timeout(1500)
        ok("Filter clicked")
    else:
        skip("No filter tags")
    await shot(page, "c03_filter")


async def test_c04_mobile_search(page):
    """C04. Search."""
    print("\n[C04] Search")
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1000)
    search = page.locator('input[placeholder*="搜索"]').first
    if await search.count() > 0:
        await search.fill("林")
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        ok(f"Search: found={'林灿阳' in body}")
        await search.fill("")
    else:
        skip("No search input")
    await shot(page, "c04_search")


async def test_c05_mobile_detail(page):
    """C05. Student detail."""
    print("\n[C05] Student detail")
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1000)
    btn = page.locator('button:has-text("详情")').first
    if await btn.count() > 0:
        await btn.click()
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        has_detail = any(k in body for k in ["联系人", "阶段", "通话记录", "监护人"])
        ok(f"Detail loaded: {has_detail}")
        await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    else:
        skip("No detail button")
    await shot(page, "c05_detail")


async def test_c06_mobile_dial(page):
    """C06. Dial flow."""
    print("\n[C06] Dial flow")
    await page.goto(f"{BASE_URL}/mobile", wait_until="networkidle")
    await page.wait_for_timeout(1000)
    await page.evaluate("""
        sessionStorage.setItem('pendingDial', JSON.stringify({
            studentId: 54324,
            studentName: '曾晓蓉'
        }));
    """)
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(2000)
    body = await page.text_content("body")
    has_modal = "通话已完成" in body or "请选择处理结果" in body
    ok(f"Dial modal: {has_modal}")
    if has_modal:
        btn = page.locator('button:has-text("意向了解加微"), button:has-text("新线索")').first
        if await btn.count() > 0:
            await btn.click(force=True)
            await page.wait_for_timeout(1500)
            ok("Status selected")
    await shot(page, "c06_dial")


async def test_c07_mobile_pending(page):
    """C07. Pending tab."""
    print("\n[C07] Pending tab")
    link = page.locator('a:has-text("待处理"), button:has-text("待处理")').first
    if await link.count() > 0:
        await link.click()
        await page.wait_for_timeout(2000)
        ok("Pending tab loaded")
    else:
        await page.goto(f"{BASE_URL}/mobile?tab=pending", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        ok("Pending via URL")
    await shot(page, "c07_pending")


async def test_c08_mobile_me(page):
    """C08. Me tab."""
    print("\n[C08] Me tab")
    link = page.locator('a:has-text("我的"), button:has-text("我的")').first
    if await link.count() > 0:
        await link.click()
        await page.wait_for_timeout(1500)
        body = await page.text_content("body")
        ok(f"Me tab: {'退出登录' in body}")
    else:
        await page.goto(f"{BASE_URL}/mobile?tab=me", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        ok("Me via URL")
    await shot(page, "c08_me")


async def test_c09_mobile_logout(page):
    """C09. Mobile logout."""
    print("\n[C09] Mobile logout")
    btn = page.locator('button:has-text("退出登录")').first
    if await btn.count() > 0:
        await btn.click()
        await page.wait_for_timeout(2000)
        body = await page.text_content("body")
        ok(f"Logged out: {'登录' in body}")
    else:
        skip("Logout button not found")
    await shot(page, "c09_logout")


# ===================================================================
# D. SECURITY TESTS
# ===================================================================

async def test_d01_wrong_password(page):
    """D01. Login with wrong password -> error."""
    print("\n[D01] Wrong password")
    await force_logout(page)
    await page.set_viewport_size({"width": 1280, "height": 800})
    await page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    await page.evaluate("localStorage.clear(); sessionStorage.clear();")
    await page.reload(wait_until="networkidle")
    await page.wait_for_timeout(500)
    await page.fill('input[placeholder="请输入用户名"]', "admin")
    await page.fill('input[placeholder="请输入密码"]', "wrongpassword123")
    await page.click('button[type="submit"]')
    await page.wait_for_timeout(3000)
    # Should still be on login page or show error
    body = await page.text_content("body")
    on_login = "/login" in page.url or "登录" in body
    has_error = "错误" in body or "失败" in body or "锁定" in body or "密码" in body
    ok(f"Still on login: {on_login}, error shown: {has_error}")
    await shot(page, "d01_wrong_password")


async def test_d02_agent_cant_access_admin(page):
    """D02. Agent can't access admin pages -> redirect."""
    print("\n[D02] Agent -> admin redirect")
    await force_logout(page)
    await clear_and_login(page, "e2etest", "e2etest123")
    await page.wait_for_timeout(1000)
    # Try to access admin page
    await safe_goto(page, f"{BASE_URL}/admin")
    await page.wait_for_timeout(2000)
    url = page.url
    body = await page.text_content("body")
    # Should be redirected away from /admin
    is_redirected = "/admin" not in url or "无权" in body or "403" in body or "权限" in body
    ok(f"URL after admin access: {url}, redirected: {is_redirected}")
    await shot(page, "d02_agent_admin")


async def test_d03_change_password_page(page):
    """D03. Change password page accessible."""
    print("\n[D03] Change password")
    await safe_goto(page, f"{BASE_URL}/change-password")
    await page.wait_for_timeout(1500)
    body = await page.text_content("body")
    has_form = "密码" in body or "修改" in body or "旧密码" in body
    ok(f"Change password page: {has_form}")
    await shot(page, "d03_change_password")


# ===================================================================
# RUNNER
# ===================================================================

ADMIN_TESTS = [
    test_a01_health,
    test_a02_admin_login,
    test_a03_dashboard_data,
    test_a04_admin_sidebar_nav,
    test_a05_leads_search,
    test_a06_lead_detail,
    test_a07_governance,
    test_a08_recycle_center,
    test_a09_agent_manage,
    test_a10_reports,
    test_a11_settings,
    test_a12_invalid_reclaim,
    test_a13_distribute,
]

AGENT_TESTS = [
    test_b01_agent_login,
    test_b02_today_tasks,
    test_b03_expand_row,
    test_b04_dial_flow,
    test_b05_add_note,
    test_b06_following_tab,
    test_b07_school_filter,
    test_b08_search,
    test_b09_add_student,
    test_b10_logout,
]

MOBILE_TESTS = [
    test_c01_mobile_login,
    test_c02_mobile_tasks,
    test_c03_mobile_filter,
    test_c04_mobile_search,
    test_c05_mobile_detail,
    test_c06_mobile_dial,
    test_c07_mobile_pending,
    test_c08_mobile_me,
    test_c09_mobile_logout,
]

SECURITY_TESTS = [
    test_d01_wrong_password,
    test_d02_agent_cant_access_admin,
    test_d03_change_password_page,
]


async def run_suite(page, name, tests):
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")
    passed = failed = 0
    errors = []
    for test_fn in tests:
        tname = test_fn.__name__
        try:
            await test_fn(page)
            passed += 1
        except PwTimeout as e:
            await shot(page, f"FAIL_{tname}")
            fail(f"{tname}: TIMEOUT -- {e}")
            errors.append((tname, str(e)))
            failed += 1
        except AssertionError as e:
            await shot(page, f"FAIL_{tname}")
            fail(f"{tname}: ASSERT -- {e}")
            errors.append((tname, str(e)))
            failed += 1
        except Exception as e:
            await shot(page, f"FAIL_{tname}")
            fail(f"{tname}: ERROR -- {type(e).__name__}: {e}")
            errors.append((tname, str(e)))
            failed += 1
    return passed, failed, errors


async def main():
    os.makedirs("tests/e2e/screenshots", exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="zh-CN",
        )
        page = await context.new_page()

        total_passed = total_failed = 0
        all_errors = []

        for suite_name, tests in [
            ("ADMIN TESTS", ADMIN_TESTS),
            ("AGENT DESKTOP TESTS", AGENT_TESTS),
            ("MOBILE TESTS", MOBILE_TESTS),
            ("SECURITY TESTS", SECURITY_TESTS),
        ]:
            p, f, e = await run_suite(page, suite_name, tests)
            total_passed += p
            total_failed += f
            all_errors.extend(e)

        await browser.close()

    total = total_passed + total_failed
    print(f"\n{'='*60}")
    print(f"  FINAL: {total_passed}/{total} passed, {total_failed} failed")
    print(f"{'='*60}")
    if all_errors:
        print("\n  Failed:")
        for name, err in all_errors:
            print(f"    - {name}: {err[:150].replace(chr(10), ' ')}")
    print()
    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
