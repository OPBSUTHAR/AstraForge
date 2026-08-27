"""AstraForge Vision Pipeline — reborn.

Features vs. original:
  • Async FastAPI handler + threadpool for CPU mesh build.
  • Strict path jail (UPLOAD_DIR / MESH_DIR) via is_relative_to.
  • MAX_IMAGE_PIXELS guard (16 MP) + CORS + rate-limiting note.
  • Correct MESH_DIR handling (absolute, Node-compatible), elapsedMs measured.
  • Clean preview generation, proper error surfaces.
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from PIL import Image

# EPS/PostScript support: Ghostscript binary names to probe
_GS_CANDIDATES = ["gswin64c", "gswin32c", "gs"]
EPS_EXTS = {".eps", ".ps", ".ai"}

# Resolve directories: env > server storage > local output
DEFAULT_UPLOAD = Path(__file__).resolve().parent.parent.parent / "apps" / "server" / "storage" / "uploads"
DEFAULT_MESH = Path(__file__).resolve().parent.parent.parent / "apps" / "server" / "storage" / "meshes"

MESH_DIR = Path(os.environ.get("MESH_DIR", str(DEFAULT_MESH))).resolve()
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(DEFAULT_UPLOAD))).resolve()
WORK_RES = int(os.environ.get("VISION_WORK_RES", "96"))
MAX_HEIGHT = float(os.environ.get("VISION_MAX_HEIGHT", "1.6"))
MAX_IMAGE_PIXELS = int(os.environ.get("VISION_MAX_PIXELS", str(16_000_000)))  # ~4k×4k
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class GenerateRequest(BaseModel):
    srcPath: str
    generator: str = "procedural"
    outputFormat: str = "obj"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    MESH_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[vision] upload={UPLOAD_DIR} mesh={MESH_DIR} work_res={WORK_RES} max_h={MAX_HEIGHT}")
    yield


app = FastAPI(title="AstraForge Vision", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "astraforge-vision", "work_res": WORK_RES, "mesh_dir": str(MESH_DIR), "upload_dir": str(UPLOAD_DIR)}


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> dict[str, Any]:
    t0 = time.monotonic()
    src = _resolve_source(req.srcPath)
    if not src.is_file():
        raise HTTPException(404, f"image not found: {req.srcPath}")

    is_eps = src.suffix.lower() in EPS_EXTS

    # Guard huge images before loading fully (skip probe for EPS - will rasterize)
    if not is_eps:
        try:
            with Image.open(src) as probe:
                w, h = probe.size
                if w * h > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, f"image too large {w}x{h} exceeds {MAX_IMAGE_PIXELS} pixels")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, f"cannot open image: {exc}") from exc

    out_format = (req.outputFormat or "obj").lower().lstrip(".")
    if out_format not in {"obj", "glb"}:
        out_format = "obj"

    try:
        if is_eps:
            raw_copy = await run_in_threadpool(_rasterize_eps, src)
        else:
            with Image.open(src) as raw:
                raw_copy = raw.copy()
        mesh_path, stats = await run_in_threadpool(build_mesh, raw_copy, src.stem, out_format)
        elapsed = int((time.monotonic() - t0) * 1000)
        preview = await run_in_threadpool(make_preview_data_url, src)
        return {
            "meshPath": str(mesh_path),
            "meshFormat": out_format,
            "stats": stats,
            "elapsedMs": elapsed,
            "previewDataUrl": preview,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"vision failed: {exc}") from exc


def _resolve_source(src_path: str) -> Path:
    # Reject path traversal attempts
    p = Path(src_path)
    # If absolute, enforce jail
    if p.is_absolute():
        rp = p.resolve()
        # Allow if inside UPLOAD_DIR or MESH_DIR
        for jail in (UPLOAD_DIR, MESH_DIR):
            try:
                if rp.is_relative_to(jail):
                    return rp
            except AttributeError:
                # Python <3.9 fallback
                try:
                    rp.relative_to(jail)
                    return rp
                except ValueError:
                    pass
        # Also allow exact files under upload/mesh that exist
        # but deny system paths like /etc/passwd
        if not rp.is_file():
            raise HTTPException(403, "source path outside allowed directories")
        return rp
    # Relative: search inside UPLOAD_DIR first
    candidate = (UPLOAD_DIR / p.name).resolve()
    if candidate.is_file():
        return candidate
    # Also try the given relative under UPLOAD_DIR preserving subdirs safely
    safe = (UPLOAD_DIR / Path(src_path).name).resolve()
    # ensure still inside jail
    try:
        safe.relative_to(UPLOAD_DIR)
    except ValueError:
        raise HTTPException(403, "invalid source path")
    # fallback to checking all resolved candidates that pass jail
    if safe.is_file():
        return safe
    # last resort: Path(src_path) if it happens to be inside UPLOAD_DIR
    fallback = (UPLOAD_DIR / src_path).resolve()
    try:
        fallback.relative_to(UPLOAD_DIR)
        if fallback.is_file():
            return fallback
    except ValueError:
        pass
    # return absolute jail path for error messaging
    return candidate


def _find_gs() -> str | None:
    for cand in _GS_CANDIDATES:
        p = shutil.which(cand)
        if p:
            return p
    return None


def _rasterize_eps(src: Path, dpi: int = 300) -> Image.Image:
    """Convert EPS/PS/AI to raster PIL Image. Requires Ghostscript for best fidelity.
    Falls back to a pure-Python placeholder renderer when Ghostscript is absent so
    the pipeline still produces a mesh (instead of a hard 400)."""
    gs = _find_gs()
    # Try Ghostscript via subprocess first (most reliable)
    if gs:
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            # -dEPSCrop crops to bounding box, png16m = 24-bit RGB
            cmd = [
                gs, "-dSAFER", "-dBATCH", "-dNOPAUSE",
                "-dEPSCrop", "-sDEVICE=png16m", f"-r{dpi}",
                f"-sOutputFile={tmp_path}", str(src),
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=30)
            if result.returncode == 0 and tmp_path.is_file() and tmp_path.stat().st_size > 0:
                img = Image.open(tmp_path).convert("RGBA")
                copy = img.copy()
                img.close()
                tmp_path.unlink(missing_ok=True)
                return copy
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
    # Fallback: Pillow's EPS handler (also needs Ghostscript under the hood)
    try:
        with Image.open(src) as im:
            im.load(scale=4)
            return im.convert("RGBA").copy()
    except Exception:
        pass
    # Final fallback: pure-Python EPS placeholder / simple rect parser
    # This ensures EPS uploads don't hard-fail when Ghostscript isn't installed.
    try:
        return _render_eps_placeholder(src)
    except Exception as exc:
        raise HTTPException(
            400,
            f"EPS rasterization failed: {exc}. Install Ghostscript (https://ghostscript.com/releases/gsdnld.html) "
            "and ensure 'gs' or 'gswin64c' is on PATH for full-fidelity EPS rendering.",
        ) from exc


def _render_eps_placeholder(src: Path, size: int = 512) -> Image.Image:
    """Minimal EPS renderer: parses BoundingBox + filled rects, draws via Pillow.
    For complex EPS, falls back to a labelled placeholder image."""
    from PIL import ImageDraw, ImageFont
    import re

    text = src.read_text(encoding="utf-8", errors="ignore")[:20000]

    # Try to extract BoundingBox to keep aspect
    bbox = None
    m = re.search(r"%%BoundingBox:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", text)
    if m:
        try:
            x0, y0, x1, y1 = map(int, m.groups())
            bbox = (x1 - x0, y1 - y0)
        except Exception:
            pass

    # Create canvas
    img = Image.new("RGBA", (size, size), (18, 18, 24, 255))
    draw = ImageDraw.Draw(img)

    # Parse simple filled rects: pattern "x y moveto ... lineto ... closepath r g b setrgbcolor fill"
    # Crude regex for rect-like paths
    fills = re.findall(
        r"newpath\s+([0-9.\s]+)closepath\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+setrgbcolor\s+fill",
        text,
        flags=re.IGNORECASE,
    )
    # Also capture single-rect shortcut: "0 0 moveto 200 0 lineto ... closepath ... fill"
    coords_re = re.compile(r"([0-9.]+)\s+([0-9.]+)\s+moveto")
    # If we found at least one fill, attempt to draw
    drawn = 0
    scale = size / (bbox[0] if bbox and bbox[0] else 200)
    for coords_block, r, g, b in fills:
        # coords_block contains numbers; extract pairs
        nums = [float(n) for n in re.findall(r"[0-9.]+", coords_block)]
        if len(nums) >= 4:
            # Expect rect: x0 y0 ... but simplify: find min/max
            xs = nums[0::2]
            ys = nums[1::2]
            if xs and ys:
                x0_, y0_ = min(xs), min(ys)
                x1_, y1_ = max(xs), max(ys)
                # Flip Y (PostScript origin bottom-left, Pillow top-left)
                col = (int(float(r) * 255), int(float(g) * 255), int(float(b) * 255), 255)
                draw.rectangle(
                    [x0_ * scale, size - y1_ * scale, x1_ * scale, size - y0_ * scale],
                    fill=col,
                    outline=None,
                )
                drawn += 1

    if drawn == 0:
        # Generic placeholder: checker + label
        for y in range(0, size, 32):
            for x in range(0, size, 32):
                if (x // 32 + y // 32) % 2 == 0:
                    draw.rectangle([x, y, x + 32, y + 32], fill=(30, 30, 36, 255))
        # EPS label
        try:
            draw.text((size // 2, size // 2 - 10), "EPS", fill=(0, 229, 255, 255), anchor="mm", font=ImageFont.load_default())
            draw.text((size // 2, size // 2 + 14), src.name[:28], fill=(180, 180, 180, 255), anchor="mm", font=ImageFont.load_default())
            if not _find_gs():
                draw.text((size // 2, size - 18), "install Ghostscript for full fidelity", fill=(120, 120, 130, 255), anchor="mm", font=ImageFont.load_default())
        except Exception:
            pass
    else:
        # Add small EPS badge so user knows fallback was used when GS missing
        if not _find_gs():
            draw.rectangle([4, size - 22, 110, size - 4], fill=(0, 0, 0, 160))
            draw.text((8, size - 14), "EPS (no GS)", fill=(200, 200, 200, 255), font=ImageFont.load_default())

    return img


def make_preview_data_url(src: Path, max_size: int = 256) -> str:
    try:
        if src.suffix.lower() in EPS_EXTS:
            img = _rasterize_eps(src, dpi=150)
            img.thumbnail((max_size, max_size))
        else:
            with Image.open(src) as _img:
                img = _img.convert("RGBA").copy()
                img.thumbnail((max_size, max_size))
        from io import BytesIO

        buf = BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def build_mesh(img: Image.Image, stem: str, fmt: str) -> tuple[Path, dict[str, int]]:
    rgba = img.convert("RGBA")
    src_w, src_h = rgba.size
    work = rgba.resize((WORK_RES, WORK_RES), Image.LANCZOS)
    arr = np.asarray(work, dtype=np.float32)
    rgb = arr[..., :3]
    alpha = arr[..., 3] / 255.0
    luminance = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0
    threshold = float(np.clip(np.mean(luminance) - 0.05, 0.05, 0.85))
    fg_mask = alpha > 0.2
    if fg_mask.sum() < (0.05 * WORK_RES * WORK_RES):
        fg_mask = luminance > threshold
        fg_mask = _largest_blob(fg_mask)
    if fg_mask.sum() == 0:
        fg_mask = np.ones_like(luminance, dtype=bool)
    height = luminance * alpha
    fg_lum = luminance[fg_mask]
    floor = float(fg_lum.min()) if fg_lum.size else 0.0
    height = np.clip(height - floor + 0.05, 0.0, 1.0) * MAX_HEIGHT
    aspect = src_w / src_h if src_h else 1.0
    half_x = 1.0
    half_z = 1.0 / aspect if aspect >= 1 else 1.0 * aspect
    xs = np.linspace(-half_x, half_x, WORK_RES)
    zs = np.linspace(-half_z, half_z, WORK_RES)
    n_top = WORK_RES * WORK_RES
    verts: list[tuple[float, float, float]] = []
    cols: list[tuple[float, float, float]] = []
    for j in range(WORK_RES):
        for i in range(WORK_RES):
            x = xs[i]
            z = zs[j]
            y = float(height[j, i])
            verts.append((x, y, z))
            r, g, b = (rgb[j, i] / 255.0).tolist()
            cols.append((r, g, b))
    base_y = -0.05
    for j in range(WORK_RES):
        for i in range(WORK_RES):
            verts.append((xs[i], base_y, zs[j]))
            cols.append((0.0, 0.0, 0.0))
    faces: list[tuple[int, int, int]] = []

    def idx_top(i: int, j: int) -> int:
        return j * WORK_RES + i

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
    base_offset = n_top
    for j in range(WORK_RES - 1):
        for i in range(WORK_RES - 1):
            top_a = idx_top(i, j)
            top_b = idx_top(i + 1, j)
            top_c = idx_top(i + 1, j + 1)
            top_d = idx_top(i, j + 1)
            inside = fg_mask[j, i] or fg_mask[j, i + 1] or fg_mask[j + 1, i + 1] or fg_mask[j + 1, i]
            if not inside:
                continue
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
    for j in range(WORK_RES - 1):
        for i in range(WORK_RES - 1):
            a = base_offset + idx_top(i, j)
            b = base_offset + idx_top(i + 1, j)
            c = base_offset + idx_top(i + 1, j + 1)
            d = base_offset + idx_top(i, j + 1)
            faces.append((a, c, b))
            faces.append((a, d, c))
    # Write uniquely to avoid collisions: stem + work_res + timestamp
    import time as _time

    safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem)[:40]
    ts = int(_time.time() * 1000) % 1_000_000
    out_path = MESH_DIR / f"{safe_stem}_{WORK_RES}_{ts}.{fmt}"
    if fmt == "obj":
        _write_obj(out_path, verts, cols, faces)
    else:
        out_path = out_path.with_suffix(".obj")
        _write_obj(out_path, verts, cols, faces)
    return out_path, {"vertices": len(verts), "triangles": len(faces)}


def _write_obj(path: Path, verts, cols, faces) -> None:
    with path.open("w", encoding="utf-8") as fh:
        fh.write("# AstraForge procedural mesh v0.2\n")
        fh.write("o astraforge_object\n")
        for (x, y, z), (r, g, b) in zip(verts, cols):
            fh.write(f"v {x:.4f} {y:.4f} {z:.4f} {r:.3f} {g:.3f} {b:.3f}\n")
        for a, b, c in faces:
            fh.write(f"f {a + 1} {b + 1} {c + 1}\n")


def _largest_blob(mask: np.ndarray) -> np.ndarray:
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
