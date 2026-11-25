#!/usr/bin/env python3
"""Generate Zotero's update manifest from the XPI being published."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile

from build import release_version


def build_update_manifest(package, repository, version):
    releases = f"https://github.com/{repository}/releases"
    feed_url = f"{releases}/latest/download/updates.json"

    with ZipFile(package) as xpi:
        manifest = json.loads(xpi.read("manifest.json"))
    zotero = manifest["applications"]["zotero"]
    if manifest["version"] != version:
        raise SystemExit(f"XPI version {manifest['version']} does not match release tag v{version}")
    if zotero["update_url"] != feed_url:
        raise SystemExit(f"XPI update_url must point to {feed_url}")

    with package.open("rb") as file:
        checksum = hashlib.file_digest(file, "sha256").hexdigest()
    update = {
        "version": manifest["version"],
        "update_link": f"{releases}/download/v{version}/{quote(package.name, safe='')}",
        "update_hash": f"sha256:{checksum}",
        "applications": {
            "zotero": {
                "strict_min_version": zotero["strict_min_version"],
                "strict_max_version": zotero["strict_max_version"],
            }
        },
    }
    feed = {"addons": {zotero["id"]: {"updates": [update]}}}
    destination = package.with_name("updates.json")
    destination.write_text(json.dumps(feed, indent=2) + "\n", encoding="utf-8")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--repo", required=True, metavar="OWNER/REPO")
    parser.add_argument("--tag", required=True, type=release_version, metavar="vX.Y.Z")
    args = parser.parse_args()
    print(build_update_manifest(args.package, args.repo, args.tag))
