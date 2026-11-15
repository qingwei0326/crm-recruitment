from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import HashedAssetFiles


def test_hashed_assets_are_cached_for_a_long_time(tmp_path):
    (tmp_path / "index-abc123.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/assets", HashedAssetFiles(directory=tmp_path), name="assets")
    client = TestClient(app)

    found = client.get("/assets/index-abc123.js")
    assert found.status_code == 200
    assert found.headers["cache-control"] == "public, max-age=31536000, immutable"

    # A missing file must not be cached, or a browser would keep the 404 after a release.
    missing = client.get("/assets/index-gone.js")
    assert missing.status_code == 404
    assert "immutable" not in missing.headers.get("cache-control", "")
