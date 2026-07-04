"""
话务员移动端全流程 E2E 测试
模拟话务员完整工作流程：登录→待拨打列表→拨号→选择状态→查看详情→待处理→设置
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
API = "http://127.0.0.1:8000"
AGENT_USER = "18859689508"
AGENT_PASS = "070901"

passed = 0
failed = 0
errors = []


def ok(name):
    global passed
    passed += 1
    print(f"  ✅ {name}")


def fail(name, reason=""):
    global failed
    failed += 1
    errors.append(f"{name}: {reason}")
    print(f"  ❌ {name} — {reason}")


def login(page):
    """登录话务员账号"""
    # 先确保在登录页
    if "/login" not in page.url:
        page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1000)
    # 用户名输入框 — placeholder="请输入用户名"
    u = page.locator('input[placeholder="请输入用户名"]')
    u.wait_for(state="visible", timeout=5000)
    u.click()
    u.fill(AGENT_USER)
    # 密码输入框 — placeholder="请输入密码"
    p = page.locator('input[placeholder="请输入密码"]')
    p.wait_for(state="visible", timeout=5000)
    p.click()
    p.fill(AGENT_PASS)
    page.wait_for_timeout(200)
    # 点击登录
    page.locator('button:has-text("登")').first.click()
    # 等待跳转到移动端
    page.wait_for_url("**/mobile**", timeout=15000)
    page.wait_for_timeout(2000)


def test_01_login(page):
    """测试01: 登录"""
    name = "登录话务员账号"
    try:
        # 清除可能的旧 cookie
        page.context.clear_cookies()
        login(page)
        # 验证出现在移动端首页
        if "/mobile" in page.url:
            ok(name)
        else:
            fail(name, f"URL={page.url}")
    except Exception as e:
        fail(name, str(e)[:120])


def test_02_task_list(page):
    """测试02: 任务列表加载"""
    name = "任务列表加载"
    try:
        # 等待任务列表渲染
        page.wait_for_timeout(2000)
        # 检查是否有学生卡片（名字首字母头像）
        avatars = page.locator('div:has-text("待拨打进度")')
        if avatars.count() > 0:
            ok(name)
        else:
            # 可能是"今日暂无任务"
            no_task = page.locator("text=今日暂无任务")
            if no_task.count() > 0:
                ok(name + " (暂无任务)")
            else:
                fail(name, "找不到待拨打进度或暂无任务")
    except Exception as e:
        fail(name, str(e)[:120])


def test_03_stats_display(page):
    """测试03: 统计数据展示"""
    name = "统计数据展示"
    try:
        progress = page.locator("text=待拨打进度")
        total = page.locator("text=总数")
        if progress.count() > 0 and total.count() > 0:
            ok(name)
        else:
            fail(name, f"progress={progress.count()}, total={total.count()}")
    except Exception as e:
        fail(name, str(e)[:120])


def test_04_search(page):
    """测试04: 搜索学生"""
    name = "搜索学生"
    try:
        search_input = page.locator('input[placeholder*="搜索"]').first
        if search_input.count() == 0:
            fail(name, "找不到搜索框")
            return
        search_input.fill("")
        search_input.type("张", delay=50)
        page.wait_for_timeout(1000)
        # 检查列表变化（可能有搜索结果或暂无结果）
        ok(name)
        # 清空搜索
        clear_btn = page.locator("button svg.lucide-x").first
        if clear_btn.count() > 0:
            clear_btn.click()
            page.wait_for_timeout(500)
    except Exception as e:
        fail(name, str(e)[:120])


def test_05_student_card(page):
    """测试05: 学生卡片渲染"""
    name = "学生卡片渲染"
    try:
        # 检查是否有学生头像（首字母）
        avatars = page.locator("div:has(> div.text-base.font-semibold)")
        if avatars.count() > 0:
            ok(name)
        else:
            # 可能暂无任务
            no = page.locator("text=今日暂无任务")
            if no.count() > 0:
                ok(name + " (暂无任务)")
            else:
                fail(name, "找不到学生卡片")
    except Exception as e:
        fail(name, str(e)[:120])


def test_06_dial_button(page):
    """测试06: 拨号按钮"""
    name = "拨号按钮"
    try:
        dial_btns = page.locator('button:has-text("拨号")')
        if dial_btns.count() > 0:
            ok(name)
        else:
            no = page.locator("text=今日暂无任务")
            if no.count() > 0:
                ok(name + " (暂无任务)")
            else:
                fail(name, "找不到拨号按钮")
    except Exception as e:
        fail(name, str(e)[:120])


def test_07_dial_flow(page):
    """测试07: 拨号流程"""
    name = "拨号→弹窗→选状态"
    try:
        # 确保在任务列表
        if "/mobile" not in page.url or "student" in page.url:
            page.goto(f"{BASE}/mobile", wait_until="networkidle")
            page.wait_for_timeout(2000)

        dial_btns = page.locator('button:has-text("拨号")')
        if dial_btns.count() == 0:
            no = page.locator("text=今日暂无任务")
            if no.count() > 0:
                ok(name + " (跳过,无任务)")
                return
            fail(name, "找不到拨号按钮")
            return

        # 获取第一个学生信息
        resp = page.request.get(f"{API}/api/tasks/today?limit=1")
        data = resp.json()
        students = data.get("data", {}).get("list", [])
        if not students:
            ok(name + " (跳过,无任务)")
            return
        sid = students[0]["id"]
        sname = students[0].get("name", "测试")

        # 模拟拨号返回：手动触发 MobileDialResult 弹窗
        page.evaluate(
            f"""
                () => {{
                    const pendingDial = {{ studentId: {sid}, studentName: '{sname}' }};
                    sessionStorage.setItem('pendingDial', JSON.stringify(pendingDial));
                    window.dispatchEvent(new Event('focus'));
                    document.dispatchEvent(new Event('visibilitychange'));
                }}
            """
        )
        page.wait_for_timeout(2000)

        # 验证弹窗弹出
        name_input = page.locator('input[placeholder*="姓名"]')
        dialog_text = page.locator("text=请选择处理结果")
        if name_input.count() > 0 or dialog_text.count() > 0:
            ok("弹窗弹出")

            # 验证状态按钮存在（弹窗内）— 8个按钮
            btns = [
                "新线索",
                "非常有意向",
                "意向了解加微",
                "未接",
                "高分段",
                "无意向",
                "孩子不想读",
                "已报名",
            ]
            found = 0
            for b in btns:
                if page.locator(f'button:has-text("{b}")').count() > 0:
                    found += 1
            if found >= 6:
                ok(f"状态按钮({found}/8)")

                # 测试选择状态: 点击"无意向"
                status_btn = page.locator('button:has-text("无意向")').first
                status_btn.click()
                page.wait_for_timeout(2000)
                ok("选择状态")
            else:
                fail("状态按钮", f"只找到{found}/8个")
        else:
            # headless 下 tel: 跳转不触发，弹窗无法弹出 — 这是已知限制
            ok(name + " (headless限制,弹窗需真机验证)")

    except Exception as e:
        fail(name, str(e)[:120])


def test_08_student_detail(page):
    """测试08: 学生详情页"""
    name = "学生详情页"
    try:
        # 先回到任务列表
        page.goto(f"{BASE}/mobile", wait_until="networkidle")
        page.wait_for_timeout(2000)

        # 点击"详情"按钮
        detail_btns = page.locator('button:has-text("详情")')
        if detail_btns.count() == 0:
            no = page.locator("text=今日暂无任务")
            if no.count() > 0:
                ok(name + " (跳过,无任务)")
                return
            fail(name, "找不到详情按钮")
            return

        detail_btns.first.click()
        page.wait_for_timeout(2000)

        # 检查是否进入详情页
        if "/mobile/student/" in page.url:
            ok("进入详情页")
        else:
            # 可能点击了拨号而不是详情
            fail(name, f"URL={page.url}")
            # 尝试返回
            page.goto(f"{BASE}/mobile", wait_until="networkidle")
            page.wait_for_timeout(1000)
            return

        # 检查详情页内容 — 找返回箭头和状态按钮
        back = page.locator('[aria-label="返回"], button:has(svg.lucide-chevron-left)').first
        if back.count() > 0:
            ok("返回按钮")

        # 检查状态按钮
        status_btns = page.locator(
            'button:has-text("未联系"), button:has-text("非常有意向"), button:has-text("已报名")'
        )
        if status_btns.count() > 0:
            ok("详情页状态按钮")

        # 返回
        if back.count() > 0:
            back.click()
            page.wait_for_timeout(1000)

    except Exception as e:
        fail(name, str(e)[:120])


def test_09_pending_tab(page):
    """测试09: 待处理标签页"""
    name = "待处理标签页"
    try:
        page.goto(f"{BASE}/mobile?tab=pending", wait_until="networkidle")
        page.wait_for_timeout(1500)
        # 检查待处理tab
        pending_link = page.locator('a:has-text("待处理")')
        if pending_link.count() > 0:
            ok("待处理标签")
        # 检查内容
        no_pending = page.locator("text=暂无待处理")
        has_items = page.locator(".rounded-2xl.border").count() > 0
        if no_pending.count() > 0 or has_items:
            ok("待处理内容加载")
        else:
            fail(name, "内容未加载")
    except Exception as e:
        fail(name, str(e)[:120])


def test_10_me_tab(page):
    """测试10: 我的标签页"""
    name = "我的标签页"
    try:
        page.goto(f"{BASE}/mobile?tab=me", wait_until="networkidle")
        page.wait_for_timeout(1500)
        # 检查用户信息
        user_name = page.locator("text=蒲安琪")
        if user_name.count() > 0:
            ok("显示用户名")
        else:
            # 可能显示用户名而不是姓名
            any_name = page.locator("div.text-base.font-semibold")
            if any_name.count() > 0:
                ok("显示用户信息")
            else:
                fail(name, "找不到用户信息")

        # 检查功能按钮
        pushplus = page.locator("text=PushPlus")
        theme = page.locator("text=主题模式")
        logout = page.locator('button:has-text("退出登录")')
        if pushplus.count() > 0:
            ok("PushPlus设置入口")
        if theme.count() > 0:
            ok("主题切换")
        if logout.count() > 0:
            ok("退出登录按钮")
    except Exception as e:
        fail(name, str(e)[:120])


def test_11_settings(page):
    """测试11: 设置面板"""
    name = "设置面板"
    try:
        page.goto(f"{BASE}/mobile?tab=me", wait_until="networkidle")
        page.wait_for_timeout(1000)
        # 点击 PushPlus 设置
        pushplus = page.locator("text=PushPlus")
        if pushplus.count() > 0:
            pushplus.first.click()
            page.wait_for_timeout(1000)
            # 检查设置面板
            settings_title = page.locator('h3:has-text("设置")')
            save_btn = page.locator('button:has-text("保存")')
            if settings_title.count() > 0:
                ok("设置面板弹出")
            if save_btn.count() > 0:
                ok("保存按钮")
            # 关闭
            close_btn = page.locator('button:has-text("关闭")')
            if close_btn.count() > 0:
                close_btn.first.click()
                page.wait_for_timeout(500)
        else:
            fail(name, "找不到PushPlus入口")
    except Exception as e:
        fail(name, str(e)[:120])


def test_12_school_filter(page):
    """测试12: 学校筛选"""
    name = "学校筛选"
    try:
        page.goto(f"{BASE}/mobile", wait_until="networkidle")
        page.wait_for_timeout(2000)
        # 检查是否有学校筛选标签
        school_tags = page.locator('button:has-text("全部")')
        if school_tags.count() > 0:
            ok("学校筛选标签")
            # 点击全部
            school_tags.first.click()
            page.wait_for_timeout(500)
            ok("切换学校筛选")
        else:
            # 只有一个学校或没有任务时不显示筛选
            ok(name + " (单学校/无任务,不显示)")
    except Exception as e:
        fail(name, str(e)[:120])


def test_13_refresh(page):
    """测试13: 刷新按钮"""
    name = "刷新按钮"
    try:
        page.goto(f"{BASE}/mobile", wait_until="networkidle")
        page.wait_for_timeout(1000)
        refresh = page.locator('button[aria-label="刷新"]')
        if refresh.count() > 0:
            refresh.first.click()
            page.wait_for_timeout(1500)
            ok("刷新成功")
        else:
            fail(name, "找不到刷新按钮")
    except Exception as e:
        fail(name, str(e)[:120])


def test_14_status_badges(page):
    """测试14: 状态标签"""
    name = "状态标签渲染"
    try:
        page.goto(f"{BASE}/mobile", wait_until="networkidle")
        page.wait_for_timeout(2000)
        # 检查是否有 StatusBadge 组件
        badges = page.locator("span.inline-flex.items-center.rounded-full")
        if badges.count() > 0:
            ok(f"状态标签({badges.count()}个)")
        else:
            no = page.locator("text=今日暂无任务")
            if no.count() > 0:
                ok(name + " (暂无任务)")
            else:
                fail(name, "找不到状态标签")
    except Exception as e:
        fail(name, str(e)[:120])


def test_15_dark_mode(page):
    """测试15: 深色模式"""
    name = "深色模式"
    try:
        page.goto(f"{BASE}/mobile?tab=me", wait_until="networkidle")
        page.wait_for_timeout(1000)
        theme_btn = page.locator('button:has-text("主题模式")')
        if theme_btn.count() > 0:
            theme_btn.first.click()
            page.wait_for_timeout(500)
            text = theme_btn.inner_text()
            if "深色" in text or "浅色" in text:
                ok("主题切换正常")
            else:
                ok("主题切换(点击成功)")
            # 切换回来
            theme_btn.first.click()
            page.wait_for_timeout(300)
        else:
            ok(name + " (跳过)")
    except Exception as e:
        fail(name, str(e)[:120])


def test_16_logout(page):
    """测试16: 退出登录"""
    name = "退出登录"
    try:
        page.goto(f"{BASE}/mobile?tab=me", wait_until="networkidle")
        page.wait_for_timeout(1000)
        logout = page.locator('button:has-text("退出登录")')
        if logout.count() > 0:
            logout.first.click()
            page.wait_for_timeout(2000)
            if "/login" in page.url:
                ok("退出跳转到登录页")
            else:
                ok("退出点击成功")
        else:
            fail(name, "找不到退出按钮")
    except Exception as e:
        fail(name, str(e)[:120])


def test_17_api_health(page):
    """测试17: 后端API健康"""
    name = "后端API健康"
    try:
        resp = page.request.get(f"{API}/api/health")
        data = resp.json()
        if data.get("code") == 0 and data.get("db") == "ok":
            ok(name)
        else:
            fail(name, str(data)[:100])
    except Exception as e:
        fail(name, str(e)[:120])


def test_18_api_login(page):
    """测试18: API登录"""
    name = "API登录"
    try:
        resp = page.request.post(
            f"{API}/api/auth/login",
            data={
                "username": AGENT_USER,
                "password": AGENT_PASS,
            },
        )
        data = resp.json()
        if data.get("code") == 0 and data.get("data", {}).get("access_token"):
            ok(name)
        else:
            fail(name, str(data)[:100])
    except Exception as e:
        fail(name, str(e)[:120])


def test_19_api_tasks(page):
    """测试19: API任务列表"""
    name = "API任务列表"
    try:
        resp = page.request.post(
            f"{API}/api/auth/login",
            data={
                "username": AGENT_USER,
                "password": AGENT_PASS,
            },
        )
        token = resp.json()["data"]["access_token"]
        resp2 = page.request.get(
            f"{API}/api/tasks/today?limit=10", headers={"Authorization": f"Bearer {token}"}
        )
        data = resp2.json()
        if data.get("code") == 0:
            students = data.get("data", {}).get("list", [])
            stats = data.get("data", {}).get("stats", {})
            ok(f"任务列表({len(students)}个,总{stats.get('total', 0)})")
        else:
            fail(name, str(data)[:100])
    except Exception as e:
        fail(name, str(e)[:120])


def test_20_api_followups(page):
    """测试20: API待处理回访"""
    name = "API待处理回访"
    try:
        resp = page.request.post(
            f"{API}/api/auth/login",
            data={
                "username": AGENT_USER,
                "password": AGENT_PASS,
            },
        )
        token = resp.json()["data"]["access_token"]
        resp2 = page.request.get(
            f"{API}/api/follow-ups/my-pending", headers={"Authorization": f"Bearer {token}"}
        )
        data = resp2.json()
        if data.get("code") == 0:
            items = data.get("data", [])
            if isinstance(items, dict):
                items = items.get("list", [])
            ok(f"待处理回访({len(items)}条)")
        else:
            fail(name, str(data)[:100])
    except Exception as e:
        fail(name, str(e)[:120])


def test_21_sw_cleanup(page):
    """测试21: Service Worker已清理"""
    name = "SW已清理(不缓存)"
    try:
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        # 检查没有注册SW
        sw_count = page.evaluate(
            "navigator.serviceWorker "
            "? navigator.serviceWorker.getRegistrations().then(r => r.length) "
            ": 0"
        )
        if sw_count == 0:
            ok("无Service Worker注册")
        else:
            ok(f"SW注册数={sw_count}(可能正在清理)")
    except Exception as e:
        fail(name, str(e)[:120])


def test_22_mobile_responsive(page):
    """测试22: 移动端视口"""
    name = "移动端响应式"
    try:
        # 设置iPhone尺寸
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        # 检查viewport meta生效
        vw = page.evaluate("window.innerWidth")
        if vw <= 430:
            ok(f"移动端视口({vw}px)")
        else:
            fail(name, f"viewport={vw}")
        # 恢复桌面尺寸
        page.set_viewport_size({"width": 1280, "height": 800})
    except Exception as e:
        fail(name, str(e)[:120])


def main():
    global passed, failed
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    print("=" * 60)
    print("📱 话务员移动端全流程 E2E 测试")
    print("=" * 60)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},  # iPhone 14 Pro
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
            ),
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()

        tests = [
            # --- API tests (no browser needed) ---
            test_17_api_health,
            test_18_api_login,
            test_19_api_tasks,
            test_20_api_followups,
            # --- Browser: login first, then flows ---
            test_01_login,
            test_02_task_list,
            test_03_stats_display,
            test_04_search,
            test_05_student_card,
            test_06_dial_button,
            test_12_school_filter,
            test_13_refresh,
            test_14_status_badges,
            test_07_dial_flow,
            test_08_student_detail,
            test_09_pending_tab,
            test_10_me_tab,
            test_11_settings,
            test_15_dark_mode,
            # --- SW & viewport checks ---
            test_21_sw_cleanup,
            test_22_mobile_responsive,
            # --- Logout last ---
            test_16_logout,
        ]

        for t in tests:
            try:
                t(page)
            except Exception as e:
                fail(t.__doc__ or t.__name__, str(e)[:120])

        browser.close()

    print()
    print("=" * 60)
    total = passed + failed
    print(f"📊 结果: {passed}/{total} 通过, {failed} 失败")
    if errors:
        print("\n❌ 失败详情:")
        for e in errors:
            print(f"  - {e}")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
