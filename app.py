#!/usr/bin/env python3
# Run the Map Content Manager from the repository root.

# The manager is intentionally local-only. This server exposes a very small file API to the
# manager UI so it can read/write files inside the repository.

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import mimetypes
import os
import socket
import secrets
import shutil
import tempfile
import zipfile
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
API_PREFIX = "/__manager__"
API_TOKEN = secrets.token_urlsafe(24)
TEMP_WORKSPACE = tempfile.TemporaryDirectory(prefix="map-manager-stage-")
TEMP_ROOT = Path(TEMP_WORKSPACE.name)


def choose_port(preferred: int = 8000) -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        try:
            sock.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]


def repository_is_valid() -> bool:
    return (ROOT / "data" / "catalog.js").is_file() and (ROOT / "images").is_dir()


def _safe_relative_path(raw_path: str) -> Path:
    rel = unquote(raw_path or "").replace("\\", "/").lstrip("/")
    if not rel:
        raise ValueError("Missing repository path.")
    relative = Path(rel)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Path is outside the repository.")
    return relative


def safe_temp_path(raw_path: str) -> Path:
    relative = _safe_relative_path(raw_path)
    candidate = (TEMP_ROOT / relative).resolve()
    try:
        candidate.relative_to(TEMP_ROOT.resolve())
    except ValueError as exc:
        raise ValueError("Path is outside the temporary workspace.") from exc
    return candidate


def safe_repo_path(raw_path: str) -> Path:
    """Resolve a user-supplied repository-relative path and prevent path traversal."""
    relative = _safe_relative_path(raw_path)
    candidate = (ROOT / relative).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError as exc:
        raise ValueError("Path is outside the repository.") from exc
    return candidate


def _xlsx_column_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in (cell_ref or "") if ch.isalpha()).upper()
    if not letters:
        return 0
    value = 0
    for ch in letters:
        if not ("A" <= ch <= "Z"):
            break
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return max(0, value - 1)


def parse_xlsx_rows(data: bytes, *, max_rows: int = 10000, max_columns: int = 256) -> list[list[str]]:
    try:
        workbook = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("The selected file is not a valid .xlsx workbook.") from exc

    with workbook:
        names = set(workbook.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("The workbook is missing xl/workbook.xml.")

        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for item in root.findall("a:si", ns):
                shared_strings.append("".join(node.text or "" for node in item.findall(".//a:t", ns)))

        workbook_root = ET.fromstring(workbook.read("xl/workbook.xml"))
        main_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        first_sheet = workbook_root.find(f".//{{{main_ns}}}sheet")
        if first_sheet is None:
            raise ValueError("Excel file has no worksheets.")
        rel_id = first_sheet.attrib.get(f"{{{rel_ns}}}id")
        if not rel_id:
            raise ValueError("Could not locate the first worksheet.")

        rel_path = "xl/_rels/workbook.xml.rels"
        if rel_path not in names:
            raise ValueError("Workbook relationships are missing.")
        rel_root = ET.fromstring(workbook.read(rel_path))
        target = None
        for rel in rel_root:
            if rel.attrib.get("Id") == rel_id:
                target = rel.attrib.get("Target")
                break
        if not target:
            raise ValueError("Could not resolve the first worksheet.")
        target = target.replace("\\", "/").lstrip("/")
        sheet_path = target if target.startswith("xl/") else f"xl/{target}"
        # Relationship targets may contain ../ segments. Normalize without allowing escape from xl/.
        parts: list[str] = []
        for part in sheet_path.split("/"):
            if part in ("", "."):
                continue
            if part == "..":
                if parts:
                    parts.pop()
                continue
            parts.append(part)
        sheet_path = "/".join(parts)
        if not sheet_path.startswith("xl/") or sheet_path not in names:
            raise ValueError("Could not read the first worksheet data.")

        sheet_root = ET.fromstring(workbook.read(sheet_path))
        ns = {"a": main_ns}
        rows: list[list[str]] = []
        for row_number, row in enumerate(sheet_root.findall(".//a:sheetData/a:row", ns), start=1):
            if row_number > max_rows:
                raise ValueError(f"Excel worksheet exceeds the supported {max_rows:,}-row limit.")
            values: list[str] = []
            for cell in row.findall("a:c", ns):
                index = _xlsx_column_index(cell.attrib.get("r", ""))
                if index >= max_columns:
                    continue
                while len(values) <= index:
                    values.append("")
                cell_type = cell.attrib.get("t", "")
                value_node = cell.find("a:v", ns)
                if cell_type == "inlineStr":
                    text = "".join(node.text or "" for node in cell.findall(".//a:t", ns))
                elif value_node is None:
                    text = ""
                else:
                    raw = value_node.text or ""
                    if cell_type == "s":
                        try:
                            text = shared_strings[int(raw)]
                        except (ValueError, IndexError):
                            text = raw
                    elif cell_type == "b":
                        text = "TRUE" if raw == "1" else "FALSE"
                    else:
                        text = raw
                values[index] = text
            rows.append(values)
        return rows


class ManagerRequestHandler(SimpleHTTPRequestHandler):
    server_version = "MapManagerLocal/3.0"

    def _send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _query_path(self) -> Path:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        return safe_repo_path(query.get("path", [""])[0])

    def _query_temp_path(self) -> Path:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        return safe_temp_path(query.get("path", [""])[0])

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler name
        parsed = urlparse(self.path)
        if parsed.path == f"{API_PREFIX}/info":
            self._send_json({
                "ok": True,
                "repositoryName": ROOT.name,
                "validRepository": repository_is_valid(),
                "apiToken": API_TOKEN,
            })
            return

        if parsed.path == f"{API_PREFIX}/file":
            try:
                path = self._query_path()
                if not path.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                    return
                data = path.read_bytes()
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except ValueError as exc:
                self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
            except OSError as exc:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
            return

        if parsed.path == f"{API_PREFIX}/stat":
            try:
                path = self._query_path()
                if not path.is_file():
                    self._send_json({"ok": False, "exists": False}, HTTPStatus.NOT_FOUND)
                    return
                stat = path.stat()
                query = parse_qs(parsed.query)
                payload = {
                    "ok": True,
                    "exists": True,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "path": path.relative_to(ROOT).as_posix(),
                }
                if query.get("hash", ["0"])[0] == "1":
                    digest = hashlib.sha256()
                    with path.open("rb") as source:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            digest.update(chunk)
                    payload["sha256"] = digest.hexdigest()
                self._send_json(payload)
            except ValueError as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except OSError as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == f"{API_PREFIX}/list":
            try:
                directory = self._query_path()
                if not directory.exists():
                    self._send_json({"ok": True, "files": []})
                    return
                if not directory.is_dir():
                    raise ValueError("List path must be a directory.")
                files = []
                for child in sorted(directory.rglob("*")):
                    if child.is_file():
                        stat = child.stat()
                        files.append({
                            "path": child.relative_to(ROOT).as_posix(),
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                        })
                self._send_json({"ok": True, "files": files})
            except ValueError as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except OSError as exc:
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler name
        parsed = urlparse(self.path)
        allowed = {
            f"{API_PREFIX}/write", f"{API_PREFIX}/delete",
            f"{API_PREFIX}/temp/write", f"{API_PREFIX}/temp/apply",
            f"{API_PREFIX}/temp/delete", f"{API_PREFIX}/temp/clear",
            f"{API_PREFIX}/excel/parse",
        }
        if parsed.path not in allowed:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            if self.headers.get("X-Manager-Token") != API_TOKEN:
                self._send_json({"ok": False, "error": "Invalid manager token."}, HTTPStatus.FORBIDDEN)
                return

            if parsed.path == f"{API_PREFIX}/excel/parse":
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0:
                    raise ValueError("Excel upload is empty.")
                if length > 25 * 1024 * 1024:
                    raise ValueError("Excel workbook is larger than the supported 25 MB limit.")
                rows = parse_xlsx_rows(self.rfile.read(length))
                self._send_json({"ok": True, "rows": rows})
                return

            if parsed.path == f"{API_PREFIX}/temp/clear":
                for child in list(TEMP_ROOT.iterdir()):
                    if child.is_dir():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        with contextlib.suppress(FileNotFoundError):
                            child.unlink()
                self._send_json({"ok": True})
                return

            if parsed.path.startswith(f"{API_PREFIX}/temp/"):
                temp_path = self._query_temp_path()
                query = parse_qs(parsed.query)
                repo_raw_path = query.get("path", [""])[0]

                if parsed.path.endswith("/delete"):
                    with contextlib.suppress(FileNotFoundError):
                        temp_path.unlink()
                    self._send_json({"ok": True})
                    return

                if parsed.path.endswith("/apply"):
                    if not temp_path.is_file():
                        raise ValueError("Temporary staged file no longer exists.")
                    repo_path = safe_repo_path(repo_raw_path)
                    repo_path.parent.mkdir(parents=True, exist_ok=True)
                    fd, final_temp_name = tempfile.mkstemp(prefix=f".{repo_path.name}.", dir=repo_path.parent)
                    os.close(fd)
                    try:
                        shutil.copyfile(temp_path, final_temp_name)
                        with open(final_temp_name, "rb+") as final_temp_file:
                            final_temp_file.flush()
                            os.fsync(final_temp_file.fileno())
                        os.replace(final_temp_name, repo_path)
                        temp_path.unlink()
                    finally:
                        with contextlib.suppress(FileNotFoundError):
                            os.unlink(final_temp_name)
                    self._send_json({"ok": True})
                    return

                # temp/write: persist the prepared file outside the repository.
                length = int(self.headers.get("Content-Length", "0"))
                data = self.rfile.read(length)
                temp_path.parent.mkdir(parents=True, exist_ok=True)
                fd, temp_name = tempfile.mkstemp(prefix=f".{temp_path.name}.", dir=temp_path.parent)
                try:
                    with os.fdopen(fd, "wb") as temp_file:
                        temp_file.write(data)
                        temp_file.flush()
                        os.fsync(temp_file.fileno())
                    os.replace(temp_name, temp_path)
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(temp_name)
                self._send_json({"ok": True, "temporary": True, "size": len(data)})
                return

            path = self._query_path()
            if parsed.path.endswith("/delete"):
                if path.exists():
                    if path.is_dir():
                        raise ValueError("The manager only deletes files, not directories.")
                    path.unlink()
                self._send_json({"ok": True})
                return

            length = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(length)
            path.parent.mkdir(parents=True, exist_ok=True)

            # Atomic replacement keeps catalog/images from being left half-written if the
            # process is interrupted during a save.
            fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
            try:
                with os.fdopen(fd, "wb") as temp_file:
                    temp_file.write(data)
                    temp_file.flush()
                    os.fsync(temp_file.fileno())
                os.replace(temp_name, path)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(temp_name)

            self._send_json({"ok": True})
        except ValueError as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except OSError as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def log_message(self, fmt: str, *args: object) -> None:
        # Keep the console useful without logging every successful image/SVG request.
        if args and str(args[1]).startswith("2"):
            return
        super().log_message(fmt, *args)


def main() -> None:
    os.chdir(ROOT)
    port = choose_port()
    url = f"http://127.0.0.1:{port}/manager/"
    server = ThreadingHTTPServer(("127.0.0.1", port), ManagerRequestHandler)
    threading.Timer(0.35, lambda: webbrowser.open(url)).start()

    print(f"Repository: {ROOT}")
    if not repository_is_valid():
        print("WARNING: expected data/catalog.js and images/ beside start_manager.py.")
    print(f"Map Content Manager: {url}")
    print("Press Ctrl+C to stop the local server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
