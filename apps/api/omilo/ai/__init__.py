"""Omilo's AI layer: which AI a company connected (config), one streaming
conversation turn across providers (llm), the shared prompts (prompts) and
encrypted account credentials (secrets)."""
from omilo.ai.config import FAKE, AiConfig, resolve
from omilo.ai.llm import AiError, complete, converse, run_sync

__all__ = ["AiConfig", "AiError", "FAKE", "complete", "converse", "resolve", "run_sync"]
