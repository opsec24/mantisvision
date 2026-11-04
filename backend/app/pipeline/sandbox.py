"""Docker sandbox runner for safely executing PoC reproducer scripts."""

from __future__ import annotations

import os
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


def execute_poc_in_sandbox(
    workspace_dir: str,
    timeout_seconds: int = 45,
    script_filename: Optional[str] = None,
) -> dict[str, Any]:
    """Run the reproducer script inside a locked-down Docker container.

    The container is created with:
    * ``network_mode="none"``  – no network access
    * ``mem_limit="1g"``       – 1 GiB RAM cap
    * ``nano_cpus=1_000_000_000`` – 1 CPU
    * The workspace is mounted **read-only** at ``/workspace``
    * Auto-removed on completion

    Parameters
    ----------
    workspace_dir:
        Absolute path on the host to the scan workspace containing
        ``reproducer.py``.
    timeout_seconds:
        Maximum wall-clock time to allow the container to run.

    Returns
    -------
    dict
        ``{"reproduced": bool, "exit_code": int, "logs": str}``
    """
    import docker
    from docker.errors import ContainerError, ImageNotFound, APIError

    client = docker.from_env()
    container = None

    try:
        logger.info(
            "sandbox_start",
            workspace=workspace_dir,
            timeout=timeout_seconds,
        )

        # Prefer multi-runtime mantis-sandbox (Python + Node.js + TypeScript + SQLite)
        image_name = "mantis-sandbox:latest"
        try:
            client.images.get(image_name)
        except Exception:
            image_name = "python:3.11-slim"

        # Determine execution command based on script in workspace
        if script_filename:
            if script_filename.endswith(".js"):
                script_exec = f"node {script_filename}"
            elif script_filename.endswith(".ts"):
                script_exec = f"ts-node {script_filename}"
            elif script_filename.endswith(".sh"):
                script_exec = f"bash {script_filename}"
            else:
                script_exec = f"python {script_filename}"
        elif os.path.isfile(os.path.join(workspace_dir, "reproducer.js")):
            script_exec = "node reproducer.js"
        elif os.path.isfile(os.path.join(workspace_dir, "reproducer.ts")):
            script_exec = "ts-node reproducer.ts"
        elif os.path.isfile(os.path.join(workspace_dir, "reproducer.sh")):
            script_exec = "bash reproducer.sh"
        else:
            script_exec = "python reproducer.py"

        scan_vol = "newgensast_scan_data"
        if "/data/scans/" in workspace_dir:
            subpath = workspace_dir.split("/data/scans/", 1)[1]
            vol_config = {scan_vol: {"bind": "/data/scans", "mode": "ro"}}
            # Ensure /workspace is replaced as a direct symlink to the scan workspace,
            # so absolute paths (/workspace/routes/...) and relative paths (./routes/...) both resolve cleanly.
            run_cmd = [
                "sh", "-c",
                f"rm -rf /workspace 2>/dev/null || true; ln -s /data/scans/{subpath} /workspace 2>/dev/null || true; export PYTHONPATH=/data/scans/{subpath}:/workspace:$PYTHONPATH; export NODE_PATH=/data/scans/{subpath}/node_modules:/workspace/node_modules:$NODE_PATH; cd /workspace && {script_exec}"
            ]
            work_dir = "/workspace"
        else:
            vol_config = {os.path.abspath(workspace_dir): {"bind": "/workspace", "mode": "ro"}}
            run_cmd = [
                "sh", "-c",
                f"export PYTHONPATH=/workspace:$PYTHONPATH; export NODE_PATH=/workspace/node_modules:$NODE_PATH; cd /workspace && {script_exec}"
            ]
            work_dir = "/workspace"

        mem_cap = os.getenv("SANDBOX_MEM_LIMIT", "256m")
        nano_cpus = int(os.getenv("SANDBOX_NANO_CPUS", "1000000000"))

        container = client.containers.run(
            image=image_name,
            command=run_cmd,
            volumes=vol_config,
            network_mode="none",
            mem_limit=mem_cap,
            nano_cpus=nano_cpus,
            working_dir=work_dir,
            detach=True,
            stdout=True,
            stderr=True,
        )

        # Wait for the container to finish (or timeout)
        result = container.wait(timeout=timeout_seconds)
        exit_code = result.get("StatusCode", -1)

        # Collect stdout + stderr
        logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")

        # Truncate logs to a reasonable length
        max_log_length = 50_000
        if len(logs) > max_log_length:
            logs = logs[:max_log_length] + "\n... [truncated]"

        reproduced = exit_code == 0

        logger.info(
            "sandbox_complete",
            workspace=workspace_dir,
            exit_code=exit_code,
            reproduced=reproduced,
            log_length=len(logs),
        )

        return {
            "reproduced": reproduced,
            "exit_code": exit_code,
            "logs": logs,
        }

    except ContainerError as exc:
        log_output = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
        logger.warning("sandbox_container_error", error=log_output)
        return {
            "reproduced": False,
            "exit_code": exc.exit_status if hasattr(exc, "exit_status") else -1,
            "logs": log_output,
        }

    except ImageNotFound:
        logger.error("sandbox_image_not_found", image="python:3.11-slim")
        return {
            "reproduced": False,
            "exit_code": -1,
            "logs": "Docker image python:3.11-slim not found. Pull it first.",
        }

    except APIError as exc:
        logger.error("sandbox_api_error", error=str(exc))
        return {
            "reproduced": False,
            "exit_code": -1,
            "logs": f"Docker API error: {exc}",
        }

    except Exception as exc:
        logger.error("sandbox_unexpected_error", error=str(exc))
        return {
            "reproduced": False,
            "exit_code": -1,
            "logs": f"Unexpected error: {exc}",
        }

    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception:
                pass
        client.close()


def get_optimal_sandbox_concurrency() -> int:
    """Dynamically compute optimal Docker sandbox concurrency based on host CPU cores
    and available memory. Can be overridden via SANDBOX_CONCURRENCY env var.

    Default target: 10 concurrent sandboxes.
    """
    env_c = os.getenv("SANDBOX_CONCURRENCY")
    if env_c:
        try:
            val = int(env_c)
            if val > 0:
                logger.info("sandbox_concurrency_from_env", concurrency=val)
                return val
        except ValueError:
            pass

    try:
        cpus = os.cpu_count() or 4
        avail_ram_gb = 4.0

        # Read available memory from /proc/meminfo on Linux
        if os.path.exists("/proc/meminfo"):
            try:
                with open("/proc/meminfo", "r", encoding="utf-8") as f:
                    for line in f:
                        if "MemAvailable:" in line:
                            mem_kb = int(line.split()[1])
                            avail_ram_gb = mem_kb / (1024 * 1024)
                            break
            except Exception:
                pass
        elif hasattr(os, "sysconf"):
            try:
                pages = os.sysconf("SC_AVPHYS_PAGES")
                page_size = os.sysconf("SC_PAGE_SIZE")
                avail_ram_gb = (pages * page_size) / (1024 ** 3)
            except Exception:
                pass

        cpu_slots = max(2, cpus)
        # With 256MB per container, 1GB RAM can easily host 3-4 containers safely
        ram_slots = max(2, int(avail_ram_gb / 0.3))
        optimal = max(2, min(cpu_slots, ram_slots, 10))
        logger.info(
            "sandbox_concurrency_resolved",
            cpus=cpus,
            avail_ram_gb=round(avail_ram_gb, 2),
            optimal=optimal,
        )
        return optimal
    except Exception as exc:
        logger.warning("sandbox_concurrency_detection_failed", error=str(exc))
        return 10
