"""omilo.learning — periodic external learning for Helpers.

Public API
----------
    learn_external(db, helper, *, budget=3) -> dict
        Relevance-gated offline learning: derive topics from helper role +
        company goals, fetch deterministic offline sources, gate by relevance,
        store kept sources in KB (kind='web') + Memory, drop the rest.
"""
from omilo.learning.external import learn_external

__all__ = ["learn_external"]
