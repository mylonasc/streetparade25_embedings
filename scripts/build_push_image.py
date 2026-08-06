from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPOSITORY = "mylonasc/magarathea"

BACKEND_BUILD_ARGS = {
    "API_PROFILE": "minimal",
    "ENABLE_SONG_DL_AND_EMBEDINGS": "0",
    "STREETPARADE_VECTOR_STORE": "numpy",
}

VISUALIZER_PATH_AGNOSTIC_ARGS = {"VITE_BASE_PATH": "./"}

VISUALIZER_PATH_LOCKED_ARGS = {
    "VITE_API_BASE_URL": "/streetparade-navigator-2026/api",
    "VITE_BASE_PATH": "/streetparade-navigator-2026/",
    "VITE_ENABLE_SONG_DL_AND_EMBEDINGS": "false",
}


def backend_version() -> str:
    with (REPO_ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["version"]


def frontend_version() -> str:
    with (REPO_ROOT / "fe-visualizer" / "package.json").open("rb") as handle:
        return json.load(handle)["version"]


def short_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short=12", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def tag_base(env: str, component: str) -> str:
    if env == "test":
        if component == "api":
            return "api-minimal"
        return "visualizer"
    if component == "api":
        return "api-minimal"
    if component == "visualizer-minimal":
        return "visualizer-minimal"
    return "visualizer"


def build_spec(env: str, component: str) -> dict:
    if component == "api":
        return {
            "context": ".",
            "dockerfile": "Dockerfile",
            "build_args": BACKEND_BUILD_ARGS,
        }
    if component == "visualizer-minimal":
        return {
            "context": "fe-visualizer",
            "dockerfile": "fe-visualizer/Dockerfile.navigator2026",
            "build_args": VISUALIZER_PATH_LOCKED_ARGS,
        }
    return {
        "context": "fe-visualizer",
        "dockerfile": "fe-visualizer/Dockerfile",
        "build_args": VISUALIZER_PATH_AGNOSTIC_ARGS,
    }


def resolve_components(env: str, component: str) -> list[str]:
    if component != "all":
        if env == "test" and component == "visualizer-minimal":
            raise ValueError("visualizer-minimal does not exist for the test environment")
        return [component]
    return ["api", "visualizer-minimal", "visualizer"] if env == "prod" else ["api", "visualizer"]


def render_tags(repo: str, base: str, version: str, minor: str, sha: str, env: str) -> list[str]:
    if env == "test":
        suffixes = [version, f"{version}-{sha}"]
    else:
        suffixes = [minor, f"{minor}-{sha}", version, f"{version}-{sha}"]
    return [f"{repo}:{base}-{suffix}" for suffix in suffixes]


def run_command(command: list[str], dry_run: bool) -> None:
    print("$ " + shlex.join(command))
    if not dry_run:
        subprocess.run(command, cwd=REPO_ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the test or prod DockerHub images with the same tags the CI workflows publish."
    )
    parser.add_argument(
        "--env",
        choices=["test", "prod"],
        required=True,
        help="Tag set to build: 'test' (<version> and <version>-<sha>) or 'prod' (<minor>, <minor>-<sha>, <version>, <version>-<sha> plus visualizer-minimal).",
    )
    parser.add_argument(
        "--component",
        choices=["api", "visualizer", "visualizer-minimal", "all"],
        default="all",
        help="Which image(s) to build. visualizer-minimal is prod-only. Default: all.",
    )
    parser.add_argument(
        "--repo",
        default=None,
        help=f"DockerHub repository (default: $DOCKERHUB_REPOSITORY or {DEFAULT_REPOSITORY}).",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push the tags to DockerHub after building. Login first with 'docker login'.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the docker commands without building.",
    )
    args = parser.parse_args()

    repo = args.repo or os.environ.get("DOCKERHUB_REPOSITORY") or DEFAULT_REPOSITORY
    backend = backend_version()
    frontend = frontend_version()
    sha = short_sha()
    components = resolve_components(args.env, args.component)

    print(f"environment: {args.env}")
    print(f"repository : {repo}")
    print(f"versions   : backend={backend}, frontend={frontend}, sha={sha}")
    print()

    for component in components:
        version = backend if component == "api" else frontend
        minor = ".".join(version.split(".")[:2])
        spec = build_spec(args.env, component)
        tags = render_tags(repo, tag_base(args.env, component), version, minor, sha, args.env)
        primary = tags[-1]

        build = ["docker", "build", "-f", spec["dockerfile"], spec["context"], "-t", primary]
        for key, value in spec["build_args"].items():
            build += ["--build-arg", f"{key}={value}"]
        run_command(build, args.dry_run)

        for tag in tags[:-1]:
            run_command(["docker", "tag", primary, tag], args.dry_run)

        if args.push:
            for tag in tags:
                run_command(["docker", "push", tag], args.dry_run)

        print(f"  -> {component}: " + ", ".join(tags))
        print()

    print("done.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
