import hashlib
import json
from pathlib import Path

import pytest

from scripts.verify_production_release import verify_production_release

PAYLOAD = {
    "alembic.ini": b"[alembic]",
    "alembic/env.py": b"env",
    "alembic/script.py.mako": b"template",
    "alembic/versions/20260711_03_backfill_domain_core.py": b"base migration",
    "alembic/versions/20260714_01_assistant_core.py": b"assistant migration",
    "alembic/versions/20260726_01_personal_groups.py": b"personal groups migration",
    "app/config.py": b"config",
    "app/main.py": b"app",
    "app/database.py": b"database",
    "app/domain_models.py": b"domain models",
    "app/legacy_schema_compat.py": b"compat",
    "app/migration_config.py": b"migration config",
    "app/models.py": b"models",
    "frontend/dist/index.html": (
        b"<link rel='manifest' href='/manifest.json'>"
        b"<link rel='icon' href='/icons/icon.svg'>"
        b"<link rel='stylesheet preload' href='/assets/app.css'>"
        b"<script type='module' src='/assets/app.js'></script>"
    ),
    "frontend/dist/manifest.json": b"{}",
    "frontend/dist/icons/icon.svg": b"<svg></svg>",
    "frontend/dist/assets/app.js": b"javascript",
    "frontend/dist/assets/app.css": b"css",
    "requirements.txt": b"fastapi==1\n",
    "logging.json": b"{}",
    "data/school_regions.json": b"{}",
    "scripts/repair_work_item_owners.py": b"repair",
    "scripts/sqlite_online_backup.py": b"backup",
    "scripts/verify_production_release.py": b"verify",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare_release(root):
    entries = []
    for relative, content in PAYLOAD.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        entries.append({"path": relative, "bytes": len(content), "sha256": digest(content)})

    checksum_text = "".join(f"{item['sha256']}  {item['path']}\n" for item in entries)
    (root / "SHA256SUMS").write_text(checksum_text, encoding="ascii")
    manifest = {
        "version": "test-release",
        "database_upgrade_from_revision": "20260714_01",
        "expected_database_revision": "20260726_01",
        "runtime_file_count": len(entries),
        "runtime_bytes": sum(item["bytes"] for item in entries),
        "requirements_sha256": next(
            item["sha256"] for item in entries if item["path"] == "requirements.txt"
        ),
        "schema_guard_files": [
            {"path": item["path"], "sha256": item["sha256"]}
            for item in entries
            if item["path"]
            in {
                "app/config.py",
                "app/database.py",
                "app/domain_models.py",
                "app/legacy_schema_compat.py",
                "app/main.py",
                "app/migration_config.py",
                "app/models.py",
            }
        ],
        "files": entries,
    }
    (root / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    package_entries = {
        "SHA256SUMS": digest((root / "SHA256SUMS").read_bytes()),
        "release-manifest.json": digest((root / "release-manifest.json").read_bytes()),
    }
    (root / "PACKAGE-SHA256SUMS").write_text(
        "".join(f"{value}  {name}\n" for name, value in package_entries.items()),
        encoding="ascii",
    )


def replace_payload(root, relative, content):
    """Replace one checksummed payload file and refresh release metadata."""
    path = root / relative
    path.write_bytes(content)

    checksum_path = root / "SHA256SUMS"
    checksum_entries = []
    for line in checksum_path.read_text(encoding="ascii").splitlines():
        current_digest, current_relative = line.split("  ", 1)
        if current_relative == relative:
            current_digest = digest(content)
        checksum_entries.append((current_relative, current_digest))
    checksum_path.write_text(
        "".join(f"{value}  {name}\n" for name, value in checksum_entries),
        encoding="ascii",
    )

    manifest_path = root / "release-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["files"]:
        if item["path"] == relative:
            item["bytes"] = len(content)
            item["sha256"] = digest(content)
            break
    manifest["runtime_bytes"] = sum(item["bytes"] for item in manifest["files"])
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    (root / "PACKAGE-SHA256SUMS").write_text(
        "".join(
            [
                f"{digest(checksum_path.read_bytes())}  SHA256SUMS\n",
                f"{digest(manifest_path.read_bytes())}  release-manifest.json\n",
            ]
        ),
        encoding="ascii",
    )


def test_prepare_production_release_always_rebuilds_frontend():
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "prepare-production-release.ps1"
    ).read_text(encoding="utf-8-sig")

    assert "SkipBuild" not in script
    assert "& npm run build" in script


def test_verify_production_release_accepts_exact_valid_package(tmp_path):
    prepare_release(tmp_path)

    result = verify_production_release(tmp_path)

    assert result["version"] == "test-release"
    assert result["runtime_file_count"] == len(PAYLOAD)


def test_verify_production_release_rejects_an_unlisted_file(tmp_path):
    prepare_release(tmp_path)
    (tmp_path / "app" / "injected.py").write_text("unexpected", encoding="utf-8")

    with pytest.raises(ValueError, match="unexpected=.*app/injected.py"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_modified_manifest(tmp_path):
    prepare_release(tmp_path)
    manifest_path = tmp_path / "release-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "changed"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="checksum mismatch: release-manifest.json"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_duplicate_manifest_file_entry(tmp_path):
    prepare_release(tmp_path)
    manifest_path = tmp_path / "release-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"].append(dict(manifest["files"][0]))
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "PACKAGE-SHA256SUMS").write_text(
        "".join(
            [
                f"{digest((tmp_path / 'SHA256SUMS').read_bytes())}  SHA256SUMS\n",
                f"{digest(manifest_path.read_bytes())}  release-manifest.json\n",
            ]
        ),
        encoding="ascii",
    )

    with pytest.raises(ValueError, match="duplicate manifest file path"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_frontend_asset(tmp_path):
    prepare_release(tmp_path)
    css_path = tmp_path / "frontend" / "dist" / "assets" / "app.css"
    css_path.unlink()

    with pytest.raises(ValueError, match="missing=.*app.css"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_index_without_a_stylesheet(tmp_path):
    prepare_release(tmp_path)
    replace_payload(
        tmp_path,
        "frontend/dist/index.html",
        b"<script type='module' src='/assets/app.js'></script>",
    )

    with pytest.raises(ValueError, match="index.html must reference.*CSS"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_dynamic_frontend_chunk(tmp_path):
    prepare_release(tmp_path)
    replace_payload(
        tmp_path,
        "frontend/dist/assets/app.js",
        b'import("./StudentDetail-missing.js");',
    )

    with pytest.raises(
        ValueError,
        match="frontend asset reference is missing.*StudentDetail-missing.js",
    ):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_bare_dynamic_chunk(tmp_path):
    prepare_release(tmp_path)
    replace_payload(
        tmp_path,
        "frontend/dist/assets/app.js",
        b'import("StudentDetail-missing.js");',
    )

    with pytest.raises(
        ValueError,
        match="frontend asset reference is missing.*StudentDetail-missing.js",
    ):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_new_url_asset(tmp_path):
    prepare_release(tmp_path)
    replace_payload(
        tmp_path,
        "frontend/dist/assets/app.js",
        b'new URL("image-missing.png", import.meta.url);',
    )

    with pytest.raises(
        ValueError,
        match="frontend asset reference is missing.*image-missing.png",
    ):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_css_url_asset(tmp_path):
    prepare_release(tmp_path)
    replace_payload(
        tmp_path,
        "frontend/dist/assets/app.css",
        b"body{background-image:url('/icons/missing.png')}",
    )

    with pytest.raises(
        ValueError,
        match="frontend asset reference is missing.*icons/missing.png",
    ):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_target_migration(tmp_path):
    prepare_release(tmp_path)
    migration = (
        tmp_path / "alembic" / "versions" / "20260726_01_personal_groups.py"
    )
    migration.unlink()

    with pytest.raises(ValueError, match="missing=.*20260726_01_personal_groups.py"):
        verify_production_release(tmp_path)


def test_verify_production_release_rejects_missing_upgrade_base(tmp_path):
    prepare_release(tmp_path)
    manifest_path = tmp_path / "release-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.pop("database_upgrade_from_revision")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    package_path = tmp_path / "PACKAGE-SHA256SUMS"
    package_path.write_text(
        "".join(
            [
                f"{digest((tmp_path / 'SHA256SUMS').read_bytes())}  SHA256SUMS\n",
                f"{digest(manifest_path.read_bytes())}  release-manifest.json\n",
            ]
        ),
        encoding="ascii",
    )

    with pytest.raises(ValueError, match="invalid database_upgrade_from_revision"):
        verify_production_release(tmp_path)
