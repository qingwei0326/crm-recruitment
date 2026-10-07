"""Helpers for queries whose ``IN (...)`` list can grow with the data.

SQLite limits one statement to 999 bound variables on older builds (32766 on
newer ones). Lists keyed by student / work-item ids can exceed that, so run them
in chunks. The chunk size is read at call time so tests can shrink it.
"""

from collections.abc import Callable, Iterator, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

IN_CHUNK_SIZE = 500


def chunked(values: Sequence[Any], size: int | None = None) -> Iterator[list[Any]]:
    step = size or IN_CHUNK_SIZE
    for start in range(0, len(values), step):
        yield list(values[start : start + step])


async def scalars_in_chunks(
    db: AsyncSession, build: Callable[[list[Any]], Any], values: Sequence[Any]
) -> list[Any]:
    """Run ``build(chunk)`` per chunk and concatenate ``.scalars()``; re-sort in the caller."""
    found: list[Any] = []
    for chunk in chunked(values):
        found.extend((await db.execute(build(chunk))).scalars().all())
    return found


async def rows_in_chunks(
    db: AsyncSession, build: Callable[[list[Any]], Any], values: Sequence[Any]
) -> list[Any]:
    found: list[Any] = []
    for chunk in chunked(values):
        found.extend((await db.execute(build(chunk))).all())
    return found


async def rowcount_in_chunks(
    db: AsyncSession, build: Callable[[list[Any]], Any], values: Sequence[Any]
) -> int:
    total = 0
    for chunk in chunked(values):
        total += int((await db.execute(build(chunk))).rowcount or 0)
    return total
