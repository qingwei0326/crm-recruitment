"""Verify the exact file set and checksums of a prepared production release."""

from __future__ import annotations

import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})  (.+)$")
VERSION_RE = re.compile(r"^[A-Za-z0-9._-]+$")
REVISION_RE = re.compile(r"^[A-Za-z0-9_]+$")
METADATA_FILES = {"SHA256SUMS", "PACKAGE-SHA256SUMS", "release-manifest.json"}
REQUIRED_PAYLOAD_FILES = {
    "alembic.ini",
    "alembic/env.py",
    "alembic/script.py.mako",
    "app/main.py",
    "app/database.py",
    "frontend/dist/index.html",
    "requirements.txt",
    "logging.json",
    "data/school_regions.json",
    "scripts/repair_work_item_owners.py",
    "scripts/sqlite_online_backup.py",
    "scripts/verify_production_release.py",
}
SCHEMA_GUARD_FILES = {
    "app/config.py",
    "app/database.py",
    "app/domain_models.py",
    "app/legacy_schema_compat.py",
    "app/main.py",
    "app/migration_config.py",
    "app/models.py",
}
FRONTEND_REFERENCE_EXTENSIONS = (
    "css",
    "gif",
    "ico",
    "jpeg",
    "jpg",
    "js",
    "json",
    "map",
    "png",
    "svg",
    "wasm",
    "webp",
    "woff",
    "woff2",
)
QUOTED_FRONTEND_REFERENCE_RE = re.compile(
    rf'''["'`](?P<reference>(?:/[A-Za-z0-9._~/-]+|assets/[^"'`?#]+|\./[^"'`?#]+)\.'''
    rf'''(?:{'|'.join(FRONTEND_REFERENCE_EXTENSIONS)}))(?:[?#][^"'`]*)?["'`]''',
    re.IGNORECASE,
)
CSS_URL_REFERENCE_RE = re.compile(
    rf'''url\(\s*["']?(?P<reference>[^)"'?#]+\.'''
    rf'''(?:{'|'.join(FRONTEND_REFERENCE_EXTENSIONS)}))(?:[?#][^)"']*)?["']?\s*\)''',
    re.IGNORECASE,
)
JS_CODE_REFERENCE_RE = re.compile(
    rf'''(?:\bimport\s*\(\s*|\bimport\s+|\bfrom\s+|\bnew\s+URL\s*\(\s*)'''
    rf'''["'`](?P<reference>[^"'`?#]+\.(?:{'|'.join(FRONTEND_REFERENCE_EXTENSIONS)}))'''
    rf'''(?:[?#][^"'`]*)?["'`]''',
    re.IGNORECASE,
)
CSS_IMPORT_REFERENCE_RE = re.compile(
    rf'''@import\s+["'](?P<reference>[^"'?#]+\.(?:{'|'.join(FRONTEND_REFERENCE_EXTENSIONS)}))'''
    rf'''(?:[?#][^"']*)?["']''',
    re.IGNORECASE,
)


class FrontendIndexParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del tag
        attributes = dict(attrs)
        for attribute in ("src", "href"):
            reference = attributes.get(attribute)
            if reference:
                self.references.append(reference)


def _frontend_reference_path(reference: str, source: Path) -> Path | None:
    clean = reference.split("#", 1)[0].split("?", 1)[0]
    if not clean or clean.startswith(("data:", "http://", "https://", "//")):
        return None
    if clean.startswith("/"):
        relative = Path("frontend/dist") / clean.lstrip("/")
    elif clean.startswith("assets/"):
        relative = Path("frontend/dist") / clean
    elif clean.startswith("./"):
        relative = source.parent / clean[2:]
    else:
        relative = source.parent / clean
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"unsafe frontend asset reference in {source.as_posix()}: {reference}")
    return relative


def verify_frontend_asset_graph(root: Path) -> set[str]:
    index_relative = Path("frontend/dist/index.html")
    index_path = root / index_relative
    parser = FrontendIndexParser()
    parser.feed(index_path.read_text(encoding="utf-8"))

    entry_paths = [
        path
        for reference in parser.references
        if (path := _frontend_reference_path(reference, index_relative)) is not None
    ]
    if not any(path.suffix.lower() == ".js" for path in entry_paths):
        raise ValueError("frontend index.html must reference a JavaScript entry asset")
    if not any(path.suffix.lower() == ".css" for path in entry_paths):
        raise ValueError("frontend index.html must reference a CSS entry asset")

    pending = list(entry_paths)
    visited: set[Path] = set()
    while pending:
        relative = pending.pop()
        if relative in visited:
            continue
        path = root / relative
        if not path.is_file():
            raise ValueError(f"frontend asset reference is missing: {relative.as_posix()}")
        visited.add(relative)
        if path.suffix.lower() not in {".js", ".css"}:
            continue
        text = path.read_text(encoding="utf-8")
        matches = [*QUOTED_FRONTEND_REFERENCE_RE.finditer(text)]
        if path.suffix.lower() == ".js":
            matches.extend(JS_CODE_REFERENCE_RE.finditer(text))
        if path.suffix.lower() == ".css":
            matches.extend(CSS_URL_REFERENCE_RE.finditer(text))
            matches.extend(CSS_IMPORT_REFERENCE_RE.finditer(text))
        for match in matches:
            child = _frontend_reference_path(match.group("reference"), relative)
            if child is not None and child not in visited:
                pending.append(child)

    return {path.as_posix() for path in visited}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_checksums(path: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="ascii").splitlines(), start=1):
        match = CHECKSUM_RE.fullmatch(line)
        if not match:
            raise ValueError(f"invalid checksum line {line_number} in {path.name}")
        digest, relative = match.groups()
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts or relative == ".":
            raise ValueError(f"unsafe checksum path: {relative}")
        normalized = relative_path.as_posix()
        if normalized in checksums:
            raise ValueError(f"duplicate checksum path: {normalized}")
        checksums[normalized] = digest
    return checksums


def release_files(root: Path) -> set[str]:
    files: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"release must not contain symlinks: {path.relative_to(root)}")
        if path.is_file():
            files.add(path.relative_to(root).as_posix())
    return files


def verify_hashes(root: Path, checksums: dict[str, str]) -> None:
    for relative, expected in checksums.items():
        path = root / relative
        if not path.is_file():
            raise ValueError(f"checksummed file is missing: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            raise ValueError(f"checksum mismatch: {relative}")


def verify_production_release(root: Path) -> dict[str, object]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"release directory does not exist: {root}")
    for name in METADATA_FILES:
        if not (root / name).is_file():
            raise ValueError(f"release metadata is missing: {name}")

    payload_checksums = parse_checksums(root / "SHA256SUMS")
    package_checksums = parse_checksums(root / "PACKAGE-SHA256SUMS")
    if set(package_checksums) != {"SHA256SUMS", "release-manifest.json"}:
        raise ValueError("PACKAGE-SHA256SUMS must cover SHA256SUMS and release-manifest.json")

    actual_files = release_files(root)
    expected_files = set(payload_checksums) | METADATA_FILES
    unexpected = sorted(actual_files - expected_files)
    missing = sorted(expected_files - actual_files)
    if unexpected or missing:
        raise ValueError(f"release file set mismatch: unexpected={unexpected}, missing={missing}")

    verify_hashes(root, payload_checksums)
    verify_hashes(root, package_checksums)
    verified_frontend_graph = verify_frontend_asset_graph(root)

    missing_required = sorted(REQUIRED_PAYLOAD_FILES - set(payload_checksums))
    if missing_required:
        raise ValueError(f"required runtime files are missing: {missing_required}")
    frontend_assets = {
        path for path in payload_checksums if path.startswith("frontend/dist/assets/")
    }
    unsafe_frontend_paths = sorted(
        path
        for path in payload_checksums
        if path.startswith("frontend/dist/")
        and not re.fullmatch(r"frontend/dist/[A-Za-z0-9._/-]+", path)
    )
    if unsafe_frontend_paths:
        raise ValueError(
            "frontend file paths must be URL-safe: "
            f"{unsafe_frontend_paths}"
        )
    if not any(path.endswith(".js") for path in frontend_assets):
        raise ValueError("frontend JavaScript assets are missing")
    if not any(path.endswith(".css") for path in frontend_assets):
        raise ValueError("frontend CSS assets are missing")

    forbidden = []
    for path in sorted(actual_files):
        name = Path(path).name.lower()
        if (
            name in {"crm.db", ".env", ".secret_key"}
            or re.search(r"\.db(?:$|-)", name)
            or re.search(r"\.log(?:$|\.)", name)
            or re.search(r"\.pid(?:$|\.)", name)
        ):
            forbidden.append(path)
    if forbidden:
        raise ValueError(f"forbidden runtime files found: {forbidden}")

    manifest = json.loads((root / "release-manifest.json").read_text(encoding="utf-8-sig"))
    version = str(manifest.get("version", ""))
    if not VERSION_RE.fullmatch(version):
        raise ValueError("manifest contains an invalid release version")
    if not manifest.get("expected_database_revision"):
        raise ValueError("manifest does not declare expected_database_revision")
    expected_database_revision = str(manifest["expected_database_revision"])
    database_upgrade_from_revision = str(
        manifest.get("database_upgrade_from_revision", "")
    )
    if not REVISION_RE.fullmatch(expected_database_revision):
        raise ValueError("manifest contains an invalid expected_database_revision")
    if not REVISION_RE.fullmatch(database_upgrade_from_revision):
        raise ValueError("manifest contains an invalid database_upgrade_from_revision")

    version_files = {
        Path(path).name
        for path in payload_checksums
        if path.startswith("alembic/versions/") and path.endswith(".py")
    }
    for revision in (database_upgrade_from_revision, expected_database_revision):
        matches = [name for name in version_files if name.startswith(f"{revision}_")]
        if len(matches) != 1:
            raise ValueError(
                f"release must contain exactly one Alembic migration for {revision}"
            )

    manifest_items = manifest.get("files", [])
    manifest_paths = [str(item.get("path", "")) for item in manifest_items]
    if len(manifest_paths) != len(set(manifest_paths)):
        raise ValueError("duplicate manifest file path")
    manifest_files = {
        str(item.get("path", "")): {
            "bytes": int(item.get("bytes", -1)),
            "sha256": str(item.get("sha256", "")),
        }
        for item in manifest_items
    }
    expected_manifest_files = {
        relative: {
            "bytes": (root / relative).stat().st_size,
            "sha256": digest,
        }
        for relative, digest in payload_checksums.items()
    }
    if manifest_files != expected_manifest_files:
        raise ValueError("manifest file inventory does not match SHA256SUMS")
    if int(manifest.get("runtime_file_count", -1)) != len(payload_checksums):
        raise ValueError("manifest runtime_file_count is incorrect")
    expected_bytes = sum(item["bytes"] for item in expected_manifest_files.values())
    if int(manifest.get("runtime_bytes", -1)) != expected_bytes:
        raise ValueError("manifest runtime_bytes is incorrect")
    if manifest.get("requirements_sha256") != payload_checksums["requirements.txt"]:
        raise ValueError("manifest requirements_sha256 is incorrect")
    schema_guard_items = manifest.get("schema_guard_files", [])
    schema_guard_paths = [str(item.get("path", "")) for item in schema_guard_items]
    if len(schema_guard_paths) != len(set(schema_guard_paths)):
        raise ValueError("duplicate schema guard file path")
    schema_guard_files = {
        str(item.get("path", "")): str(item.get("sha256", ""))
        for item in schema_guard_items
    }
    expected_schema_guards = {
        path: payload_checksums[path]
        for path in SCHEMA_GUARD_FILES
    }
    if schema_guard_files != expected_schema_guards:
        raise ValueError("manifest schema_guard_files are incorrect")

    return {
        "version": version,
        "database_upgrade_from_revision": database_upgrade_from_revision,
        "expected_database_revision": expected_database_revision,
        "runtime_file_count": len(payload_checksums),
        "runtime_bytes": expected_bytes,
        "verified_frontend_asset_count": len(verified_frontend_graph),
        "package_checksums_sha256": sha256_file(root / "PACKAGE-SHA256SUMS"),
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release_dir", type=Path)
    args = parser.parse_args()
    result = verify_production_release(args.release_dir)
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
