"""Read-only production-readiness metadata check for Nexus data stores.

Loads only local environment configuration, pings MongoDB, inspects collection
and index metadata, and asks the existing Supabase artifact adapter for its
secret-free status. It does not read customer documents, create buckets or
indexes, mutate data, or print credentials.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")


def mongo_metadata() -> dict:
    mongo_url = os.getenv("MONGO_URL")
    database_name = os.getenv("DB_NAME")
    if not mongo_url or not database_name:
        return {"configured": False, "detail": "MONGO_URL or DB_NAME is not configured."}

    try:
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        database = client[database_name]
        names = sorted(database.list_collection_names())
        indexed, no_secondary_index = 0, []
        for name in names:
            indexes = list(database[name].list_indexes())
            if len(indexes) > 1:
                indexed += 1
            else:
                no_secondary_index.append(name)
        return {
            "configured": True,
            "reachable": True,
            "database": database_name,
            "collection_count": len(names),
            "collections_with_secondary_index": indexed,
            "collections_without_secondary_index": len(no_secondary_index),
            "sample_without_secondary_index": no_secondary_index[:25],
            "detail": "Metadata only. Review real query patterns before adding indexes.",
        }
    except Exception as exc:  # runtime diagnostics must not print connection strings
        return {"configured": True, "reachable": False, "detail": f"MongoDB metadata check failed: {type(exc).__name__}"}


async def supabase_metadata() -> dict:
    from app.services.supabase_storage import storage_status

    return await storage_status()


def main() -> None:
    result = {
        "mode": "read-only",
        "mongo": mongo_metadata(),
        "supabase_artifacts": asyncio.run(supabase_metadata()),
        "limits": [
            "Does not inspect Supabase Postgres RLS, Auth, Realtime or object policies.",
            "Does not inspect MongoDB validators, backups, user privileges, TTL indexes or document contents.",
        ],
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
