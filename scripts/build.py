#!/usr/bin/env python3
"""Build the Zotero plugin from the pinned upstream draw.io web distribution."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
VERSION = "32.7.4"
SHA256 = "caf784637155f444e0b6fb7c154cae5dbad27cfc31cb16286054d43f996be42f"
RELEASE = f"https://github.com/jgraph/drawio/releases/download/v{VERSION}/draw.war"
SOURCE = f"https://raw.githubusercontent.com/jgraph/drawio/v{VERSION}"
ASSET_FOLDERS = {
    "images", "img", "js", "math4", "mxgraph", "resources", "shapes",
    "stencils", "styles", "templates",
}
ASSET_FILES = {"index.html", "favicon.ico", "shortcuts.svg", "export-fonts.css"}
BOOTSTRAP_SOURCES = (
    "settings/options.js", "editor-assets.js", "storage.js", "library-picker.js",
    "zotero-ui.js", "editor-tab.js", "bootstrap.js",
)
EDITOR_CSP = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "
    "frame-src 'none'; form-action 'none'; base-uri 'none'"
)
RELEASE_TAG = re.compile(r"v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))")


def release_version(tag):
    match = RELEASE_TAG.fullmatch(tag)
    if not match:
        raise argparse.ArgumentTypeError("expected a release tag in the form vX.Y.Z")
    return match[1]


def download(url, path):
    if not path.exists():
        temporary = path.with_suffix(".download")
        try:
            with urlopen(url, timeout=60) as source, temporary.open("wb") as target:
                shutil.copyfileobj(source, target)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path


def add(package, name, data):
    package.writestr(ZipInfo(name), data, compress_type=ZIP_DEFLATED)


def build(version=None):
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    upstream = download(RELEASE, cache / f"draw-{VERSION}.war")
    with upstream.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != SHA256:
            raise SystemExit(f"Incorrect SHA-256. Remove {upstream} and rebuild.")
    license_path = download(f"{SOURCE}/LICENSE", cache / f"draw-{VERSION}.LICENSE")

    plugin = ROOT / "plugin"
    manifest = json.loads((plugin / "manifest.json").read_text())
    if version is not None:
        manifest["version"] = version
    destination = ROOT / "dist" / f"{manifest['name']}-{manifest['version']}.xpi"
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    try:
        with ZipFile(temporary, "w") as package, ZipFile(upstream) as editor:
            add(package, "LICENSE", (ROOT / "LICENSE").read_bytes())
            add(package, "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
            for file in sorted(plugin.rglob("*")):
                name = file.relative_to(plugin).as_posix()
                if file.is_file() and name != "manifest.json" and (
                    name not in BOOTSTRAP_SOURCES or name == "settings/options.js"
                ):
                    add(package, name, file.read_bytes())
            add(package, "bootstrap.js", b"\n\n".join(
                (plugin / name).read_bytes() for name in BOOTSTRAP_SOURCES
            ))
            for name in sorted(editor.namelist()):
                path = PurePosixPath(name)
                if name.endswith(("/", ".map")) or ".." in path.parts:
                    continue
                if name not in ASSET_FILES and path.parts[0] not in ASSET_FOLDERS:
                    continue
                data = editor.read(name)
                if name == "index.html":
                    policy = f'<meta http-equiv="Content-Security-Policy" content="{EDITOR_CSP}">'.encode()
                    data = data.replace(b'<meta charset="utf-8">', b'<meta charset="utf-8">\n    ' + policy, 1)
                    data = data.replace(b'<script src="js/main.js"></script>',
                        b'<link rel="stylesheet" href="styles/zotero-library.css">\n'
                        b'<script src="js/main.js"></script>', 1)
                if name == "js/bootstrap.js":
                    # Install the Zotero integrations before draw.io starts.
                    original = b"mxScriptsLoaded = true;\n                checkAllLoaded();"
                    replacement = (
                        b"mxscript('js/zotero-snapshot.js', function() {\n"
                        b"                    mxscript('js/zotero-library.js', function() {\n"
                        b"                        mxScriptsLoaded = true;\n"
                        b"                        checkAllLoaded();\n"
                        b"                    });\n"
                        b"                });"
                    )
                    if data.count(original) != 1:
                        raise ValueError("The pinned draw.io bootstrap entry point has changed")
                    data = data.replace(original, replacement)
                add(package, f"editor/{name}", data)
            add(package, "editor/js/zotero-snapshot.js", (ROOT / "scripts/drawio-snapshot.js").read_bytes())
            add(package, "editor/js/zotero-library.js", (ROOT / "scripts/drawio-library.js").read_bytes())
            add(package, "editor/styles/zotero-library.css", (ROOT / "scripts/drawio-library.css").read_bytes())
            add(package, "editor/LICENSE", license_path.read_bytes())
            add(package, "editor/UPSTREAM.txt", (
                f"draw.io {VERSION}\n{RELEASE}\n"
                "index.html has an offline content policy. js/bootstrap.js loads the Zotero integrations.\n"
                "This plugin is independent of the draw.io project.\n"
            ).encode())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-tag", type=release_version, metavar="vX.Y.Z",
                        help="set the packaged plugin version from a Git release tag")
    build(parser.parse_args().release_tag)
