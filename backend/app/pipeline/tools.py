"""Agent tools – file-system and git helpers scoped to a scan workspace."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


def _safe_path(scan_dir: str, relative: str) -> Path:
    """Resolve *relative* inside *scan_dir* and verify it doesn't escape.

    Raises ``ValueError`` if the resulting path would escape the scan
    workspace.
    """
    base = Path(scan_dir).resolve()
    target = (base / relative).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError(
            f"Path traversal denied: {relative!r} escapes workspace {scan_dir!r}"
        )
    return target


def list_files(scan_dir: str, directory: str = ".") -> list[str]:
    """Recursively list files under *directory* within the scan workspace.

    Returns relative paths from *scan_dir*.
    """
    root = _safe_path(scan_dir, directory)
    if not root.is_dir():
        return []

    result: list[str] = []
    base = Path(scan_dir).resolve()

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip hidden and common noise directories
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".")
            and d not in ("node_modules", "__pycache__", ".git", "venv", ".venv")
        ]
        for fname in filenames:
            full = Path(dirpath) / fname
            result.append(str(full.relative_to(base)))

    return sorted(result)


def read_file(
    scan_dir: str,
    path: str,
    start_line: Optional[int] = None,
    end_line: Optional[int] = None,
) -> str:
    """Read a file inside the scan workspace.

    Optionally returns only lines ``start_line`` through ``end_line``
    (1-indexed, inclusive).
    """
    target = _safe_path(scan_dir, path)
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    content = target.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines(keepends=True)

    if start_line is not None or end_line is not None:
        s = (start_line or 1) - 1
        e = end_line or len(lines)
        lines = lines[s:e]

    return "".join(lines)


def grep_code(
    scan_dir: str,
    pattern: str,
    max_results: int = 200,
) -> list[dict[str, str | int]]:
    """Search for *pattern* (regex) across all text files in the workspace.

    Returns a list of ``{"file": ..., "line": ..., "match": ...}`` dicts.
    """
    base = Path(scan_dir).resolve()
    results: list[dict[str, str | int]] = []
    compiled = re.compile(pattern, re.IGNORECASE)

    for filepath in sorted(base.rglob("*")):
        if not filepath.is_file():
            continue
        # Skip binary-ish and noise directories
        rel = str(filepath.relative_to(base))
        if any(
            part in rel
            for part in (".git", "node_modules", "__pycache__", ".venv", "venv")
        ):
            continue

        try:
            text = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        for lineno, line in enumerate(text.splitlines(), start=1):
            if compiled.search(line):
                results.append({
                    "file": rel,
                    "line": lineno,
                    "match": line.strip(),
                })
                if len(results) >= max_results:
                    return results

    return results


def collect_source_context(scan_dir: str, max_chars: int = 150_000) -> str:
    """Collect source files and sensitive vulnerability sinks for LLM analysis.

    For small/medium repositories (< max_chars):
      Reads all core source files (Python, JS/TS, Go, Java, PHP, Shell, SQL, HTML).
    For larger repositories:
      Prioritizes entry points, routes, database modules, and extracts
      context windows around dangerous sinks (SQL execution, command execution,
      eval, deserialization, secrets).
    """
    source_exts = {
        ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".java", ".php",
        ".rb", ".c", ".cpp", ".rs", ".sql", ".sh", ".html"
    }
    config_names = {
        "requirements.txt", "package.json", "go.mod", "pom.xml",
        "Cargo.toml", "Dockerfile", "docker-compose.yml", "start.sh",
        "database.py", "schemas.py", "main.py", "app.py"
    }

    files = list_files(scan_dir)
    source_files = [
        f for f in files
        if Path(f).suffix.lower() in source_exts or Path(f).name in config_names
    ]

    # Prioritize key files: configs, main, database, models, auth, routes
    def priority_score(fname: str) -> int:
        name = Path(fname).name.lower()
        if name in config_names:
            return 0
        if any(k in name for k in ("main", "app", "server", "database", "db", "auth", "route", "schema", "model")):
            return 1
        return 2

    source_files.sort(key=priority_score)

    collected_blocks: list[str] = []
    total_chars = 0

    for rel_path in source_files:
        try:
            content = read_file(scan_dir, rel_path)
            if len(content) > 100_000 and "min" in rel_path:
                continue

            block = f"### File: `{rel_path}`\n```{Path(rel_path).suffix.lstrip('.') or 'text'}\n{content}\n```\n"
            if total_chars + len(block) > max_chars:
                trimmed = "\n".join(content.splitlines()[:200])
                block = f"### File: `{rel_path}` (First 200 lines)\n```{Path(rel_path).suffix.lstrip('.') or 'text'}\n{trimmed}\n```\n"
                collected_blocks.append(block)
                break

            collected_blocks.append(block)
            total_chars += len(block)
        except Exception:
            continue

    # Also extract security sink matches across the workspace
    sink_pattern = r"(cursor\.execute|db\.execute|\.execute\(|SELECT\s+.*FROM|eval\(|exec\(|os\.system|subprocess\.|pickle\.load|yaml\.load|render_template_string|SECRET_KEY)"
    sinks = grep_code(scan_dir, sink_pattern, max_results=50)
    if sinks:
        sink_lines = ["\n### Key Security Sinks Detected via Grep:"]
        for s in sinks:
            sink_lines.append(f"- `{s['file']}:{s['line']}`: `{s['match']}`")
        collected_blocks.append("\n".join(sink_lines))

    return "\n\n".join(collected_blocks)


def git_log_diff(scan_dir: str, limit: int = 20) -> str:
    """Return the ``git log --oneline`` output with stat diffs for the last
    *limit* commits."""
    try:
        result = subprocess.run(
            ["git", "log", f"-n{limit}", "--oneline", "--stat"],
            cwd=scan_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout or result.stderr or "(no output)"
    except FileNotFoundError:
        return "git is not installed"
    except subprocess.TimeoutExpired:
        return "git log timed out"
    except Exception as exc:
        return f"git log failed: {exc}"


def write_reproducer(scan_dir: str, code: str) -> str:
    """Write a ``reproducer.py`` file inside the scan workspace.

    Returns the absolute path to the written file.
    """
    target = _safe_path(scan_dir, "reproducer.py")
    target.write_text(code, encoding="utf-8")
    logger.info("reproducer_written", path=str(target))
    return str(target)


def apply_patch(scan_dir: str, patch_diff: str) -> bool:
    """Apply a unified diff patch to the scan workspace using ``git apply``.

    Returns ``True`` if the patch applied cleanly, ``False`` otherwise.
    """
    patch_path = _safe_path(scan_dir, "_patch.diff")
    patch_path.write_text(patch_diff, encoding="utf-8")

    try:
        result = subprocess.run(
            ["git", "apply", "--stat", "--apply", str(patch_path)],
            cwd=scan_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        success = result.returncode == 0
        if not success:
            logger.warning(
                "patch_apply_failed",
                stderr=result.stderr,
                returncode=result.returncode,
            )
        else:
            logger.info("patch_applied", workspace=scan_dir)
        return success
    except Exception as exc:
        logger.error("patch_apply_error", error=str(exc))
        return False
    finally:
        # Clean up the temporary patch file
        try:
            patch_path.unlink(missing_ok=True)
        except Exception:
            pass
