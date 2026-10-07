"""Phase 0-1 回归测试：SPA 回退必须阻止路径穿越读取 FRONTEND_DIR 之外的文件。

实测漏洞：app/main.py 的 SPA 回退用 os.path.join(FRONTEND_DIR, path) 拼接，
未做 realpath 归一化，攻击者可借 ``/..%2F..%2F.env`` 读到 SECRET_KEY 并自签 admin JWT。
"""

import os

from app.main import _resolve_spa_path


def test_resolve_spa_path_allows_paths_inside_root(monkeypatch, tmp_path):
    monkeypatch.setattr("app.main.FRONTEND_DIR", str(tmp_path))
    (tmp_path / "index.html").write_text("<html></html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")

    assert _resolve_spa_path("index.html") == os.path.realpath(tmp_path / "index.html")
    assert _resolve_spa_path("assets/app.js") == os.path.realpath(tmp_path / "assets" / "app.js")
    # 根目录本身（SPA 默认回退到 index.html）应被允许
    assert _resolve_spa_path("") == os.path.realpath(str(tmp_path))


def test_resolve_spa_path_blocks_parent_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr("app.main.FRONTEND_DIR", str(tmp_path))
    assert _resolve_spa_path("../secret.txt") is None
    assert _resolve_spa_path("foo/../../etc/passwd") is None
    # 反斜杠只在 Windows 上是路径分隔符；在 Linux（生产环境）上它是普通字符，
    # "..\\..\\.env" 只是根目录内的一个字面文件名，并未越界。
    backslash = _resolve_spa_path("..\\..\\.env")
    if os.sep == "\\":
        assert backslash is None
    else:
        assert backslash is not None
        assert backslash.startswith(os.path.realpath(str(tmp_path)) + os.sep)


def test_resolve_spa_path_blocks_encoded_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr("app.main.FRONTEND_DIR", str(tmp_path))
    # 服务端路由在匹配前已对 %2F 解码为 /，这里直接以解码后的形式断言
    assert _resolve_spa_path("..%2F..%2F.env") is not None  # 字面文件名，留在目录内
    # 解码后等价于 ../ 的越界应被拦截（Starlette 已解码传入）
    assert _resolve_spa_path("../.env") is None
