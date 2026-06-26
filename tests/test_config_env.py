"""Import-reload tests for environment-backed config values."""

import importlib
import sys

import pytest


def _reload_config(monkeypatch, **env):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-not-for-production")
    for key in ("APP_ENV", "CORS_ORIGINS", "ACCESS_TOKEN_EXPIRE_MINUTES"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop("app.config", None)
    return importlib.import_module("app.config")


def test_default_jwt_expiry_is_8_hours(monkeypatch):
    config = _reload_config(monkeypatch)
    assert config.ACCESS_TOKEN_EXPIRE_MINUTES == 480


def test_jwt_expiry_env_override(monkeypatch):
    config = _reload_config(monkeypatch, ACCESS_TOKEN_EXPIRE_MINUTES="30")
    assert config.ACCESS_TOKEN_EXPIRE_MINUTES == 30


def test_dev_cors_defaults_to_localhost_only(monkeypatch):
    config = _reload_config(monkeypatch, APP_ENV="development")
    assert config.CORS_ORIGINS == ["http://localhost:3000", "http://localhost:5173"]


def test_cors_origins_strips_explicit_values(monkeypatch):
    config = _reload_config(
        monkeypatch,
        APP_ENV="production",
        CORS_ORIGINS=" https://crm.example.com, http://localhost:5173 ",
    )
    assert config.CORS_ORIGINS == ["https://crm.example.com", "http://localhost:5173"]


def test_production_requires_explicit_cors_origins(monkeypatch):
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        _reload_config(monkeypatch, APP_ENV="production")
