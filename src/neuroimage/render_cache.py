"""Lossless browser representations of verified source geometry and memberships."""
from pathlib import Path
import gzip
import hashlib
import json
import os
import struct
import tempfile

import nibabel as nib
import numpy as np

from .acquire import capacity


def mesh_buffer(points, faces):
    """Match NiiVue 0.69's complete 20-byte vertex layout, without decimation."""
    points = np.ascontiguousarray(points, dtype="<f4")
    faces = np.ascontiguousarray(faces, dtype="<u4")
    normals = np.zeros(points.shape, dtype="<f4")
    # Each addition rounds to float32, in the renderer's original triangle order.
    for start in range(0, len(faces), 100_000):
        triangles = faces[start:start + 100_000]
        p = points[triangles].astype(np.float64)
        q, r = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
        cross = np.cross(r, q)
        np.add.at(normals, triangles.ravel(), np.repeat(cross, 3, axis=0))
    normalized = -normals.astype(np.float64)
    lengths = np.sqrt(np.sum(normalized * normalized, axis=1))
    normalized[lengths > 0] *= (1 / lengths[lengths > 0])[:, None]
    normalized = normalized.astype("<f4")
    vertices = np.zeros((len(points), 20), dtype=np.uint8)
    vertices[:, :12] = points.view(np.uint8).reshape(-1, 12)
    vertices[:, 12:15] = np.trunc(normalized.astype(np.float64) * 127).astype(np.int16).astype(np.uint8)
    vertices[:, 16:20] = 255
    return encode_mesh_buffer(struct.pack("<4sIII", b"NGM1", len(faces), len(points), 20) + faces.tobytes() + vertices.tobytes())


def encode_mesh_buffer(original):
    """Delta-code integer bit patterns; every float32 bit and index is retained."""
    magic, faces, points, stride = struct.unpack("<4sIII", original[:16])
    if magic != b"NGM1" or stride != 20 or len(original) != 16 + faces * 12 + points * 20:
        raise ValueError("Invalid prepared mesh buffer")
    indices = np.frombuffer(original, "<u4", count=faces * 3, offset=16)
    vertices = np.frombuffer(original, "<u4", offset=16 + faces * 12).reshape(-1, 5)
    streams = [indices, *[vertices[:, axis] for axis in range(4)]]
    payload = struct.pack("<4sIII", b"NGM2", faces, points, 16)
    for values in streams:
        delta = np.empty(values.shape, dtype="<u4")
        if len(values):
            delta[0] = values[0]
            np.subtract(values[1:], values[:-1], out=delta[1:])
        payload += delta.tobytes()
    return payload


class RenderCache:
    def __init__(self, root, *, minimum_free_gib=0):
        self.root = Path(root) / "v2"
        self.minimum_free_gib = minimum_free_gib
        if self.root.is_symlink() or self.root.parent.is_symlink():
            raise ValueError("Browser cache must not be a symbolic link")
        self.root.mkdir(parents=True, exist_ok=True)
        self.checked = {}

    def _write(self, path, data):
        capacity(self.root, len(data), self.minimum_free_gib)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.root, prefix=".preparing-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _valid(self, path, source_sha, codec=1):
        try:
            receipt = path.with_suffix(path.suffix + ".json")
            receipt_stat = receipt.stat()
            if path.is_symlink() or receipt.is_symlink() or receipt_stat.st_size > 4096:
                return False
            stat = path.stat()
            stamp = tuple((item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns) for item in (stat, receipt_stat))
            if self.checked.get((path, codec)) == stamp:
                return True
            record = json.loads(receipt.read_text())
            if record["source_sha256"] != source_sha or record["bytes"] != stat.st_size or record.get("codec", 1) != codec:
                return False
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != record["sha256"]:
                    return False
            self.checked[(path, codec)] = stamp
            return True
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def prepare(self, manifest_path, manifest):
        root = Path(manifest_path).resolve().parent
        record = manifest.model_dump(mode="json") if hasattr(manifest, "model_dump") else manifest
        volumes = {volume["id"]: volume for volume in record["volumes"]}
        masks = {volumes[item["mask"]["volume_id"]]["file"]: (volumes[item["mask"]["volume_id"]], item["voxel_count"])
                 for item in record["structures"] if item.get("kind") == "independent-region"}
        files, metadata = {}, {}
        image_files = {v["file"] for v in record["volumes"]}
        for asset in record["assets"]:
            name, digest = asset["path"], asset["sha256"]
            kind = ("mask" if name in masks else "mesh" if name.endswith(".gii") and asset["role"] == "mesh"
                    else "volume" if name in image_files and name.endswith(".nii.gz") else None)
            if kind is None:
                continue
            suffix = {"mask": ".nim", "mesh": ".ngm", "volume": ".nii"}[kind]
            target = self.root / (digest + suffix)
            source = root / name
            if source.is_symlink() or not source.resolve().is_relative_to(root):
                raise ValueError("A browser cache input leaves its source package")
            if kind == "volume":
                # HTTP gzip decoding uses the browser's native streaming decoder;
                # the original compressed NIfTI and its header remain unchanged.
                files[target.name] = source
                metadata[name] = {"file": target.name, "format": kind, "source_sha256": digest, "bytes": asset["bytes"]}
                continue
            codec = 2 if kind == "mesh" else 1
            if not self._valid(target, digest, codec):
                if kind == "mesh" and self._valid(target, digest, 1):
                    # Upgrade already verified browser buffers without repeating
                    # XML parsing or source-normal computation.
                    payload = gzip.compress(encode_mesh_buffer(gzip.decompress(target.read_bytes())), compresslevel=1, mtime=0)
                    self._write(target, payload)
                    receipt = {"source_sha256": digest, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload), "codec": codec}
                    self._write(target.with_suffix(target.suffix + ".json"), json.dumps(receipt).encode())
                    files[target.name] = target
                    metadata[name] = {"file": target.name, "format": kind, "source_sha256": digest, "bytes": len(payload)}
                    continue
                original = source.read_bytes()
                if hashlib.sha256(original).hexdigest() != digest:
                    raise ValueError("A browser cache input failed its source checksum")
                if kind == "mask":
                    raw = gzip.decompress(original) if original[:2] == b"\x1f\x8b" else original
                    cls = nib.Nifti2Image if struct.unpack("<i", raw[:4])[0] == 540 or struct.unpack(">i", raw[:4])[0] == 540 else nib.Nifti1Image
                    image = cls.from_bytes(raw)
                    volume, expected = masks[name]
                    values = np.asanyarray(image.dataobj)
                    if tuple(values.shape) != tuple(volume["shape"]) or not np.all((values == 0) | (values == 1)):
                        raise ValueError("Browser mask cache requires the exact binary source grid")
                    indices = np.flatnonzero(values.ravel(order="F")).astype("<u4")
                    if len(indices) != expected:
                        raise ValueError("Browser mask cache changed the source membership count")
                    payload = struct.pack("<4sI", b"NIM1", len(indices)) + indices.tobytes()
                else:
                    image = nib.gifti.GiftiImage.from_bytes(original)
                    points, faces = image.agg_data("pointset"), image.agg_data("triangle")
                    if not isinstance(points, np.ndarray) or not isinstance(faces, np.ndarray):
                        raise ValueError("Browser mesh cache requires one original vertex and triangle array")
                    payload = gzip.compress(mesh_buffer(points, faces), compresslevel=1, mtime=0)
                self._write(target, payload)
                receipt = {"source_sha256": digest, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload), "codec": codec}
                self._write(target.with_suffix(target.suffix + ".json"), json.dumps(receipt).encode())
            files[target.name] = target
            metadata[name] = {"file": target.name, "format": kind, "source_sha256": digest, "bytes": target.stat().st_size}
        return metadata, files
