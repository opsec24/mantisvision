"""Docker sandbox runner for safely executing PoC reproducer scripts."""

from __future__ import annotations

import os
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


def execute_poc_in_sandbox(
    workspace_dir: str,
    timeout_seconds: int = 30,
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

        scan_vol = "newgensast_scan_data"
        if "/data/scans/" in workspace_dir:
            subpath = workspace_dir.split("/data/scans/", 1)[1]
            vol_config = {scan_vol: {"bind": "/data/scans", "mode": "ro"}}
            run_cmd = [
                "sh", "-c",
                f"ln -sfn /data/scans/{subpath} /workspace 2>/dev/null || true; export PYTHONPATH=/data/scans/{subpath}:/workspace:$PYTHONPATH; cd /data/scans/{subpath} && python reproducer.py"
            ]
            work_dir = f"/data/scans/{subpath}"
        else:
            vol_config = {os.path.abspath(workspace_dir): {"bind": "/workspace", "mode": "ro"}}
            run_cmd = ["python", "/workspace/reproducer.py"]
            work_dir = "/workspace"

        container = client.containers.run(
            image="python:3.11-slim",
            command=run_cmd,
            volumes=vol_config,
            network_mode="none",
            mem_limit="1g",
            nano_cpus=1_000_000_000,  # 1 CPU
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
