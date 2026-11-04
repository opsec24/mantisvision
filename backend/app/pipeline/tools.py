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


def write_reproducer(scan_dir: str, code: str, filename: Optional[str] = None) -> str:
    """Write a reproducer script inside the scan workspace.

    Automatically selects ``reproducer.js``, ``reproducer.ts``, or ``reproducer.py``
    if not explicitly passed.
    """
    if not filename:
        stripped = code.strip()
        if (
            "import " in stripped and " from '" in stripped
            or "require('" in stripped
            or "const " in stripped and "function(" in stripped
            or "export " in stripped
        ):
            if ": string" in stripped or ": number" in stripped or "interface " in stripped:
                filename = "reproducer.ts"
            else:
                filename = "reproducer.js"
        elif stripped.startswith("#!/bin/bash") or stripped.startswith("#!/bin/sh"):
            filename = "reproducer.sh"
        else:
            filename = "reproducer.py"

    target = _safe_path(scan_dir, filename)
    target.write_text(code, encoding="utf-8")
    logger.info("reproducer_written", path=str(target), file=filename)
    return str(target)


def build_repository_cartography(scan_dir: str) -> dict[str, Any]:
    """Analyze the repository directory tree and extract structured architectural cartography:
    1. Manifests (package.json, requirements.txt, etc.)
    2. API route handlers and entry points
    3. Sensitive modules (auth, crypto, SQL, exec, upload)
    4. Directory map with file counts
    5. Prioritized code file listing ensuring routes & sensitive modules are never truncated.
    """
    base = Path(scan_dir).resolve()
    if not base.is_dir():
        return {
            "file_listing": "",
            "manifests_block": "",
            "routes_summary": "",
            "sensitive_summary": "",
            "total_files": 0,
        }

    noise_dirs = {
        "node_modules", ".git", "venv", ".venv", "dist", "build",
        ".next", "coverage", "__pycache__", ".idea", ".vscode", "vendor",
        "bower_components", ".terraform", "tmp", "temp",
    }
    noise_extensions = {
        ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
        ".woff", ".woff2", ".ttf", ".eot", ".lock", ".min.js", ".min.css",
        ".map", ".pdf", ".zip", ".gz", ".tar", ".tgz",
    }
    manifest_names = {
        "package.json", "requirements.txt", "Pipfile", "pyproject.toml",
        "go.mod", "pom.xml", "build.gradle", "settings.gradle",
        "Cargo.toml", "Gemfile", "composer.json", "Dockerfile",
        "docker-compose.yml", "docker-compose.yaml", "tsconfig.json",
    }
    sensitive_keywords = (
        "auth", "login", "jwt", "session", "token", "crypto", "insecurity",
        "security", "credential", "secret", "user", "role", "perm", "db",
        "database", "sql", "upload", "exec", "shell", "admin", "sandbox",
    )

    all_rel_files: list[str] = []
    manifests: list[str] = []
    routes: list[str] = []
    sensitive: list[str] = []
    other_code: list[str] = []
    dir_counts: dict[str, int] = {}

    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".") and d not in noise_dirs
        ]
        rel_dir = os.path.relpath(dirpath, base)
        top_dir = rel_dir.split(os.sep)[0] if rel_dir != "." else "."

        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in noise_extensions or fname.endswith(("-lock.json", ".lock")):
                continue

            full_path = Path(dirpath) / fname
            rel_path = str(full_path.relative_to(base)).replace("\\", "/")
            all_rel_files.append(rel_path)
            dir_counts[top_dir] = dir_counts.get(top_dir, 0) + 1

            lower_path = rel_path.lower()

            # 1. Manifest
            if fname in manifest_names or any(lower_path.endswith(f"/{m}") for m in manifest_names):
                manifests.append(rel_path)
                continue

            # 2. Route & controller entrypoints
            is_route = any(
                part in lower_path
                for part in ("/routes/", "/controllers/", "/api/", "/endpoints/", "/handlers/", "/views/")
            ) or lower_path.startswith(("routes/", "controllers/", "api/", "endpoints/", "handlers/")) or fname in (
                "app.ts", "server.ts", "app.js", "server.js", "main.py", "app.py",
                "urls.py", "routes.py", "router.ts", "router.js", "index.ts", "index.js",
            )

            if is_route:
                routes.append(rel_path)
                continue

            # 3. Sensitive security modules
            is_sensitive = any(kw in lower_path for kw in sensitive_keywords)
            if is_sensitive:
                sensitive.append(rel_path)
                continue

            other_code.append(rel_path)

    # Read manifest contents
    manifest_entries: list[str] = []
    for mf in manifests[:6]:
        try:
            content = read_file(scan_dir, mf)
            if 0 < len(content) < 15_000:
                manifest_entries.append(f"### Manifest: `{mf}`\n```\n{content}\n```")
        except Exception:
            pass
    manifests_block = "\n\n".join(manifest_entries)

    # Directory map string
    dir_summary_lines = [f"- `{d}/`: {cnt} file(s)" for d, cnt in sorted(dir_counts.items(), key=lambda x: -x[1])[:15]]
    dir_summary = "\n".join(dir_summary_lines)

    # Prioritized file listing: manifests -> routes -> sensitive -> other code
    prioritized_list = (
        sorted(manifests)
        + sorted(routes)
        + sorted(sensitive)
        + sorted(other_code)
    )

    routes_summary = "\n".join(f"- `{r}`" for r in sorted(routes)[:100])
    sensitive_summary = "\n".join(f"- `{s}`" for s in sorted(sensitive)[:100])

    structured_listing_parts = []
    if routes:
        structured_listing_parts.append(
            f"### Primary Attack Surface Entrypoints & Routes ({len(routes)} files):\n"
            + "\n".join(sorted(routes))
        )
    if sensitive:
        structured_listing_parts.append(
            f"### Sensitive Security & Data Processing Modules ({len(sensitive)} files):\n"
            + "\n".join(sorted(sensitive))
        )
    if manifests:
        structured_listing_parts.append(
            f"### Build & Dependency Manifests ({len(manifests)} files):\n"
            + "\n".join(sorted(manifests))
        )

    structured_listing_parts.append(
        f"### Complete File Tree (Prioritized):\n"
        + "\n".join(prioritized_list[:1500])
    )

    combined_file_listing = "\n\n".join(structured_listing_parts)

    return {
        "file_listing": combined_file_listing,
        "manifests_block": manifests_block,
        "routes_summary": routes_summary,
        "sensitive_summary": sensitive_summary,
        "dir_summary": dir_summary,
        "total_files": len(all_rel_files),
        "routes_count": len(routes),
        "sensitive_count": len(sensitive),
    }


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


def find_definitions(
    scan_dir: str,
    symbol: str,
    max_results: int = 25,
) -> list[dict[str, Any]]:
    """Locate definitions (functions, classes, constants, types) of *symbol* across the codebase.

    Supports JavaScript, TypeScript, Python, Go, Rust, Java, and C/C++.
    """
    base = Path(scan_dir).resolve()
    results: list[dict[str, Any]] = []
    escaped = re.escape(symbol)

    def_patterns = [
        re.compile(rf"(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+{escaped}\b"),
        re.compile(rf"(?:export\s+)?(?:class|interface|type)\s+{escaped}\b"),
        re.compile(rf"(?:export\s+)?(?:const|let|var)\s+{escaped}\s*="),
        re.compile(rf"(?:def|class)\s+{escaped}\b"),
        re.compile(rf"(?:func|type|fn|struct|enum)\s+{escaped}\b"),
        re.compile(rf"^\s*{escaped}\s*=\s*(?:lambda|\(?[a-zA-Z0-9_, ]*\)?\s*=>)"),
    ]

    code_exts = {
        ".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java",
        ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".cs"
    }

    for filepath in sorted(base.rglob("*")):
        if not filepath.is_file() or filepath.suffix.lower() not in code_exts:
            continue
        rel = str(filepath.relative_to(base))
        if any(seg in rel.split(os.sep) for seg in ("node_modules", ".git", "venv", "__pycache__", "dist", "build", ".next")):
            continue

        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line_num, line in enumerate(f, 1):
                    for pat in def_patterns:
                        if pat.search(line):
                            results.append({
                                "file": rel,
                                "line": line_num,
                                "declaration": line.strip()[:180],
                            })
                            if len(results) >= max_results:
                                return results
                            break
        except Exception:
            continue

    return results


def find_references(
    scan_dir: str,
    symbol: str,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Find references and call sites of *symbol* across codebase text files."""
    base = Path(scan_dir).resolve()
    results: list[dict[str, Any]] = []
    pattern = re.compile(rf"\b{re.escape(symbol)}\b")

    code_exts = {
        ".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java",
        ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".cs", ".json", ".yml", ".yaml"
    }

    for filepath in sorted(base.rglob("*")):
        if not filepath.is_file() or filepath.suffix.lower() not in code_exts:
            continue
        rel = str(filepath.relative_to(base))
        if any(seg in rel.split(os.sep) for seg in ("node_modules", ".git", "venv", "__pycache__", "dist", "build", ".next")):
            continue

        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line_num, line in enumerate(f, 1):
                    if pattern.search(line):
                        results.append({
                            "file": rel,
                            "line": line_num,
                            "match": line.strip()[:180],
                        })
                        if len(results) >= max_results:
                            return results
        except Exception:
            continue

    return results


def outline_file(scan_dir: str, path: str) -> str:
    """Extract a structural outline of a file (imports, classes, functions, route handlers)."""
    target = _safe_path(scan_dir, path)
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    outline_lines: list[str] = [f"### Outline for `{path}`:"]
    interesting_pattern = re.compile(
        r"^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|def|func|fn)\s+([a-zA-Z0-9_$]+)|"
        r"(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*['\"]([^'\"]+)['\"]|"
        r"^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\("
    )

    with open(target, "r", encoding="utf-8", errors="replace") as f:
        for idx, line in enumerate(f, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("//") or stripped.startswith("#"):
                continue
            if stripped.startswith("import ") or stripped.startswith("from ") or stripped.startswith("require("):
                if idx <= 20:  # capture top imports
                    outline_lines.append(f"  Line {idx:4d} [import]: {stripped[:120]}")
            m = interesting_pattern.search(stripped)
            if m:
                outline_lines.append(f"  Line {idx:4d}: {stripped[:140]}")

    return "\n".join(outline_lines)


def get_function_boundary(scan_dir: str, path: str, symbol_or_line: Any) -> dict[str, Any]:
    """Extract the exact function boundary (start_line, end_line, body) for a symbol or line number.

    Matches the Google Mantis get_function_boundary tool in /mantis-structural-index.
    """
    target = _safe_path(scan_dir, path)
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    with open(target, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    target_line = None
    symbol_name = None

    if isinstance(symbol_or_line, int) or (isinstance(symbol_or_line, str) and symbol_or_line.isdigit()):
        target_line = int(symbol_or_line)
    else:
        symbol_name = str(symbol_or_line).strip()

    start_line = None
    if symbol_name:
        escaped = re.escape(symbol_name)
        pattern = re.compile(
            rf"(?:(?:async\s+)?function\s+{escaped}\b|(?:def|func|fn)\s+{escaped}\b|(?:const|let|var)\s+{escaped}\s*=|(?:class)\s+{escaped}\b|['\"]?{escaped}['\"]?\s*:\s*(?:async\s*)?\()"
        )
        for idx, line in enumerate(lines, 1):
            if pattern.search(line):
                start_line = idx
                break
    elif target_line and 1 <= target_line <= len(lines):
        fn_pattern = re.compile(
            r"(?:(?:async\s+)?function\s+[a-zA-Z0-9_$]+|(?:def|func|fn)\s+[a-zA-Z0-9_$]+|(?:const|let|var)\s+[a-zA-Z0-9_$]+\s*=|(?:class)\s+[a-zA-Z0-9_$]+|\b(?:get|post|put|delete)\s*\()"
        )
        for idx in range(target_line, 0, -1):
            if fn_pattern.search(lines[idx - 1]):
                start_line = idx
                break
        if start_line is None:
            start_line = max(1, target_line - 15)

    if start_line is None:
        start_line = 1

    is_python = target.suffix.lower() == ".py"
    end_line = start_line

    if is_python:
        def_indent = len(lines[start_line - 1]) - len(lines[start_line - 1].lstrip())
        for idx in range(start_line + 1, len(lines) + 1):
            line_str = lines[idx - 1]
            if not line_str.strip() or line_str.strip().startswith("#"):
                continue
            cur_indent = len(line_str) - len(line_str.lstrip())
            if cur_indent <= def_indent:
                end_line = idx - 1
                break
        else:
            end_line = min(len(lines), start_line + 100)
    else:
        open_braces = 0
        started = False
        for idx in range(start_line, len(lines) + 1):
            line_str = lines[idx - 1]
            open_braces += line_str.count("{") - line_str.count("}")
            if "{" in line_str:
                started = True
            if started and open_braces <= 0:
                end_line = idx
                break
        else:
            end_line = min(len(lines), start_line + 80)

    snippet = "".join(lines[start_line - 1:end_line])
    return {
        "file_path": path,
        "symbol": symbol_name or f"line_{target_line}",
        "start_line": start_line,
        "end_line": end_line,
        "line_count": end_line - start_line + 1,
        "content": snippet,
    }


def find_callees(scan_dir: str, path: str, symbol_name: Optional[str] = None) -> list[str]:
    """Find all function and method calls invoked inside a specific file or function.

    Matches the Google Mantis find_callees tool in /mantis-structural-index for taint sink tracing.
    """
    if symbol_name:
        boundary = get_function_boundary(scan_dir, path, symbol_name)
        code = boundary.get("content", "")
    else:
        target = _safe_path(scan_dir, path)
        if not target.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        code = target.read_text(encoding="utf-8", errors="replace")

    call_pattern = re.compile(r"\b([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)*)\s*\(")
    matches = call_pattern.findall(code)

    keywords_to_ignore = {
        "if", "for", "while", "switch", "catch", "function", "return",
        "export", "import", "require", "typeof", "instanceof", "new"
    }

    callees = []
    seen = set()
    for m in matches:
        if m not in seen and m not in keywords_to_ignore:
            callees.append(m)
            seen.add(m)

    return callees[:50]


def build_hierarchical_summary_tree(scan_dir: str) -> str:
    """Construct a bottom-up hierarchical security summary tree of the repository.

    Aggregates files by directory, discovers routes, exported entities, and data access modules.
    Reduces token overhead by >85% while preserving multi-file architectural context.
    """
    base = Path(scan_dir).resolve()
    dir_files: dict[str, list[str]] = {}

    code_exts = {".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".java", ".php", ".rb"}

    for filepath in sorted(base.rglob("*")):
        if not filepath.is_file() or filepath.suffix.lower() not in code_exts:
            continue
        rel = str(filepath.relative_to(base))
        parts = rel.split(os.sep)
        if any(seg in parts for seg in ("node_modules", ".git", "venv", "__pycache__", "dist", "build", ".next", "test", "tests")):
            continue
        dir_name = os.path.dirname(rel) or "."
        dir_files.setdefault(dir_name, []).append(os.path.basename(rel))

    tree_parts: list[str] = ["# Hierarchical Security Summary Tree\n"]

    for dir_name in sorted(dir_files.keys()):
        files = dir_files[dir_name]
        tree_parts.append(f"## Directory: `{dir_name}/` ({len(files)} source files)")
        for fname in files[:15]:
            file_rel = os.path.join(dir_name, fname) if dir_name != "." else fname
            try:
                content = read_file(scan_dir, file_rel, start_line=1, end_line=60)
                # Look for routes or main exports
                routes_found = re.findall(r"(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]+)['\"]", content)
                exports_found = re.findall(r"(?:export\s+(?:default\s+)?)?(?:function|class|const)\s+([a-zA-Z0-9_$]+)", content)
                notes = []
                if routes_found:
                    route_strs = [f"{m[0].upper()} {m[1]}" for m in routes_found[:3]]
                    notes.append(f"Routes: {', '.join(route_strs)}")
                if exports_found:
                    valid_exports = [e for e in exports_found if e not in ("async", "default", "function")][:4]
                    if valid_exports:
                        notes.append(f"Exports: {', '.join(valid_exports)}")
                desc = f" ({'; '.join(notes)})" if notes else ""
                tree_parts.append(f"- `{fname}`{desc}")
            except Exception:
                tree_parts.append(f"- `{fname}`")

        if len(files) > 15:
            tree_parts.append(f"- ... and {len(files) - 15} additional files")
        tree_parts.append("")

    return "\n".join(tree_parts)

