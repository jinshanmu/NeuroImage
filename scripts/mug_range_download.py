"""Bounded, checksum-verified HTTP ranges for the original public MUG archives.

Completed chunks are committed only after fsync, with SHA256 receipts. Legacy
sequential partials remain valid prefixes and can seed the same transfer. A full
publisher MD5 match is required before publishing the original ZIP filename.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from neuroimage.acquire import capacity
from neuroimage.build import atomic_json


CHUNK_BYTES = 16 * 1024**2


class RangeUnsupported(ValueError):
    pass


def open_range(url, start, end, total):
    response = urlopen(Request(url, headers={"Range": f"bytes={start}-{end}",
        "Accept-Encoding": "identity", "User-Agent": "NeuroImage original-source acquisition"}), timeout=45)
    if response.status != 206:
        response.close()
        raise RangeUnsupported("Source did not return HTTP 206")
    if response.headers.get("Content-Range") != f"bytes {start}-{end}/{total}":
        response.close()
        raise ValueError("Source Content-Range differs from the exact requested interval")
    length = response.headers.get("Content-Length")
    if length is not None and int(length) != end - start + 1:
        response.close()
        raise ValueError("Source range Content-Length differs from the requested interval")
    return response


def digest_file(path, algorithm):
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def chunk_digest(fd, start, length):
    digest = hashlib.sha256()
    while length:
        block = os.pread(fd, min(length, 1024**2), start)
        if not block:
            return None
        digest.update(block)
        start += len(block)
        length -= len(block)
    return digest.hexdigest()


def download_ranges(source, target, root, floor, connections=16, stop=None, emit=None, chunk_bytes=CHUNK_BYTES):
    """Return False for non-206 sources; never splice a 200 body into a range."""
    total, md5 = source["size"], source["computed_md5"]
    if total <= 0 or not re.fullmatch(r"[0-9a-fA-F]{32}", md5) or not 1 <= connections <= 16:
        raise ValueError("Require pinned source bytes, publisher MD5 and 1–16 range connections")
    if target.exists():
        raise FileExistsError("Original archive already exists and was not replaced: " + str(target))
    # Probe before creating a partial. A server ignoring Range can safely use
    # the established sequential path without allocating a second full file.
    try:
        with open_range(source["download_url"], 0, 0, total) as response:
            if len(response.read(2)) != 1:
                raise ValueError("Source probe did not return the exact requested byte")
    except RangeUnsupported:
        return False
    stop = stop if stop is not None else threading.Event()
    failed = threading.Event()
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".ranges.partial")
    ledger = target.with_name(target.name + ".ranges.json")
    legacy = target.with_name(target.name + ".partial")
    if any(path.is_symlink() for path in (partial, ledger, legacy)):
        raise ValueError("Range transfer state must not be a symbolic link")
    header = {"schema_version": "1", "filename": target.name, "bytes": total,
              "publisher_md5": md5.lower(), "chunk_bytes": chunk_bytes}
    state = json.loads(ledger.read_text()) if ledger.exists() else {**header, "complete": {}}
    if any(state.get(key) != value for key, value in header.items()):
        raise ValueError("Existing range state belongs to a different pinned source; preserved")
    prefix = 0
    if not partial.exists() and legacy.exists():
        prefix = legacy.stat().st_size
        if not 0 <= prefix <= total:
            raise ValueError("Oversize legacy partial preserved")
        os.replace(legacy, partial)
    existed = partial.exists()
    fd = os.open(partial, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock = threading.Lock()
    intervals = [(start, min(total, start + chunk_bytes)) for start in range(0, total, chunk_bytes)]
    try:
        stat = os.fstat(fd)
        if stat.st_size > total:
            raise ValueError("Oversize range partial preserved")
        capacity(root, max(0, total - stat.st_blocks * 512), floor)
        os.ftruncate(fd, total)
        if not existed:
            state["complete"] = {}
        for index, (start, end) in enumerate(intervals):
            key = str(index)
            saved = state["complete"].get(key)
            if saved is not None:
                if chunk_digest(fd, start, end-start) != saved:
                    del state["complete"][key]
            elif end <= prefix:
                state["complete"][key] = chunk_digest(fd, start, end-start)
        os.fsync(fd)
        atomic_json(ledger, state)
        last_report = [time.monotonic()]

        def transfer(index):
            start, end = intervals[index]
            for attempt in range(3):
                if stop.is_set() or failed.is_set():
                    raise InterruptedError("Range transfer paused; committed chunks retained")
                try:
                    digest = hashlib.sha256()
                    position = start
                    with open_range(source["download_url"], start, end-1, total) as response:
                        while position < end:
                            if stop.is_set() or failed.is_set():
                                raise InterruptedError("Range transfer paused; committed chunks retained")
                            block = response.read(min(1024**2, end-position))
                            if not block:
                                raise OSError("Incomplete source range")
                            capacity(root, len(block), floor)
                            written = 0
                            while written < len(block):
                                count = os.pwrite(fd, block[written:], position+written)
                                if count <= 0:
                                    raise OSError("Source range write made no progress")
                                written += count
                            digest.update(block)
                            position += len(block)
                        if response.read(1):
                            raise ValueError("Source range exceeded its requested interval")
                    with lock:
                        os.fsync(fd)
                        state["complete"][str(index)] = digest.hexdigest()
                        atomic_json(ledger, state)
                        if emit is not None and time.monotonic()-last_report[0] >= 30:
                            emit("download-progress", file=target.name,
                                 bytes=sum(intervals[int(key)][1]-intervals[int(key)][0]
                                           for key in state["complete"]), total_bytes=total,
                                 range_connections=connections)
                            last_report[0] = time.monotonic()
                    return
                except (HTTPError, URLError, TimeoutError, OSError) as error:
                    retry = not isinstance(error, HTTPError) or error.code in (408, 429, 500, 502, 503, 504)
                    if attempt == 2 or not retry or isinstance(error, InterruptedError):
                        raise
                    delay = 2**attempt
                    if isinstance(error, HTTPError):
                        requested = error.headers.get("Retry-After", "")
                        if requested.isdigit():
                            delay = max(delay, int(requested))
                        error.close()
                    if stop.wait(delay):
                        raise InterruptedError("Range transfer paused; committed chunks retained")

        missing = [index for index in range(len(intervals)) if str(index) not in state["complete"]]
        try:
            with ThreadPoolExecutor(max_workers=connections) as executor:
                futures = [executor.submit(transfer, index) for index in missing]
                for future in as_completed(futures):
                    try:
                        future.result()
                    except BaseException:
                        failed.set()
                        for pending in futures:
                            pending.cancel()
                        raise
        except RangeUnsupported:
            # Keep these committed chunks. Sequential fallback uses its own
            # partial and still must pass the complete publisher checksum.
            return False
        if len(state["complete"]) != len(intervals):
            raise ValueError("Range source incomplete; partial and ledger retained")
        os.fsync(fd)
    finally:
        os.close(fd)
    if partial.stat().st_size != total or digest_file(partial, "md5") != md5.lower():
        raise ValueError("Publisher MD5 mismatch; range partial and receipts preserved")
    if target.exists():
        raise FileExistsError("Original archive appeared during transfer and was preserved")
    os.replace(partial, target)
    state["status"] = "published"
    atomic_json(ledger, state)
    return True
