"""omilo.memory — editable markdown memory (Lessons.md / Notes.md) per helper.

Public API
----------
    add_lesson(db, helper_id, text, source="") -> MemoryDoc
    remember(db, helper_id, text) -> MemoryDoc
    get_memory(db, helper_id) -> str
"""
from omilo.memory.store import add_lesson, get_memory, remember

__all__ = ["add_lesson", "remember", "get_memory"]
