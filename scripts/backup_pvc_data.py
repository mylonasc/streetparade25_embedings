from __future__ import annotations

"""Snapshot the SQLite database + vector store from a deployed SP26 API PVC.

The live and test deployments keep their runtime data on a PersistentVolumeClaim
mounted at ``/data`` in the API pod:

- ``streetparade_embeddings.sqlite3`` (SQLite metadata DB, WAL mode)
- ``vectorstore/`` (NumPy vector store: ``ids.json``, ``metadata.jsonl``, ``vectors.npy``)

A plain ``kubectl cp`` of the ``.sqlite3`` file is *not* safe while the API is
running: the DB is in WAL mode and actively written, so a raw file copy can be
inconsistent or corrupt. This script instead takes a **consistent snapshot with
zero downtime** using SQLite's online backup API (``src.backup(dst)``) executed
inside the running pod, then copies the result out:

1. Resolve the API pod for the namespace.
2. ``kubectl exec`` a small Python program that runs ``PRAGMA``-safe online
   backup of the DB and copies ``vectorstore/`` into a temp dir in the pod.
3. ``kubectl cp`` the temp dir into a local output directory.
4. Run ``PRAGMA integrity_check`` on the local copy.
5. Remove the pod temp dir (unless ``--keep``).

Usage::

    uv run python scripts/backup_pvc_data.py                  # prod snapshot
    uv run python scripts/backup_pvc_data.py --dry-run        # show commands
    uv run python scripts/backup_pvc_data.py --namespace sp26-test
    uv run python scripts/backup_pvc_data.py --out /tmp/backup

Requires ``kubectl`` configured for the cluster and Python's ``sqlite3`` module
available in the API pod image (the minimal backend image has it).
"""

import argparse
import datetime
import shlex
import subprocess
import sys
import textwrap
from pathlib import Path

# Python program run inside the pod. Paths come in via environment variables
# (SNAP_SRC_DB, SNAP_SRC_VECTORSTORE, SNAP_DIR) so nothing needs interpolating
# into the heredoc.
_POD_SNAPSHOT_PY = r"""
import os
import shutil
import sqlite3

src_db = os.environ["SNAP_SRC_DB"]
src_vs = os.environ["SNAP_SRC_VECTORSTORE"]
snap_dir = os.environ["SNAP_DIR"]

snap_db = os.path.join(snap_dir, os.path.basename(src_db))
if os.path.isdir(snap_dir):
    shutil.rmtree(snap_dir)
os.makedirs(snap_dir, exist_ok=True)

# Online backup: reads a consistent snapshot even while the API keeps writing,
# and includes everything still in the WAL. Read-only source, no locks held.
src = sqlite3.connect("file:%s?mode=ro" % src_db, uri=True)
dst = sqlite3.connect(snap_db)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()

# Copy the whole vector store directory so extra files survive too.
snap_vs = os.path.join(snap_dir, os.path.basename(src_vs.rstrip("/")))
shutil.copytree(src_vs, snap_vs)

print("snapshot written to %s" % snap_dir)
"""


def run_command(command: list[str], dry_run: bool) -> None:
    """Print a command and run it unless ``dry_run`` is set."""
    print("$ " + shlex.join(command))
    if not dry_run:
        subprocess.run(command, check=True)


def timestamped_out(namespace: str) -> str:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"data-snapshots/{namespace}-{stamp}"


def resolve_api_pod(namespace: str, dry_run: bool) -> str:
    """Find the running API pod for the namespace via its label selector."""
    command = [
        "kubectl", "get", "pod", "-n", namespace,
        "-l", "app.kubernetes.io/component=api",
        "-o", "jsonpath={.items[0].metadata.name}",
    ]
    print("$ " + shlex.join(command))
    if dry_run:
        return "<api-pod>"
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    pod = result.stdout.strip()
    if not pod:
        raise RuntimeError(f"no api pod found in namespace {namespace}")
    return pod


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Snapshot the SQLite DB + vector store from a deployed SP26 API PVC "
            "into a local directory, using a consistent in-pod sqlite3 online "
            "backup so the running deployment is never disturbed."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--namespace",
        default="sp26-emb-live",
        help="Namespace of the deployment to snapshot (prod default, test: sp26-test).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=(
            "Local output directory for the snapshot. "
            "Defaults to data-snapshots/<namespace>-<timestamp>."
        ),
    )
    parser.add_argument(
        "--db-path",
        default="/data/streetparade_embeddings.sqlite3",
        help="Path to the SQLite DB inside the API pod.",
    )
    parser.add_argument(
        "--vectorstore-dir",
        default="/data/vectorstore",
        help="Path to the vector store directory inside the API pod.",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the temporary snapshot directory in the pod after copying out.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the commands without running them.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = args.out or Path(timestamped_out(args.namespace))
    if out_dir.exists() and any(out_dir.iterdir()):
        raise RuntimeError(f"output directory already exists and is not empty: {out_dir}")

    pod = resolve_api_pod(args.namespace, args.dry_run)
    pod_snap_dir = "/tmp/sp26-snapshot"

    # 1. Consistent snapshot inside the pod (online backup + vector store copy).
    exec_cmd = [
        "kubectl", "exec", "-n", args.namespace, pod, "--",
        "env",
        f"SNAP_SRC_DB={args.db_path}",
        f"SNAP_SRC_VECTORSTORE={args.vectorstore_dir}",
        f"SNAP_DIR={pod_snap_dir}",
        "python", "-c", _POD_SNAPSHOT_PY,
    ]
    print("$ " + shlex.join(exec_cmd))
    if not args.dry_run:
        subprocess.run(exec_cmd, check=True, capture_output=True, text=True)

    # 2. Copy the snapshot out of the pod.
    run_command(
        ["kubectl", "cp", "-n", args.namespace, f"{pod}:{pod_snap_dir}/.", f"{out_dir}/"],
        args.dry_run,
    )

    # 3. Verify the local copy with an integrity check.
    verify_cmd = [
        sys.executable, "-c",
        textwrap.dedent(
            """
            import sqlite3, sys
            db = sqlite3.connect(sys.argv[1])
            print("integrity:", db.execute("PRAGMA integrity_check").fetchone()[0])
            """
        ).strip(),
        str(out_dir / "streetparade_embeddings.sqlite3"),
    ]
    print("$ " + shlex.join(verify_cmd))
    if not args.dry_run:
        result = subprocess.run(verify_cmd, check=True, capture_output=True, text=True)
        if "integrity: ok" not in result.stdout:
            raise RuntimeError(f"integrity check failed: {result.stdout}")

    # 4. Clean up the pod temp dir (unless --keep).
    if not args.keep:
        run_command(
            ["kubectl", "exec", "-n", args.namespace, pod, "--", "rm", "-rf", pod_snap_dir],
            args.dry_run,
        )

    if args.dry_run:
        print("dry run: no changes made")
        return

    print(f"snapshot written to {out_dir}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
