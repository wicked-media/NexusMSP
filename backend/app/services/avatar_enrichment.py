"""Small, read-only helpers for presenting current technician avatars on records."""

from collections.abc import Iterable

from app.database import db


async def attach_user_avatars(
    records: Iterable[dict],
    *,
    id_fields: tuple[str, ...] = ("user_id", "author_id"),
    output_field: str = "avatar_url",
) -> list[dict]:
    """Attach each record's current user avatar without persisting a stale copy.

    Activity records deliberately only retain a user ID. Resolving the avatar at
    read time means an updated profile photo is reflected in historical ticket
    comments and audit views too.
    """
    items = list(records)
    user_ids = {
        str(next((record.get(field) for field in id_fields if record.get(field)), ""))
        for record in items
    }
    user_ids.discard("")
    user_ids.discard("system")

    if not user_ids:
        return items

    avatar_by_user_id: dict[str, str] = {}
    cursor = db.users.find(
        {"id": {"$in": list(user_ids)}},
        {"_id": 0, "id": 1, "avatar": 1},
    )
    async for user in cursor:
        if user.get("avatar"):
            avatar_by_user_id[str(user["id"])] = user["avatar"]

    for record in items:
        user_id = next((record.get(field) for field in id_fields if record.get(field)), None)
        avatar = avatar_by_user_id.get(str(user_id)) if user_id else None
        if avatar:
            record[output_field] = avatar
    return items
