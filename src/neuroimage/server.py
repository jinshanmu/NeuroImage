"""Loopback viewer with optional explicitly configured local workspace operations."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
import json
import mimetypes
import re
import secrets
import shutil
import threading
import time
from .validation import validate_package
from .structure_search import search_structures
from .coverage import source_coverage, source_details
from .render_cache import RenderCache


def create_server(manifest_paths, web_root, port=8765, *, content_path=None, workspace=None):
    web_root = Path(web_root).resolve()
    if not (web_root / "index.html").is_file():
        raise ValueError("Browser assets are missing. Run npm run build before serving, or install the built wheel.")
    packages, routes, roots, identities = [], {}, {}, {}
    verified_files = {}
    render_catalogs = {}
    gzip_routes = set()
    render_cache = RenderCache(workspace.state_root / "browser-cache" if workspace else Path.home() / ".cache/NeuroImage/browser",
                               minimum_free_gib=workspace.state_floor_gib if workspace else 0)
    registry_lock = threading.RLock()
    verification_lock = threading.Lock()
    token = secrets.token_urlsafe(32) if workspace else None

    def register_package(path, *, allow_existing=True):
        path = Path(path).resolve()
        # Anatomy browsing can revisit one package. Within this process,
        # unchanged files can reuse its completed verification. A replacement,
        # edit, missing asset or path change always returns to full validation.
        with verification_lock:
            previous = verified_files.get(path)
            if allow_existing and previous:
                try:
                    if (previous["stamp"] == file_stamp(previous["files"], path.parent)
                            and previous["browser_stamp"] == file_stamp(previous["browser_files"], render_cache.root)):
                        return previous["key"]
                except (ValueError, OSError):
                    pass
            return verify_and_register(path, allow_existing=allow_existing)

    def file_stamp(files, root):
        result = []
        for file in files:
            resolved = file.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_file():
                raise ValueError("A previously verified package asset moved outside its source directory")
            stat = resolved.stat()
            result.append((str(resolved), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
        return result

    def verify_and_register(path, *, allow_existing):
        started = time.monotonic()
        statistics = {}
        manifest = validate_package(path, cache_policy="reuse", statistics=statistics)
        print(json.dumps({"event": "package-validated", "dataset": manifest.dataset_id,
                          "package_version": manifest.package_version, "seconds": round(time.monotonic() - started, 2),
                          **statistics}), flush=True)
        key = manifest.package_id + "-" + manifest.package_version
        identity = {"package_id": manifest.package_id, "package_version": manifest.package_version,
                    "build_signature": manifest.build["signature"], "space_id": manifest.space.id}
        files = [path, *[path.parent / asset.path for asset in manifest.assets]]
        verified = {"key": key, "files": files, "stamp": file_stamp(files, path.parent)}
        prefix = f"/atlas/{key}/"
        prepared, browser_files = render_cache.prepare(path, manifest)
        cached_files = [file for name, file in browser_files.items() if not name.endswith(".nii")]
        cached_files += [file.with_suffix(file.suffix + ".json") for file in cached_files]
        verified.update(browser_files=cached_files, browser_stamp=file_stamp(cached_files, render_cache.root))
        with registry_lock:
            if key in identities:
                if not allow_existing or identities[key] != identity or routes[prefix + "manifest.json"] != path:
                    raise ValueError("The same package identity was selected more than once or changed")
            else:
                identities[key] = identity
                packages.append({"key": key, "title": manifest.title, "dataset_id": manifest.dataset_id,
                                 "package_version": manifest.package_version, "space": manifest.space.name,
                                 "representation": manifest.representation,
                                 "created_utc": manifest.build.get("created_utc", ""),
                                 "coverage": source_coverage(manifest.dataset_id, [s.model_dump() for s in manifest.structures]),
                                 "detail_coverage": source_details(manifest.dataset_id, [s.model_dump() for s in manifest.structures]),
                                 "manifest_url": prefix + "manifest.json", "base_url": prefix,
                                 "structures": len(manifest.structures)})
            render_catalogs[prefix + "_render.json"] = {"schema_version": "1.0", "assets": prepared}
            routes[prefix + "manifest.json"] = path
            roots[prefix + "manifest.json"] = path.parent
            for asset in manifest.assets:
                routes[prefix + asset.path] = path.parent / asset.path
                roots[prefix + asset.path] = path.parent
            for name, browser_file in browser_files.items():
                routes[prefix + "_render/" + name] = browser_file
                roots[prefix + "_render/" + name] = path.parent if name.endswith(".nii") else render_cache.root
                if name.endswith((".nii", ".ngm")):
                    gzip_routes.add(prefix + "_render/" + name)
            verified_files[path] = verified
        return key

    for path in manifest_paths:
        register_package(path, allow_existing=False)
    if not packages and workspace is None:
        raise ValueError("Select at least one built package with --atlas")
    if workspace:
        workspace.register_package = register_package
    for file in web_root.rglob("*"):
        if file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(web_root):
            routes["/" + file.relative_to(web_root).as_posix()] = file
            roots["/" + file.relative_to(web_root).as_posix()] = web_root
    routes["/"] = web_root / "index.html"
    roots["/"] = web_root
    initial_content, initial_key = None, None
    if content_path is not None:
        from .library import BINDING_BYTES_LIMIT, content_binding
        binding = content_binding(content_path)
        matches = [key for key, identity in identities.items() if all(binding[field] == value for field, value in identity.items())]
        if len(matches) != 1:
            raise ValueError("The selected scene does not match one of the served atlas versions and native spaces")
        initial_key = matches[0]
        # Serve one validated, immutable in-memory snapshot, never its parent directory.
        with Path(content_path).open("rb") as stream:
            initial_content = stream.read(BINDING_BYTES_LIMIT + 1)
        if len(initial_content) > BINDING_BYTES_LIMIT:
            raise ValueError("Selected scene exceeds the 10 MiB limit")
        content = json.loads(initial_content)
        if any(content.get(field) != value for field, value in binding.items()):
            raise ValueError("The selected scene changed while opening")
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        disable_nagle_algorithm = True

        def log_message(self, format, *args):
            if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
                super().log_message(format, *args)

        def do_HEAD(self):
            try:
                self.respond(head=True)
            except (BrokenPipeError, ConnectionResetError):
                pass  # A page change can cancel an otherwise valid response.

        def do_GET(self):
            try:
                self.respond(head=False)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def local_host(self):
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            return self.headers.get("Host", "") in allowed

        def json_response(self, value, *, status=200, head=False):
            payload = json.dumps(value, allow_nan=False).encode()
            self.headers_for(status, len(payload), "application/json")
            if not head:
                self.wfile.write(payload)

        def do_POST(self):
            if workspace is None:
                self.send_error(405, "This viewer service is read-only")
                return
            if (not self.local_host() or self.headers.get("Origin") != "http://" + self.headers.get("Host", "")
                    or not secrets.compare_digest(self.headers.get("X-NeuroImage-Token", ""), token)):
                self.json_response({"error": "Workspace operations require this local page's origin and session token"}, status=403)
                return
            length = self.headers.get("Content-Length", "")
            route = urlsplit(self.path).path
            maximum = 8192
            if not length.isdigit() or not 0 < int(length) <= maximum or self.headers.get_content_type() != "application/json":
                self.json_response({"error": f"Send a JSON request of up to {maximum} bytes"}, status=400)
                return
            try:
                body = json.loads(self.rfile.read(int(length)))
                route = urlsplit(self.path).path
                if route == "/api/workspace/jobs":
                    result = workspace.start(body)
                elif route.startswith("/api/workspace/jobs/") and route.endswith("/cancel") and body == {}:
                    result = workspace.cancel(route.removeprefix("/api/workspace/jobs/").removesuffix("/cancel"))
                else:
                    self.json_response({"error": "Unknown workspace operation"}, status=404)
                    return
                self.json_response(result, status=202)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The operation keeps its persisted result after disconnection.
            except (ValueError, OSError) as error:
                self.json_response({"error": str(error)}, status=400)

        def respond(self, head):
            # Reject foreign Host headers to reduce DNS rebinding on this local-only API.
            if not self.local_host():
                self.send_error(403, "Local host only")
                return
            route = unquote(urlsplit(self.path).path)
            if route == "/api/atlases":
                with registry_lock:
                    api = {"schema_version": "1.0", "atlases": list(packages), "workspace": workspace is not None,
                           "startup": {"atlas_key": initial_key, "content_url": "/api/startup-content"} if initial_content is not None else None}
                self.json_response(api, head=head)
                return
            if workspace and route.startswith("/api/workspace"):
                try:
                    if route == "/api/workspace/session":
                        self.json_response({"session_token": token}, head=head)
                    elif route == "/api/workspace/browse":
                        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                        if query and query != {"refresh": ["1"]}:
                            raise ValueError("Use refresh=1 to refresh local source discovery")
                        self.json_response({**workspace.browse(refresh=bool(query)), "session_token": token}, head=head)
                    elif route.startswith("/api/workspace/atlases/"):
                        from .workspace import package_key
                        key = route.removeprefix("/api/workspace/atlases/")
                        matches = [record for record in workspace.package_records()
                                   if record.get("status") == "available" and package_key(record) == key]
                        if len(matches) != 1:
                            raise ValueError("The bookmarked source package is unavailable. Open its dataset to build or recover that exact version.")
                        self.json_response({"atlas_key": register_package(matches[0]["manifest"])}, head=head)
                    elif route == "/api/workspace":
                        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                        if set(query) - {"jobs_offset"} or any(len(values) != 1 for values in query.values()):
                            raise ValueError("Use one optional operation history offset")
                        self.json_response({**workspace.catalog(jobs_offset=int(query.get("jobs_offset", ["0"])[0])), "session_token": token}, head=head)
                    elif route == "/api/workspace/structures":
                        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                        if set(query) - {"q", "dataset", "module", "offset"} or any(len(values) != 1 for values in query.values()):
                            raise ValueError("Use one anatomy query with optional source, module and page filters")
                        result = search_structures(workspace.data_root, query.get("q", [""])[0],
                                                   dataset=query.get("dataset", [""])[0], module=query.get("module", [""])[0],
                                                   offset=int(query.get("offset", ["0"])[0]))
                        self.json_response(result, head=head)
                    elif route.startswith("/api/workspace/jobs/"):
                        self.json_response(workspace.job_status(route.removeprefix("/api/workspace/jobs/")), head=head)
                    else:
                        self.json_response({"error": "Unknown workspace resource"}, status=404, head=head)
                except (BrokenPipeError, ConnectionResetError):
                    return
                except (ValueError, OSError) as error:
                    self.json_response({"error": str(error)}, status=400, head=head)
                return
            if route == "/api/startup-content" and initial_content is not None:
                self.headers_for(200, len(initial_content), "application/json")
                if not head:
                    self.wfile.write(initial_content)
                return
            if route in render_catalogs:
                self.json_response(render_catalogs[route], head=head)
                return
            with registry_lock:
                file = routes.get(route)
                allowed_root = roots.get(route)
            # Hashed browser files can change after a local frontend rebuild.
            if file is None and route.startswith("/assets/"):
                candidate = web_root / route.lstrip("/")
                if candidate.suffix in (".js", ".css", ".wasm", ".woff", ".woff2"):
                    file, allowed_root = candidate, web_root
            if file is None or not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(allowed_root):
                self.send_error(404, "Not an exposed package asset")
                return
            mime = "application/octet-stream" if file.name.endswith((".nii.gz", ".gii")) else (mimetypes.guess_type(file)[0] or "application/octet-stream")
            stat = file.stat()
            # Revalidate local assets without retransmitting unchanged images or
            # geometry. Metadata includes ctime so replacement is detected even
            # when a caller preserves the original file size and mtime.
            etag = f'"{stat.st_ino:x}-{stat.st_size:x}-{stat.st_mtime_ns:x}-{stat.st_ctime_ns:x}"'
            hashed_asset = re.fullmatch(r"/assets/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|wasm|woff2?)", route)
            cache = "private, max-age=31536000, immutable" if hashed_asset else "private, no-cache"
            matched = self.headers.get("If-None-Match", "").split(",")
            unchanged = any(value.strip().removeprefix("W/") in (etag, "*") for value in matched)
            self.headers_for(304 if unchanged else 200, None if unchanged else stat.st_size, mime,
                             extra={"ETag": etag, "Cache-Control": cache,
                                    **({"Content-Encoding": "gzip"} if route in gzip_routes else {})})
            if unchanged:
                return
            if not head:
                try:
                    with file.open("rb") as stream:
                        shutil.copyfileobj(stream, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def headers_for(self, code, length, mime, *, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", mime)
            if length is not None:
                self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", (extra or {}).get("Cache-Control", "no-store"))
            for key, value in (extra or {}).items():
                if key != "Cache-Control":
                    self.send_header(key, value)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
