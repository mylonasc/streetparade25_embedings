#!/usr/bin/env python3
"""Dynamic context extractor for the fe-visualizer UI skill.

Reads the *current* state of the code and prints the facts SKILL.md depends on
(components, App state, API endpoints, backend routes, styles, breakpoints,
tests, build flags) as Markdown. Nothing about the UI is hardcoded in the skill
without a way to re-derive it from this script.

Drift detection
---------------
Every expected source is listed below with "anchors": regexes that must appear
in that file. Each file read is wrapped in exception handling. Two failure
classes are recorded:

  MISSING      the file does not exist (or is unreadable / not valid JSON etc.)
  ANCHOR_LOST  the file exists but no longer contains an expected anchor

Either is a *skill-to-repo drift signal*: the skill's assumptions about the
code no longer hold. The script keeps extracting everything else, prints a
DRIFT REPORT, and exits 1. On a drift failure the agent MUST update this script
(and the SKILL.md prose it backs) to match the new structure, then re-run until
the script exits 0.

Usage
-----
    python3 .opencode/skills/fe-visualizer-ui/scripts/extract_visualizer_context.py [--repo PATH]

`--repo` overrides the repo root (default: nearest ancestor of this script that
contains `.git`). Output is Markdown on stdout. Exit code 0 = all required
sources healthy; 1 = drift detected.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------
# drift tracking
# --------------------------------------------------------------------------


@dataclass
class Source:
    rel: str
    label: str
    anchors: list[str] = field(default_factory=list)
    status: str = "OK"
    detail: str = ""

    def check(self, root: Path) -> str | None:
        """Return the text if the source is healthy, else record the failure."""
        path = root / self.rel
        if not path.is_file():
            self.status = "MISSING"
            self.detail = f"{self.rel} does not exist"
            return None
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            self.status = "MISSING"
            self.detail = f"{self.rel} unreadable: {exc}"
            return None
        if self.rel.endswith(".json"):
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                self.status = "MISSING"
                self.detail = f"{self.rel} invalid JSON: {exc}"
                return None
        for anchor in self.anchors:
            if re.search(anchor, text) is None:
                self.status = "ANCHOR_LOST"
                self.detail = f"{self.rel} lost anchor /{anchor}/"
                return None
        return text


# --------------------------------------------------------------------------
# required sources (the drift manifest)
# --------------------------------------------------------------------------

REQUIRED_SOURCES: list[Source] = [
    Source("fe-visualizer/package.json", "package.json",
           [r'"name"\s*:\s*"streetparade-visualizer"', r'"scripts"', r'"typecheck"']),
    Source("fe-visualizer/src/main.tsx", "main.tsx", [r"createRoot", r"App"]),
    Source("fe-visualizer/index.html", "index.html", [r'id="root"', r"main\.tsx"]),
    Source("fe-visualizer/src/App.tsx", "App.tsx",
           [r"export function App", r"useMobileViewport", r"VISUALIZATION_CACHE_VERSION\s*=",
            r"VITE_ENABLE_SONG_DL_AND_EMBEDINGS"]),
    Source("fe-visualizer/src/api.ts", "api.ts",
           [r"API_BASE_URL", r"resolveApiBaseUrl", r"export async function request"]),
    Source("fe-visualizer/src/types.ts", "types.ts",
           [r"export type Point\b", r"export type PointKind", r"export type PreferenceValue"]),
    Source("fe-visualizer/src/responsive.ts", "responsive.ts",
           [r"useMobileViewport", r"max-width:\s*979px"]),
    Source("fe-visualizer/src/styles.css", "styles.css",
           [r":root", r"--accent", r"--sheet-peek", r"z-index", r"@media\s*\(max-width:\s*979px\)"]),
    Source("fe-visualizer/src/BottomSheet.tsx", "BottomSheet.tsx",
           [r"selection-panel", r"selection-title", r"sheet-minimize-toggle"]),
    Source("fe-visualizer/src/components/Visualizer.tsx", "Visualizer.tsx", [r"export function Visualizer"]),
    Source("fe-visualizer/src/components/Selection.tsx", "Selection.tsx", [r"export function Selection"]),
    Source("fe-visualizer/src/components/Panels.tsx", "Panels.tsx",
           [r"PreferenceTrainingPanel", r"ArtistFavoritesPanel", r"UsernameGate"]),
    Source("fe-visualizer/src/components/Modals.tsx", "Modals.tsx",
           [r"LayoutModal", r"HelpModal", r"TrainModelPrompt"]),
    Source("fe-visualizer/src/Tooltip.tsx", "Tooltip.tsx", [r"TooltipContent"]),
    Source("fe-visualizer/src/tooltipPosition.ts", "tooltipPosition.ts", [r"computeTooltipPosition"]),
    Source("fe-visualizer/src/search.ts", "search.ts", [r"buildSearchIndex", r"searchResults"]),
    Source("fe-visualizer/src/selection.ts", "selection.ts",
           [r"preferenceTarget", r"preferenceKeyForPoint", r"playlistForPoint"]),
    Source("fe-visualizer/src/layoutOptions.ts", "layoutOptions.ts",
           [r"DEFAULT_LAYOUT_OPTIONS", r"layoutPayload"]),
    Source("fe-visualizer/src/storage.ts", "storage.ts",
           [r"USERNAME_KEY", r"MARKS_KEY", r"safeGetItem"]),
    Source("fe-visualizer/src/preferenceTraining.ts", "preferenceTraining.ts",
           [r"trainPreferenceModel", r"loadPreferenceModel", r"hasSavedPreferenceModel"]),
    Source("fe-visualizer/vite.config.ts", "vite.config.ts", [r"defineConfig", r"VITE_BASE_PATH"]),
    Source("fe-visualizer/tsconfig.json", "tsconfig.json", [r'"strict"\s*:\s*true']),
    Source("fe-visualizer/Dockerfile", "Dockerfile",
           [r"ARG VITE_API_BASE_URL", r"ARG VITE_BASE_PATH", r"VITE_ENABLE_SONG_DL_AND_EMBEDINGS"]),
    Source("src/streetparade_embeddings/api.py", "backend api.py",
           [r"ENABLE_SONG_DL_AND_EMBEDINGS", r"create_app", r"include_router"]),
    Source("src/streetparade_embeddings/routes/catalog.py", "backend routes/catalog.py", [r"APIRouter\("]),
    Source("src/streetparade_embeddings/routes/users.py", "backend routes/users.py", [r"APIRouter\("]),
    Source("src/streetparade_embeddings/routes/jobs.py", "backend routes/jobs.py", [r"APIRouter\("]),
    Source("e2e/package.json", "e2e package.json", [r"@playwright/test"]),
    Source("e2e/playwright.config.js", "playwright.config.js", [r"webServer"]),
    Source("e2e/seed-layout.py", "seed-layout.py", [r"SEED_CLUSTERS"]),
    Source("e2e/streetparade-quality.spec.js", "quality spec", [r"test\(", r"OVERLAP_GROUPS"]),
    Source("e2e/streetparade-mobile.spec.js", "mobile spec", [r"test\("]),
    Source("e2e/streetparade-layout.spec.js", "layout spec", [r"test\("]),
]

# --------------------------------------------------------------------------
# small extraction helpers
# --------------------------------------------------------------------------


def try_json(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:
        return {}


def match_uses(text: str, pattern: str) -> list[str]:
    return list(dict.fromkeys(m.group(1) for m in re.finditer(pattern, text)))


def balanced_request_calls(text: str) -> list[str]:
    """Return the argument strings of every `request<T>(...)` call."""
    calls: list[str] = []
    for m in re.finditer(r"(?<!function )request(?:<[^>]*>)?\(", text):
        i = m.end() - 1
        depth = 0
        in_str = None
        while i < len(text):
            ch = text[i]
            if in_str:
                if text[i - 1] != "\\" and ch == in_str:
                    in_str = None
            elif ch in "'\"`":
                in_str = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        calls.append(text[m.end() - 1:i + 1])
    return calls


def request_summary(call: str) -> tuple[str, str]:
    method = "GET"
    mm = re.search(r"method:\s*['\"]([A-Z]+)['\"]", call)
    if mm:
        method = mm.group(1)
    pm = re.search(r"([`'\"])([^`'\"]+)\1", call)
    path = pm.group(2) if pm else "?"
    return method, path


def print_section(title: str) -> None:
    print(f"\n## {title}")


# --------------------------------------------------------------------------
# extraction (each section is defensive: a failure is recorded, not fatal)
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="repo root (default: nearest ancestor with .git)")
    args = parser.parse_args()

    root = Path(args.repo).resolve() if args.repo else find_repo_root()
    print(f"# fe-visualizer context extraction")
    print(f"generated from `{root}`")

    # --- required sources -------------------------------------------------
    print_section("Required-source health")
    for source in REQUIRED_SOURCES:
        source.check(root)

    # --- frontend package --------------------------------------------------
    print_section("Frontend package")
    pkg_text = source_text("fe-visualizer/package.json")
    pkg = try_json(pkg_text or "{}")
    if pkg:
        print(f"- name: `{pkg.get('name')}`")
        print(f"- version: `{pkg.get('version')}`")
        print(f"- type: `{pkg.get('type')}`")
        print("- scripts:")
        for name, script in (pkg.get("scripts") or {}).items():
            print(f"  - `{name}`: `{script}`")
        print("- dependencies:")
        for name, version in (pkg.get("dependencies") or {}).items():
            print(f"  - `{name}` {version}")
        print("- devDependencies:")
        for name, version in (pkg.get("devDependencies") or {}).items():
            print(f"  - `{name}` {version}")

    # --- entry chain -------------------------------------------------------
    print_section("Entry chain")
    main_text = source_text("fe-visualizer/src/main.tsx")
    if main_text:
        root_el = re.search(r"getElementById\(['\"]([^'\"]+)['\"]\)", main_text)
        print(f"- mounts `<App />` into `#{root_el.group(1) if root_el else '?'}`")
        print(f"- imports styles: `{'styles.css' in main_text}`")
    html_text = source_text("fe-visualizer/index.html")
    if html_text:
        scripts = re.findall(r"<script[^>]*src=[\"']([^\"']+)[\"']", html_text)
        print(f"- index.html scripts: {scripts}")

    # --- components ---------------------------------------------------------
    print_section("Component inventory")
    comp_root = root / "fe-visualizer/src"
    tsx_files = sorted(comp_root.rglob("*.tsx")) if comp_root.is_dir() else []
    app_text = source_text("fe-visualizer/src/App.tsx") or ""
    main_text = source_text("fe-visualizer/src/main.tsx") or ""
    src_blob = ""
    for path in sorted(comp_root.rglob("*")):
        if path.suffix in (".ts", ".tsx") and path.is_file():
            src_blob += path.read_text(encoding="utf-8")
    for path in tsx_files:
        rel = path.relative_to(root)
        line_count = len(path.read_text(encoding="utf-8").splitlines()) if path.is_file() else 0
        stem = path.stem
        if str(path) == str(root / "fe-visualizer/src/App.tsx"):
            role = "app root (all state + orchestration)"
        elif str(path) == str(root / "fe-visualizer/src/main.tsx"):
            role = "entry"
        elif re.search(rf"import[^;]*['\"][^'\"]*/{stem}['\"]", src_blob):
            role = "imported by a src component"
        else:
            role = "standalone"
        print(f"- `{path.relative_to(comp_root)}` ({line_count} lines) {role}")

    # --- App state ----------------------------------------------------------
    print_section("App state (useState in App.tsx)")
    if app_text:
        states = re.findall(r"const \[(\w+),\s*\w+\]\s*=\s*useState", app_text)
        for name in states:
            line = next((ln for ln, l in enumerate(app_text.splitlines(), 1)
                         if f"[{name}," in l and "useState" in l), 0)
            print(f"- `{name}` (line {line})")

    # --- frontend API usage --------------------------------------------------
    print_section("Frontend API calls (via request())")
    frontend_sources = [("fe-visualizer/src/App.tsx", app_text),
                        ("fe-visualizer/src/api.ts", source_text("fe-visualizer/src/api.ts") or "")]
    seen: set[tuple[str, str]] = set()
    for rel, text in frontend_sources:
        for call in balanced_request_calls(text or ""):
            method, path = request_summary(call)
            key = (method, path)
            if key in seen:
                continue
            seen.add(key)
            print(f"- `{method} {path}`  (from `{rel}`)")

    # --- API base URL resolution --------------------------------------------
    print_section("API base URL resolution (api.ts)")
    api_text = source_text("fe-visualizer/src/api.ts") or ""
    m = re.search(r"function resolveApiBaseUrl\(\)[^{]*\{([\s\S]*?)\n\}", api_text)
    if m:
        body = m.group(1)
        loopback = re.search(r"return .*:\s*8000", body)
        pathname = re.search(r"return `\$\{pathname\}/api`", body)
        configured = "VITE_API_BASE_URL" in body
        print(f"- loopback host -> `:8000` override: {bool(loopback)}")
        print(f"- other host -> `location.pathname + /api`: {bool(pathname)}")
        print(f"- honours `VITE_API_BASE_URL`: {configured}")

    # --- backend endpoint surface ---------------------------------------------
    print_section("Backend endpoint surface (routes/*.py)")
    for route_file in sorted((root / "src/streetparade_embeddings/routes").glob("*.py")):
        if route_file.name.startswith("_"):
            continue
        text = route_file.read_text(encoding="utf-8")
        for rm in re.finditer(r"@router\.(get|post|put|delete|patch)\([\"']([^\"']+)[\"']", text):
            print(f"- `{rm.group(1).upper()} {rm.group(2)}`  ({route_file.name})")

    # --- feature flags ---------------------------------------------------------
    print_section("Feature flags")
    backend_api = source_text("src/streetparade_embeddings/api.py") or ""
    fm = re.search(r"raw = os\.environ\.get\([\"']ENABLE_SONG_DL_AND_EMBEDINGS[\"'],\s*[\"']([^\"']+)[\"']\)", backend_api)
    print(f"- backend `ENABLE_SONG_DL_AND_EMBEDINGS` default: `{fm.group(1) if fm else '?'}` "
          f"(off values: \"0\"/\"false\"/\"no\"/\"off\"/\"\")")
    fr = re.search(r"VITE_ENABLE_SONG_DL_AND_EMBEDINGS\s*[!=]==?\s*['\"]([^'\"]+)['\"]", app_text or "")
    print(f"- frontend `VITE_ENABLE_SONG_DL_AND_EMBEDINGS` off-test literal: `{fr.group(1) if fr else '?'}`")

    # --- types contract ----------------------------------------------------------
    print_section("Point contract (types.ts)")
    types_text = source_text("fe-visualizer/src/types.ts") or ""
    pk = re.search(r"export type PointKind\s*=\s*([^\n;]+)", types_text)
    if pk:
        print(f"- `PointKind`: {pk.group(1).strip()}")
    for field_name in ["id", "kind", "label", "x", "y", "cluster", "metadata"]:
        fm = re.search(rf"^\s*{field_name}\s*:[^;]+;", types_text, re.MULTILINE)
        if fm:
            print(f"- `Point.{field_name}`: `{fm.group(0).strip()}`")
    pref = re.search(r"export type PreferenceValue\s*=\s*([^\n;]+)", types_text)
    if pref:
        print(f"- `PreferenceValue`: {pref.group(1).strip()}")

    # --- responsive / styles ------------------------------------------------------
    print_section("Responsive & styles (styles.css)")
    css_text = source_text("fe-visualizer/src/styles.css") or ""
    vars_ = re.findall(r"--([\w-]+):\s*([^;]+);", css_text.split("@media")[0])
    if vars_:
        print("- CSS variables:")
        for name, value in vars_[:40]:
            print(f"  - `--{name}`: `{value.strip()}`")
    media = re.findall(r"@media\s*([^{]+)\{", css_text)
    print(f"- media queries: {[m.strip() for m in media]}")
    mobile_css = "max-width: 979px" in css_text
    desktop_css = "min-width: 980px" in css_text
    print(f"- mobile breakpoint present (max-width:979px): {mobile_css}; desktop (min-width:980px): {desktop_css}")
    zindex = re.findall(r"([^{}\n]+)\{[^}]*z-index:\s*(\d+);", css_text)
    if zindex:
        print("- z-index declarations:")
        for selector, value in zindex:
            print(f"  - `{selector.strip()}` -> {value}")

    # --- cache / training keys -------------------------------------------------------
    print_section("Storage keys & cache")
    cache = re.search(r"VISUALIZATION_CACHE_VERSION\s*=\s*(\d+)", app_text or "")
    if cache:
        print(f"- visualization cache version: `{cache.group(1)}` (key prefix `streetparade-visualization-v{cache.group(1)}:<user>`)")
    storage_text = source_text("fe-visualizer/src/storage.ts") or ""
    for key in re.findall(r"export const \w+\s*=\s*['\"]([^'\"]+)['\"]", storage_text):
        print(f"- storage key: `{key}`")
    pt_text = source_text("fe-visualizer/src/preferenceTraining.ts") or ""
    meta = re.search(r"MODEL_META_KEY\s*=\s*['\"]([^'\"]+)['\"]", pt_text or "")
    if meta:
        print(f"- preference model meta key: `{meta.group(1)}`")

    # --- tests -------------------------------------------------------------------------
    print_section("Tests")
    vitest_files = sorted(comp_root.glob("*.test.ts")) if comp_root.is_dir() else []
    print(f"- vitest unit files: {[p.name for p in vitest_files]}")
    for spec in sorted((root / "e2e").glob("*.spec.js")):
        spec_text = spec.read_text(encoding="utf-8")
        count = len(re.findall(r"(?<!\.)\btest\(", spec_text))
        devices = re.findall(r"\{\s*name:\s*['\"]([^'\"]+)['\"]\s*,\s*slug:", spec_text)
        print(f"- `{spec.name}`: {count} test(s)" + (f", devices {devices}" if devices else ""))

    # --- build / deploy --------------------------------------------------------------------
    print_section("Build & deploy")
    docker_text = source_text("fe-visualizer/Dockerfile") or ""
    print("- Dockerfile ARGs:")
    for arg in re.findall(r"ARG (\w+)=?([^\s]*)", docker_text):
        print(f"  - `{arg[0]}` (default `{arg[1] or ''}`)")
    vite_text = source_text("fe-visualizer/vite.config.ts") or ""
    base = re.search(r"base:\s*(?:process\.env\.VITE_BASE_PATH\s*\|\|\s*)?([^,\n]+)", vite_text)
    print(f"- vite base: `{base.group(1).strip() if base else '?'}` (kept relative/path-agnostic)")

    # --- drift report -----------------------------------------------------------------------
    print_section("DRIFT REPORT")
    failures = [s for s in REQUIRED_SOURCES if s.status != "OK"]
    if not failures:
        print("all required sources healthy: no skill-to-repo drift detected")
        return 0
    for source in failures:
        print(f"- **{source.status}** {source.label}: {source.detail}")
    print()
    print("DRIFT DETECTED: this script (and the SKILL.md prose it backs) must be updated")
    print("to match the current code, then re-run until it exits 0.")
    return 1


def find_repo_root() -> Path:
    current = Path(__file__).resolve().parent
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    print("error: could not locate repo root (no .git ancestor found)", file=sys.stderr)
    raise SystemExit(2)


def source_text(rel: str) -> str | None:
    """Return the text of a non-required source, or None if it is unavailable."""
    for source in REQUIRED_SOURCES:
        if source.rel == rel:
            return source_text_from(source)
    path = find_repo_root() / rel
    if not path.is_file():
        print(f"note: optional source `{rel}` not found", file=sys.stderr)
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"note: could not read `{rel}`: {exc}", file=sys.stderr)
        return None


def source_text_from(source: Source) -> str | None:
    # re-read; required sources already validated
    path = find_repo_root() / source.rel
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
