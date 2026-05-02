from app.core.config import DocCredentials, Settings


def test_settings_ignore_unrecognized_env_vars(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    monkeypatch.setenv("ENCRYPTION_KEY", "Y8b6j0bJm0Kh3k6oQ1dQ3pbyQYQ5G3g8Jx9Vb0O8kKo=")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-used-by-this-app")

    settings = Settings(_env_file=None)

    assert settings.database_url == "postgresql+asyncpg://user:pass@localhost/db"


def test_legacy_doc_credentials_helper(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    monkeypatch.setenv("ENCRYPTION_KEY", "Y8b6j0bJm0Kh3k6oQ1dQ3pbyQYQ5G3g8Jx9Vb0O8kKo=")
    monkeypatch.setenv("DOC_EMAIL", "demo@example.com")
    monkeypatch.setenv("DOC_PASSWORD", "demo-password")

    settings = Settings(_env_file=None)

    assert settings.get_legacy_doc_credentials() == DocCredentials(
        email="demo@example.com",
        password="demo-password",
    )


def test_legacy_doc_credentials_helper_requires_both_values(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    monkeypatch.setenv("ENCRYPTION_KEY", "Y8b6j0bJm0Kh3k6oQ1dQ3pbyQYQ5G3g8Jx9Vb0O8kKo=")
    monkeypatch.setenv("DOC_EMAIL", "demo@example.com")
    monkeypatch.delenv("DOC_PASSWORD", raising=False)

    settings = Settings(_env_file=None)

    assert settings.get_legacy_doc_credentials() is None
