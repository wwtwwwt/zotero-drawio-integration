#!/usr/bin/env python3
"""Exercise the packaged plugin in two Zotero launches with a disposable library."""

import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import time
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "plugin/manifest.json").read_text())
XPI = Path(os.environ.get("ZOTERO_XPI", ROOT / "dist" / f"{MANIFEST['name']}-{MANIFEST['version']}.xpi"))
ZOTERO = os.environ.get("ZOTERO_BINARY", "/Applications/Zotero.app/Contents/MacOS/zotero")


def blank_pdf():
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, content in enumerate((
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> >>",
    ), start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n{content}\nendobj\n".encode())
    xref = len(pdf)
    pdf.extend(b"xref\n0 4\n0000000000 65535 f \n")
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return pdf


def prepare(profile):
    name = MANIFEST["applications"]["zotero"]["id"] + ".xpi"
    extensions = profile / "extensions"
    extensions.mkdir()
    (profile / "data").mkdir()
    (profile / "native-reader-test.pdf").write_bytes(blank_pdf())
    prefs = {
        "extensions.autoDisableScopes": 0,
        "extensions.zotero.useDataDir": True,
        "extensions.zotero.dataDir": str(profile / "data"),
        "extensions.zotero.firstRun2": False,
        "extensions.zotero.firstRunGuidanceShown.zotero": True,
        "extensions.zotero.httpServer.enabled": False,
        "network.proxy.type": 1,
        "network.proxy.http": "127.0.0.1",
        "network.proxy.http_port": 1,
        "network.proxy.ssl": "127.0.0.1",
        "network.proxy.ssl_port": 1,
    }
    (profile / "user.js").write_text("".join(
        f"user_pref({json.dumps(key)}, {json.dumps(value)});\n" for key, value in prefs.items()
    ))
    graph_probe = b"""
const initializeTestEditor = EditorUi.prototype.initializeEmbedMode;
EditorUi.prototype.initializeEmbedMode = function () {
  window.zoteroDiagramTestUI = this;
  return initializeTestEditor.apply(this, arguments);
};
"""
    with ZipFile(XPI) as built, ZipFile(extensions / name, "w") as test:
        for entry in built.infolist():
            data = built.read(entry)
            if entry.filename == "bootstrap.js":
                data += b"\n\n" + (ROOT / "test/smoke.js").read_bytes()
            if entry.filename == "editor/js/zotero-snapshot.js":
                data += graph_probe
            test.writestr(entry, data)


def run(profile):
    result = profile / "smoke.log"
    result.unlink(missing_ok=True)
    runtime = profile / "zotero.log"
    with runtime.open("w") as output:
        process = subprocess.Popen(
            [ZOTERO, "--new-instance", "--headless", "--profile", str(profile)],
            stdout=output, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 65
            while time.monotonic() < deadline and process.poll() is None:
                message = result.read_text() if result.exists() else ""
                if message.endswith("DONE\n"):
                    print(message.removesuffix("DONE\n"), end="", flush=True)
                    if "\nFAIL " in "\n" + message:
                        raise SystemExit("Zotero smoke test failed\n" + runtime.read_text()[-6000:])
                    return
                time.sleep(0.25)
            message = result.read_text() if result.exists() else ""
            raise SystemExit("Zotero smoke test timed out or exited\n" + message + runtime.read_text()[-6000:])
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    with TemporaryDirectory(prefix="zotero-diagram-test-") as path:
        profile = Path(path)
        prepare(profile)
        run(profile)
        run(profile)
