# MANTIS_HELPER_VERSION = 5
# Copyright 2026 Google LLC
# Licensed under Apache 2.0 (Google Mantis Upstream Specification)

"""Mantis structural index query helper.

Bounded, paginated queries against catalog.sqlite.
Implements the Pass Lifecycle Contract query helper specification.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def _locate_index_dir(state_root: Optional[str] = None) -> Optional[Path]:
    """Find the directory containing catalog.sqlite and manifest.json."""
    candidates = []
    if state_root:
        sr = Path(state_root)
        candidates.extend([
            sr / "kb" / "structural_index",
            sr / "structural_index",
            sr / "mantis_index",
            sr,
        ])
    cwd = Path.cwd()
    candidates.extend([
        cwd / "workspace" / "kb" / "structural_index",
        cwd / "kb" / "structural_index",
        cwd / "mantis_index",
        cwd / ".." / "mantis_index",
        cwd / ".." / "kb" / "structural_index",
    ])
    for c in candidates:
        if (c / "catalog.sqlite").exists():
            return c.resolve()
    return None


def _get_db(catalog_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{catalog_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def cmd_resolve_symbol(args: argparse.Namespace) -> None:
    index_dir = _locate_index_dir(args.state_root)
    if not index_dir:
        print(json.dumps({"results": [], "total": 0, "ambiguous": False, "coverage": {"partition_status": "empty"}}))
        return

    name = args.name
    lang = getattr(args, "language", None)
    file_filter = getattr(args, "file", None)
    limit = max(1, min(args.limit, 200))
    offset = max(0, args.offset)

    conn = _get_db(index_dir / "catalog.sqlite")
    try:
        where_clauses = ["(name = ? OR qualified_name = ?)"]
        params: list[Any] = [name, name]
        if lang:
            where_clauses.append("language = ?")
            params.append(lang)
        if file_filter:
            where_clauses.append("file_path LIKE ?")
            params.append(f"%{file_filter}%")

        where_str = " AND ".join(where_clauses)
        total = conn.execute(f"SELECT COUNT(*) FROM symbols WHERE {where_str}", params).fetchone()[0]

        q = (
            f"SELECT symbol_id, name, qualified_name, language, file_path, start_line, end_line, kind, signature, backend, precision "
            f"FROM symbols WHERE {where_str} ORDER BY file_path, start_line LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])
        rows = [dict(r) for r in conn.execute(q, params).fetchall()]

        out = {
            "results": rows,
            "total": total,
            "ambiguous": total > 1,
            "coverage": {"partition_status": "complete" if rows else "unknown"},
        }
        print(json.dumps(out, indent=2))
    finally:
        conn.close()


def cmd_find_callers(args: argparse.Namespace) -> None:
    index_dir = _locate_index_dir(args.state_root)
    if not index_dir:
        print(json.dumps({"results": [], "total": 0, "has_more": False, "coverage": {"partition_status": "empty"}}))
        return

    symbol_id = args.symbol_id
    limit = max(1, min(args.limit, 200))
    offset = max(0, args.offset)

    conn = _get_db(index_dir / "catalog.sqlite")
    try:
        sym = conn.execute("SELECT name FROM symbols WHERE symbol_id = ?", (symbol_id,)).fetchone()
        callee_name = sym["name"] if sym else ""

        count_q = (
            "SELECT COUNT(*) FROM call_edges e "
            "WHERE (e.callee_id = ? OR (e.callee_id IS NULL AND e.callee_name = ?))"
        )
        total = conn.execute(count_q, (symbol_id, callee_name)).fetchone()[0]

        data_q = (
            "SELECT e.file_path, e.line, e.edge_kind, s.name AS caller, s.symbol_id AS caller_id "
            "FROM call_edges e LEFT JOIN symbols s ON e.caller_id = s.symbol_id "
            "WHERE (e.callee_id = ? OR (e.callee_id IS NULL AND e.callee_name = ?)) "
            "ORDER BY e.file_path, e.line LIMIT ? OFFSET ?"
        )
        rows = [dict(r) for r in conn.execute(data_q, (symbol_id, callee_name, limit, offset)).fetchall()]

        out = {
            "results": rows,
            "total": total,
            "has_more": (offset + len(rows)) < total,
            "coverage": {"partition_status": "complete" if total > 0 else "unknown"},
        }
        print(json.dumps(out, indent=2))
    finally:
        conn.close()


def cmd_find_callees(args: argparse.Namespace) -> None:
    index_dir = _locate_index_dir(args.state_root)
    if not index_dir:
        print(json.dumps({"results": [], "total": 0, "has_more": False, "coverage": {"partition_status": "empty"}}))
        return

    symbol_id = args.symbol_id
    limit = max(1, min(args.limit, 200))
    offset = max(0, args.offset)

    conn = _get_db(index_dir / "catalog.sqlite")
    try:
        count_q = "SELECT COUNT(*) FROM call_edges WHERE caller_id = ?"
        total = conn.execute(count_q, (symbol_id,)).fetchone()[0]

        data_q = (
            "SELECT e.callee_name, e.callee_id, e.line, e.edge_kind, s.file_path AS callee_file, s.start_line AS callee_start_line "
            "FROM call_edges e LEFT JOIN symbols s ON e.callee_id = s.symbol_id "
            "WHERE e.caller_id = ? ORDER BY e.line LIMIT ? OFFSET ?"
        )
        rows = [dict(r) for r in conn.execute(data_q, (symbol_id, limit, offset)).fetchall()]

        out = {
            "results": rows,
            "total": total,
            "has_more": (offset + len(rows)) < total,
            "coverage": {"partition_status": "complete" if total > 0 else "unknown"},
        }
        print(json.dumps(out, indent=2))
    finally:
        conn.close()


def cmd_get_function_boundary(args: argparse.Namespace) -> None:
    index_dir = _locate_index_dir(args.state_root)
    if not index_dir:
        print(json.dumps({"found": False, "coverage": {"partition_status": "empty"}}))
        return

    clean_file = (args.file or "").replace("\\", "/").removeprefix("./")
    lineno = int(args.line)

    conn = _get_db(index_dir / "catalog.sqlite")
    try:
        q = (
            "SELECT symbol_id, file_path, start_line, end_line, signature, language, qualified_name, kind "
            "FROM symbols WHERE file_path = ? AND start_line <= ? AND (end_line IS NULL OR end_line >= ?) "
            "AND kind IN ('function', 'method', 'macro') "
            "ORDER BY start_line DESC, (end_line - start_line) ASC LIMIT 1"
        )
        row = conn.execute(q, (clean_file, lineno, lineno)).fetchone()
        if not row:
            # Fallback suffix match
            q_suffix = (
                "SELECT symbol_id, file_path, start_line, end_line, signature, language, qualified_name, kind "
                "FROM symbols WHERE file_path LIKE ? AND start_line <= ? AND (end_line IS NULL OR end_line >= ?) "
                "AND kind IN ('function', 'method', 'macro') "
                "ORDER BY start_line DESC, (end_line - start_line) ASC LIMIT 1"
            )
            row = conn.execute(q_suffix, (f"%{clean_file}", lineno, lineno)).fetchone()

        if row:
            res = dict(row)
            res["found"] = True
            res["coverage"] = {"partition_status": "complete"}
            print(json.dumps(res, indent=2))
        else:
            print(json.dumps({"found": False, "coverage": {"partition_status": "complete"}}))
    finally:
        conn.close()


def cmd_get_coverage(args: argparse.Namespace) -> None:
    index_dir = _locate_index_dir(args.state_root)
    if not index_dir:
        print(json.dumps({"partition_status": "empty", "total_files": 0, "indexed_files": 0}))
        return

    manifest_path = index_dir / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            print(json.dumps(manifest.get("coverage", {}), indent=2))
            return
        except Exception:
            pass

    conn = _get_db(index_dir / "catalog.sqlite")
    try:
        total = conn.execute("SELECT COUNT(*) FROM coverage").fetchone()[0]
        indexed = conn.execute("SELECT COUNT(*) FROM coverage WHERE indexed = 1").fetchone()[0]
        print(json.dumps({"partition_status": "complete", "total_files": total, "indexed_files": indexed}, indent=2))
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Mantis Structural Index Query Helper")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    # resolve_symbol
    p_resolve = sub.add_parser("resolve_symbol")
    p_resolve.add_argument("--name", required=True)
    p_resolve.add_argument("--language", default=None)
    p_resolve.add_argument("--file", default=None)
    p_resolve.add_argument("--limit", type=int, default=20)
    p_resolve.add_argument("--offset", type=int, default=0)
    p_resolve.add_argument("--state_root", default=None)
    p_resolve.set_defaults(func=cmd_resolve_symbol)

    # find_callers
    p_callers = sub.add_parser("find_callers")
    p_callers.add_argument("--symbol_id", required=True)
    p_callers.add_argument("--limit", type=int, default=100)
    p_callers.add_argument("--offset", type=int, default=0)
    p_callers.add_argument("--state_root", default=None)
    p_callers.set_defaults(func=cmd_find_callers)

    # find_callees
    p_callees = sub.add_parser("find_callees")
    p_callees.add_argument("--symbol_id", required=True)
    p_callees.add_argument("--limit", type=int, default=100)
    p_callees.add_argument("--offset", type=int, default=0)
    p_callees.add_argument("--state_root", default=None)
    p_callees.set_defaults(func=cmd_find_callees)

    # get_function_boundary
    p_bound = sub.add_parser("get_function_boundary")
    p_bound.add_argument("--file", required=True)
    p_bound.add_argument("--line", type=int, required=True)
    p_bound.add_argument("--state_root", default=None)
    p_bound.set_defaults(func=cmd_get_function_boundary)

    # get_coverage
    p_cov = sub.add_parser("get_coverage")
    p_cov.add_argument("--file", default=None)
    p_cov.add_argument("--state_root", default=None)
    p_cov.set_defaults(func=cmd_get_coverage)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
