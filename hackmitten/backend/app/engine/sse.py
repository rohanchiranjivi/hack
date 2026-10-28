"""Server-Sent Events (SSE) Broadcaster for real-time monitoring updates."""

import asyncio
import json
from typing import Set

class EventBroadcaster:
    def __init__(self):
        self._queues: Set[asyncio.Queue] = set()

    async def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._queues.discard(q)

    async def broadcast(self, event_type: str, data: dict):
        if not self._queues:
            return
        msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        for q in list(self._queues):
            try:
                q.put_nowait(msg)
            except Exception:
                self._queues.discard(q)

broadcaster = EventBroadcaster()

