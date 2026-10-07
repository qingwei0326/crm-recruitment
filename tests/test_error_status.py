"""Business failures return a real HTTP status, not 200 + code=1."""

import json

import pytest

from app.schemas import Response


def test_response_error_defaults_to_400_and_keeps_envelope():
    response = Response.error(msg="手机号已存在")
    assert response.status_code == 400
    assert json.loads(response.body) == {"code": 1, "data": None, "msg": "手机号已存在"}


@pytest.mark.parametrize(("code", "status"), [(1, 400), (404, 404), (409, 409), (0, 400), (7, 400)])
def test_response_error_status_follows_code(code, status):
    assert Response.error(code=code, msg="x").status_code == status


def test_response_error_explicit_status_wins():
    assert Response.error(code=1, msg="x", status_code=422).status_code == 422


@pytest.mark.asyncio
async def test_endpoint_business_failure_is_http_400_without_detail(client, admin_headers):
    response = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "0"},
        headers=admin_headers,
    )
    body = response.json()
    assert response.status_code == 400
    assert body["code"] == 1 and body["msg"]
    # The frontend interceptor tells this envelope apart from HTTPException bodies by `detail`.
    assert "detail" not in body
