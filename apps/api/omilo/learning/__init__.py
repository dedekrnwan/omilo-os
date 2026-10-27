"""omilo.learning — periodic external learning + retro/scorecard for Helpers.

Public API
----------
    learn_external(db, helper, *, budget=3) -> dict
        Relevance-gated offline learning: derive topics from helper role +
        company goals, fetch deterministic offline sources, gate by relevance,
        store kept sources in KB (kind='web') + Memory, drop the rest.

    scorecard(db, *, days=30) -> list[dict]
        Per-helper scorecard computed exactly from Job/Proposal rows.

    review(db, *, days=7) -> dict
        Find weak helpers, create Improvement records, return them + scorecard.
"""
from omilo.learning.external import learn_external
from omilo.learning.retro import review, scorecard

__all__ = ["learn_external", "scorecard", "review"]
