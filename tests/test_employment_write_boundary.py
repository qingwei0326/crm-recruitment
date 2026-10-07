import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROUTERS_DIR = PROJECT_ROOT / "app" / "routers"


def _is_user_update(node: ast.AST) -> bool:
    return any(
        isinstance(child, ast.Call)
        and isinstance(child.func, ast.Name)
        and child.func.id == "update"
        and child.args
        and isinstance(child.args[0], ast.Name)
        and child.args[0].id == "User"
        for child in ast.walk(node)
    )


def _scan_router(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    violations: set[tuple[int, str]] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(
                isinstance(target, ast.Attribute) and target.attr == "is_active"
                for target in targets
            ):
                violations.add((node.lineno, "attribute assignment"))

        if not isinstance(node, ast.Call):
            continue
        if (
            isinstance(node.func, ast.Name)
            and node.func.id == "setattr"
            and len(node.args) >= 2
            and isinstance(node.args[1], ast.Constant)
            and node.args[1].value == "is_active"
        ):
            violations.add((node.lineno, "setattr"))
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "values"
            and _is_user_update(node.func.value)
            and any(keyword.arg == "is_active" for keyword in node.keywords)
        ):
            violations.add((node.lineno, "User bulk update"))

    relative_path = path.relative_to(PROJECT_ROOT).as_posix()
    return [
        f"{relative_path}:{line}: direct is_active via {kind}" for line, kind in sorted(violations)
    ]


def test_routers_do_not_write_user_active_projection_directly():
    violations = [
        violation for path in sorted(ROUTERS_DIR.glob("*.py")) for violation in _scan_router(path)
    ]

    assert not violations, "\n" + "\n".join(violations)
