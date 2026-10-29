"""Skill loader – reads Mantis skill Markdown files and formats them into
LLM-ready messages."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

# Skill files live alongside the backend source at ``backend/skills/``
_SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"


def load_skill(skill_name: str) -> str:
    """Read a skill markdown file from the ``backend/skills/`` directory.

    Parameters
    ----------
    skill_name:
        The base name of the skill file **without** the ``.md`` extension,
        e.g. ``"mantis-recon"`` or ``"mantis-reproduce"``.

    Returns
    -------
    str
        The raw markdown content of the skill file.

    Raises
    ------
    FileNotFoundError
        If the skill file doesn't exist.
    """
    filename = f"{skill_name}.md"
    skill_path = _SKILLS_DIR / filename

    if not skill_path.is_file():
        raise FileNotFoundError(
            f"Skill file not found: {skill_path}  "
            f"(resolved from SKILLS_DIR={_SKILLS_DIR})"
        )

    content = skill_path.read_text(encoding="utf-8")
    logger.debug("skill_loaded", skill=skill_name, chars=len(content))
    return content


def format_skill_prompt(
    skill_content: str,
    context: dict[str, Any],
) -> list[dict[str, str]]:
    """Format the loaded skill markdown into a list of LLM chat messages.

    Parameters
    ----------
    skill_content:
        The raw markdown string returned by :func:`load_skill`.
    context:
        A dictionary of key/value pairs to inject into the user prompt.
        Common keys include ``repo_summary``, ``file_listing``,
        ``findings_so_far``, ``target_file``, etc.

    Returns
    -------
    list[dict[str, str]]
        A list of ``{"role": ..., "content": ...}`` message dicts suitable
        for passing to ``litellm.completion(messages=...)``.
    """
    # Build a context block from the provided dictionary
    context_lines: list[str] = []
    for key, value in context.items():
        readable_key = key.replace("_", " ").title()
        context_lines.append(f"### {readable_key}\n{value}")
    context_block = "\n\n".join(context_lines)

    system_message = (
        "You are Mantis, an expert AI security researcher. "
        "Follow the skill instructions precisely. "
        "Always respond with structured, actionable output."
    )

    user_message = (
        f"{skill_content}\n\n"
        f"---\n\n"
        f"## Context\n\n"
        f"{context_block}"
    )

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message},
    ]
