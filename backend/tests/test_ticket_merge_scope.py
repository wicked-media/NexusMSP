import asyncio
from types import SimpleNamespace

from app.routers import ticket_merge


def test_auto_merge_settings_are_read_from_the_callers_tenant(monkeypatch):
    class Settings:
        def __init__(self):
            self.query = None

        async def find_one(self, query, _projection):
            self.query = query
            return None

    settings = Settings()
    monkeypatch.setattr(ticket_merge, "db", SimpleNamespace(settings=settings))

    result = asyncio.run(ticket_merge.get_auto_merge_settings({"id": "tech-1", "tenant_id": "tenant-a"}))

    assert result["enabled"] is False
    assert settings.query == {"$and": [{"type": "auto_merge"}, {"tenant_id": "tenant-a"}]}
