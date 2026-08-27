# Project AstraForge — Reborn v0.2

> Tony Stark-style holographic design space bridging **2D images**, **AI generation**, and **physical fabrication**. Reforged from the ground up for robustness, security, and delight.

![AstraForge](https://img.shields.io/badge/version-0.2.0-00e5ff?style=flat-square) ![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)

## What changed in the rebirth

**Every layer was reforged:**

- **Shared** — canonical Zod schemas + drift-free contracts (`VisionRequest` now matches server ↔ Python), versioned API (`0.2.0`), `Paginated` envelope.
- **Server** — helmet, CORS allowlist, rate-limit, graceful shutdown, lazy `Store` (fixes *DB never used* bug), `_id`/`id` mapping fix, pagination + indexes, path jail, mimetype guard, Socket validation + broadcast fix, Karmashala intent priority fix.
- **Vision** — async FastAPI + threadpool, jail via `is_relative_to`, `MAX_IMAGE_PIXELS` guard, CORS, measured `elapsedMs`, collision-safe mesh naming, correct `MESH_DIR` resolution.
- **Geometry** — portable `M_PI` via `<numbers>`, robust OBJ/STL loaders (slash faces, ASCII STL, case-insensitive, fan triangulation, `>=` size check), `bounds()`/`clear()` helpers.
- **Orchestrator** — fixed `net10.0` → `net8.0`, `IHttpClientFactory`, job eviction-safe, per-job temp paths, timeout + `WaitForExitAsync`, structured logs.
- **Web** — real mesh loader (`OBJLoader` + `Suspense`), shader fix (`scanline(vUv.yx)` + dispose), socket job-map + reconnection, backend-proxied health, URL-persisted project, thumbnail previews, file-input reset, delete asset, terminal history (↑/↓), WCAG contrast + `focus-visible` + `prefers-reduced-motion`, responsive grid + `hidden` sourcemaps.

## Architecture

```
Browser (Vite :5173) ──► Node API + Socket.IO (:4000) ──► Vision (FastAPI :5001)
         │                         │                        ↘
         │                         ├─► Mongo :27017 ──► storage/meshes ──► /meshes
         │                         └─► Geometry CLI (C++) ─► Orchestrator :5003
         └─► Karmashala (Ollama :11434, proxied via /api/karmashala/health)
```

| Layer | Stack | Location | Ports |
|-------|-------|----------|-------|
| Holographic Web | React 19 + R3F + Three.js + Zod-ready | `apps/web` | 5173 |
| Service & Orchestration | Express + Socket.IO + Mongoose + Helmet | `apps/server` | 4000 |
| Shared Types | TypeScript + Zod | `packages/shared` | — |
| Vision Pipeline | FastAPI + Pillow + numpy (offline) | `services/vision` | 5001 |
| Karmashala CLI | Ollama + keyword fallback | `services/karmashala` | 11434 |
| Geometry Core | C++17 (header-only) + CMake | `services/geometry` | — |
| .NET Orchestrator | ASP.NET 8 (IHttpClientFactory) | `services/orchestrator` | 5003 |

## Quick start

```bash
npm install                 # all workspaces
cp .env.example .env        # edit CORS_ORIGIN etc. if needed
npm run build               # shared → server → web

# Run web stack (server + web)
npm run dev                 # → http://localhost:5173  api http://localhost:4000/api/health

# Optional: Mongo persistence (otherwise in-memory)
docker compose up -d mongo  # or: docker run -d -p 27017:27017 --name astraforge-mongo mongo:7

# Optional: Vision offline mesh generation
npm run vision:setup        # venv + deps
npm run vision:dev          # FastAPI :5001 — or python services/vision/app.py

# Optional: Karmashala CLI
python services/karmashala/cli.py
# inside web terminal:  help · list projects · generate mesh from asset <id> · make it red
```

## Environment

See `.env.example` — validated via Zod in `apps/server/src/config.ts`:

```
PORT=4000  MONGODB_URI=mongodb://localhost:27017/astraforge
UPLOAD_DIR=./storage/uploads  MESH_DIR=./storage/meshes
VISION_SERVICE_URL=http://localhost:5001  GEOMETRY_SERVICE_URL=http://localhost:5002
OLLAMA_HOST=http://localhost:11434  OLLAMA_MODEL=llama3.2
CORS_ORIGIN=*  LOG_LEVEL=info
VISION_WORK_RES=96  VISION_MAX_HEIGHT=1.6  VISION_MAX_PIXELS=16000000
```

## API (v1)

`GET /api/health` · `GET /api/projects?limit&offset` · `POST /api/projects` · `GET/PUT/DELETE /api/projects/:id`
`GET /api/assets?projectId&status&limit&offset` · `POST /api/assets/upload` (multipart, 15 MB, image/*) · `PATCH /api/assets/:id` (transform) · `POST /api/assets/:id/vision` → `202 { job }`
`GET /api/jobs?status&type` · `POST /api/karmashala {text}` · `GET /api/karmashala/health`
`GET /meshes/<file>` (static, 1d cache) · `Socket.IO: job:subscribe, karmashala:command, scene:command`

All IDs are UUIDs. Paginated responses: `{ items, total, limit, offset }`.

## Roadmap

- [x] **Phase 0** — Monorepo + shared contracts (reborn with Zod)
- [x] **Phase 1** — Karmashala brain (Ollama + keyword fallback, scene intents)
- [x] **Phase 2** — Vision engine (offline height-field OBJ, preview thumbs)
- [x] **Phase 3** — Holographic stage (real mesh mounting, shader, explode)
- [ ] **Phase 4** — Precision engineering (CGAL booleans, Lego joints, watertight repair)

## Troubleshooting

- **Server shows `storage=memory` in /api/health** — Mongo not reachable; start `docker compose up -d mongo`.
- **Vision 404 image not found** — ensure `UPLOAD_DIR` matches Node & Python; in Docker both mount `apps/server/storage`.
- **Ollama offline** — optional; keyword classifier keeps Karmashala usable. Check `GET /api/karmashala/health`.
- **Port 4000 busy** — `EADDRINUSE` now logs a clear hint.

## Security notes

Helmet, CORS allowlist (`CORS_ORIGIN`), rate-limit, mimetype + ext double-check, path jail (`relative_to`), transform clamped, job path sanitized, no stack leaks in prod.

## License

Private — AstraForge.
