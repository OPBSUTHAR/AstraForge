"""AstraForge Vision Pipeline (Phase 2).

2D image -> (rembg background removal) -> (Trellis / SF3D) -> textured mesh.

Runs as a local FastAPI service. The web backend (`apps/server`) POSTs to
``/api/generate``; progress is relayed to the UI via its socket layer.

Mesh generators are optional heavy installs. When neither ``trellis`` nor
``sf3d`` is available the service falls back to a procedural placeholder mesh
so the pipeline is exercisable end-to-end before Phase 2 ships real models.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image

MESH_DIR = Path(os.environ.get("MESH_DIR", Path(__file__).parent / "output"))


class GenerateRequest(BaseModel):
    srcPath: str
    generator: str = "sf3d"
    outputFormat: str = "glb"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    MESH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[vision] output dir: {MESH_DIR}")
    yield


app = FastAPI(title="AstraForge Vision", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "astraforge-vision"}


@app.post("/api/generate")
def generate(req: GenerateRequest) -> dict[str, Any]:
    src = _resolve_source(req.srcPath)
    if not src.is_file():
        raise HTTPException(404, f"image not found: {req.srcPath}")

    try:
        with Image.open(src) as img:
            cleaned = _remove_background(img)
            cleaned = cleaned or img

        out_format = (req.outputFormat or "obj").lower().lstrip(".")
        out = MESH_DIR / f"{src.stem}_{req.generator}.{out_format}"

        try:
            if req.generator == "sf3d":
                stats = _generate_sf3d(cleaned, out)
            else:
                stats = _generate_trellis(cleaned, out, out_format)
        except ImportError as exc:
            print(f"[vision] {req.generator} not installed ({exc}); placeholder mesh")
            stats = _procedural_fallback(out)

        return {
            "meshPath": str(out),
            "meshFormat": out.suffix.lstrip("."),
            "stats": stats,
            "elapsedMs": 0,
        }
    except Exception as exc:
        raise HTTPException(500, f"vision failed: {exc}") from exc


def _remove_background(img: Image.Image) -> Image.Image:
    try:
        from rembg import remove

        result = remove(img)
        print("[vision] background removed (rembg)")
        return result
    except Exception as exc:
        print(f"[vision] rembg unavailable ({exc}); continuing with original")
        return img


def _generate_sf3d(img: Image.Image, out: Path) -> dict[str, int]:
    from sf3d import generate_mesh  # type: ignore

    mesh = generate_mesh(img)
    result = {"vertices": int(mesh.vertices_count), "triangles": int(mesh.faces_count)}
    mesh.export(out)
    return result


def _generate_trellis(img: Image.Image, out: Path, format: str) -> dict[str, int]:
    import trellis  # type: ignore

    sample = trellis.prepare_from_async  # placeholder binding for Phase 2 model
    del sample, img
    # Real flow: sample -> upsample -> decode to GLB. API bound when trellis
    # model weights are vendored (Phase 2).
    raise ImportError("trellis export not wired yet")


def _procedural_fallback(path: Path) -> dict[str, int]:
    """Write a deterministic tetrahedron .obj so the pipeline closes end-to-end."""
    vertices = [(0.0, 0.6, 0.0), (0.6, -0.3, 0.4), (-0.6, -0.3, 0.4), (0.0, -0.3, -0.6)]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 1), (1, 3, 2)]
    with path.open("w") as fh:
        for v in vertices:
            fh.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        for tri in faces:
            fh.write(f"f {tri[0]+1} {tri[1]+1} {tri[2]+1}\n")
    return {"vertices": len(vertices), "triangles": len(faces)}