import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROUTERS_DIR = PROJECT_ROOT / "app" / "routers"
PROJECTION_FIELDS = {"assigned_at", "assigned_to"}


def _attribute_targets(node: ast.AST) -> list[ast.Attribute]:
    if isinstance(node, ast.Attribute):
        return [node]
    if isinstance(node, (ast.List, ast.Tuple)):
        return [attribute for element in node.elts for attribute in _attribute_targets(element)]
    if isinstance(node, ast.Starred):
        return _attribute_targets(node.value)
    return []


def _is_student_update(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        if not isinstance(child.func, ast.Name) or child.func.id != "update":
            continue
        if child.args and isinstance(child.args[0], ast.Name):
            return child.args[0].id == "Student"
    return False


def _projection_keywords(node: ast.Call) -> set[str]:
    return {keyword.arg for keyword in node.keywords if keyword.arg in PROJECTION_FIELDS}


def _scan_router(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    violations: set[tuple[int, str, str]] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                for attribute in _attribute_targets(target):
                    if attribute.attr in PROJECTION_FIELDS:
                        violations.add((node.lineno, attribute.attr, "attribute assignment"))

        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name) and node.func.id == "setattr":
            if (
                len(node.args) >= 2
                and isinstance(node.args[1], ast.Constant)
                and node.args[1].value in PROJECTION_FIELDS
            ):
                violations.add((node.lineno, str(node.args[1].value), "setattr"))

        keywords = _projection_keywords(node)
        if isinstance(node.func, ast.Name) and node.func.id == "Student":
            for field in keywords:
                violations.add((node.lineno, field, "Student constructor"))
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "values"
            and _is_student_update(node.func.value)
        ):
            for field in keywords:
                violations.add((node.lineno, field, "Student bulk update"))

    relative_path = path.relative_to(PROJECT_ROOT).as_posix()
    return [
        f"{relative_path}:{line}: direct {field} via {kind}"
        for line, field, kind in sorted(violations)
    ]


def test_routers_do_not_write_assignment_projections_directly():
    violations = [
        violation for path in sorted(ROUTERS_DIR.glob("*.py")) for violation in _scan_router(path)
    ]

    assert not violations, "\n" + "\n".join(violations)
