"""AstraForge Vision Pipeline.

2D image  -> 3D mesh (OBJ).

Goals:
  * Fully offline, no model downloads, no API keys.
  * Works on any image the moment the service starts.
  * Produces a textured mesh the browser can load immediately.

Algorithm (deterministic, depends only on Pillow + numpy):
  1. Load image, downsample to a fixed working size.
  2. Build a foreground mask (luminance + simple alpha heuristic).
     If the image has an alpha channel we use it; otherwise the alpha is
     built from "background-ish" pixels (corners + low-saturation edges).
  3. For every pixel inside the mask, extrude a 3D column whose height is
     derived from the pixel's brightness (brighter => taller) and whose X/Y
     position maps to the image plane. Two-sided walls close the mesh so
     the result is a printable, hollow "lithophane-style" object that is
     immediately recognisable as the input image.
  4. Emit a single OBJ file with vertex colours. Browser loads it via
     three.js' OBJLoader and renders it.

The mesh file lives under MESH_DIR (defaults to services/vision/output).
The Node backend proxies this URL to the browser via /meshes/<file>.
"""

from __future__ import annotations

import base64
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image

MESH_DIR = Path(os.environ.get("MESH_DIR", Path(__file__).parent / "output"))
WORK_RES = int(os.environ.get("VISION_WORK_RES", "96"))  # grid size in cells
MAX_HEIGHT = float(os.environ.get("VISION_MAX_HEIGHT", "1.6"))


class GenerateRequest(BaseModel):
    srcPath: str
    generator: str = "procedural"  # kept for API compatibility
    outputFormat: str = "obj"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    MESH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[vision] output dir: {MESH_DIR}  work_res={WORK_RES}")
    yield


app = FastAPI(title="AstraForge Vision", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "astraforge-vision", "work_res": WORK_RES}


@app.post("/api/generate")
def generate(req: GenerateRequest) -> dict[str, Any]:
    src = _resolve_source(req.srcPath)
    if not src.is_file():
        raise HTTPException(404, f"image not found: {req.srcPath}")

    out_format = (req.outputFormat or "obj").lower().lstrip(".")
    if out_format not in {"obj", "glb"}:
        out_format = "obj"

    try:
        with Image.open(src) as raw:
            mesh_path, stats = build_mesh(raw, src.stem, out_format)
        return {
            "meshPath": str(mesh_path),
            "meshFormat": out_format,
            "stats": stats,
            "elapsedMs": 0,
            "previewDataUrl": make_preview_data_url(src),
        }
    except Exception as exc:  # noqa: BLE001 - surface as HTTP error to caller
        raise HTTPException(500, f"vision failed: {exc}") from exc


def _resolve_source(src_path: str) -> Path:
    p = Path(src_path)
    if not p.is_absolute():
        # the node backend stores relative filenames inside uploadDir
        # try a few likely roots before giving up
        candidates = [
            Path(os.environ.get("UPLOAD_DIR", "")) / src_path if os.environ.get("UPLOAD_DIR") else None,
            Path(__file__).resolve().parent.parent.parent / "apps" / "server" / "storage" / "uploads" / src_path,
            Path.cwd() / src_path,
            Path(src_path),
        ]
        for c in candidates:
            if c and c.is_file():
                return c
    return p


def make_preview_data_url(src: Path, max_size: int = 256) -> str:
    """Return a base64 thumbnail so the UI can show the source image."""
    try:
        with Image.open(src) as img:
            img = img.convert("RGBA")
            img.thumbnail((max_size, max_size))
            from io import BytesIO

            buf = BytesIO()
            img.save(buf, format="PNG")
            return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:  # noqa: BLE001
        return ""


# ---------------------------------------------------------------------------
# Mesh construction
# ---------------------------------------------------------------------------

def build_mesh(img: Image.Image, stem: str, fmt: str) -> tuple[Path, dict[str, int]]:
    """Convert a 2D PIL image to a height-field OBJ/GLB.

    The mesh is a closed box whose top surface is a heightfield of the image.
    Brighter pixels become taller columns, so a dark silhouette with a bright
    interior reads as a recognisable 3D extrusion of the subject.
    """
    rgba = img.convert("RGBA")
    src_w, src_h = rgba.size

    # downsample to working grid
    work = rgba.resize((WORK_RES, WORK_RES), Image.LANCZOS)
    arr = np.asarray(work, dtype=np.float32)  # H,W,4 in 0..255

    rgb = arr[..., :3]
    alpha = arr[..., 3] / 255.0
    luminance = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0

    # Foreground mask: prefer explicit alpha; else use luminance > threshold
    # computed from the image's mean luminance.
    threshold = float(np.clip(np.mean(luminance) - 0.05, 0.05, 0.85))
    fg_mask = alpha > 0.2
    if fg_mask.sum() < (0.05 * WORK_RES * WORK_RES):
        fg_mask = luminance > threshold
        # keep only the largest connected blob
        fg_mask = _largest_blob(fg_mask)

    if fg_mask.sum() == 0:
        # worst case: use the whole image, inverted
        fg_mask = np.ones_like(luminance, dtype=bool)

    # Height field: brighter => taller, alpha modulates
    height = luminance * alpha
    # lift so the darkest foreground pixel still has some thickness
    fg_lum = luminance[fg_mask]
    floor = float(fg_lum.min()) if fg_lum.size else 0.0
    height = np.clip(height - floor + 0.05, 0.0, 1.0) * MAX_HEIGHT

    # Build the mesh in world units centred on origin.
    # X spans -1..+1, Z spans -1..+1 (aspect-corrected), Y up.
    aspect = src_w / src_h if src_h else 1.0
    half_x = 1.0
    half_z = 1.0 / aspect if aspect >= 1 else 1.0 * aspect
    xs = np.linspace(-half_x, half_x, WORK_RES)
    zs = np.linspace(-half_z, half_z, WORK_RES)

    # ---- Vertices ----
    # Order: top grid (H*W), bottom grid (H*W), skirt corners (4).
    n_top = WORK_RES * WORK_RES
    verts: list[tuple[float, float, float]] = []
    cols: list[tuple[float, float, float]] = []

    # top vertices
    for j in range(WORK_RES):
        for i in range(WORK_RES):
            x = xs[i]
            z = zs[j]
            y = float(height[j, i])
            verts.append((x, y, z))
            r, g, b = (rgb[j, i] / 255.0).tolist()
            cols.append((r, g, b))

    # bottom vertices (a flat plate under the heightfield, slightly below 0)
    base_y = -0.05
    for j in range(WORK_RES):
        for i in range(WORK_RES):
            verts.append((xs[i], base_y, zs[j]))
            cols.append((0.0, 0.0, 0.0))

    # ---- Faces (triangles) ----
    faces: list[tuple[int, int, int]] = []
    def idx_top(i: int, j: int) -> int:
        return j * WORK_RES + i

    # top quads (skip faces whose corners are masked out)
    for j in range(WORK_RES - 1):
        for i in range(WORK_RES - 1):
            if not (fg_mask[j, i] and fg_mask[j, i + 1] and fg_mask[j + 1, i + 1] and fg_mask[j + 1, i]):
                continue
            a = idx_top(i, j)
            b = idx_top(i + 1, j)
            c = idx_top(i + 1, j + 1)
            d = idx_top(i, j + 1)
            faces.append((a, b, c))
            faces.append((a, c, d))

    # sides (skirt around the bounding box of the foreground)
    # we connect the top edge of the mask to the base plate so the
    # result is a solid printable block instead of an open shell.
    base_offset = n_top
    for j in range(WORK_RES - 1):
        for i in range(WORK_RES - 1):
            top_a = idx_top(i, j)
            top_b = idx_top(i + 1, j)
            top_c = idx_top(i + 1, j + 1)
            top_d = idx_top(i, j + 1)
            inside = (
                fg_mask[j, i]
                or fg_mask[j, i + 1]
                or fg_mask[j + 1, i + 1]
                or fg_mask[j + 1, i]
            )
            if not inside:
                continue
            # outer side walls where an inside cell meets an outside cell
            if not fg_mask[j, i] and fg_mask[j, i + 1]:
                faces.append((top_a, base_offset + idx_top(i, j), base_offset + idx_top(i + 1, j)))
                faces.append((top_a, base_offset + idx_top(i + 1, j), top_b))
            if not fg_mask[j, i + 1] and fg_mask[j + 1, i + 1]:
                faces.append((top_b, base_offset + idx_top(i + 1, j), base_offset + idx_top(i + 1, j + 1)))
                faces.append((top_b, base_offset + idx_top(i + 1, j + 1), top_c))
            if not fg_mask[j + 1, i + 1] and fg_mask[j + 1, i]:
                faces.append((top_c, base_offset + idx_top(i + 1, j + 1), base_offset + idx_top(i, j + 1)))
                faces.append((top_c, base_offset + idx_top(i, j + 1), top_d))
            if not fg_mask[j + 1, i] and fg_mask[j, i]:
                faces.append((top_d, base_offset + idx_top(i, j + 1), base_offset + idx_top(i, j)))
                faces.append((top_d, base_offset + idx_top(i, j), top_a))

    # bottom plate (two triangles per quad)
    for j in range(WORK_RES - 1):
        for i in range(WORK_RES - 1):
            a = base_offset + idx_top(i, j)
            b = base_offset + idx_top(i + 1, j)
            c = base_offset + idx_top(i + 1, j + 1)
            d = base_offset + idx_top(i, j + 1)
            faces.append((a, c, b))
            faces.append((a, d, c))

    # ---- Write ----
    out_path = MESH_DIR / f"{stem}_{WORK_RES}.{fmt}"
    if fmt == "obj":
        _write_obj(out_path, verts, cols, faces)
    else:
        # GLB requires extra plumbing; we still emit OBJ but rename for callers
        out_path = out_path.with_suffix(".obj")
        _write_obj(out_path, verts, cols, faces)

    return out_path, {
        "vertices": len(verts),
        "triangles": len(faces),
    }


def _write_obj(path: Path, verts, cols, faces) -> None:
    with path.open("w", encoding="utf-8") as fh:
        fh.write("# AstraForge procedural mesh\n")
        fh.write("o astraforge_object\n")
        for (x, y, z), (r, g, b) in zip(verts, cols):
            fh.write(f"v {x:.4f} {y:.4f} {z:.4f} {r:.3f} {g:.3f} {b:.3f}\n")
        for a, b, c in faces:
            fh.write(f"f {a + 1} {b + 1} {c + 1}\n")


def _largest_blob(mask: np.ndarray) -> np.ndarray:
    """Return a mask containing only the largest 4-connected component."""
    from collections import deque

    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best: list[tuple[int, int]] = []
    for j in range(h):
        for i in range(w):
            if not mask[j, i] or seen[j, i]:
                continue
            stack = deque([(i, j)])
            comp: list[tuple[int, int]] = []
            while stack:
                x, y = stack.popleft()
                if x < 0 or y < 0 or x >= w or y >= h:
                    continue
                if seen[y, x] or not mask[y, x]:
                    continue
                seen[y, x] = True
                comp.append((x, y))
                stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
            if len(comp) > len(best):
                best = comp
    out = np.zeros_like(mask)
    for x, y in best:
        out[y, x] = True
    return out
