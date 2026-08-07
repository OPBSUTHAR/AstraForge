# Project AstraForge

> A Tony Stark-style holographic design space that bridges **2D images**, **AI generation**, and **precise physical fabrication**.

## Layers

| Layer | Stack | Location |
| --- | --- | --- |
| Holographic Web Space | React + React Three Fiber (Three.js, WebGL shaders) | `apps/web` |
| Service & Orchestration | Node.js / Express + Socket.IO (MERN backend) | `apps/server` |
| Shared Types | TypeScript contracts | `packages/shared` |
| Vision Pipeline | Python — `rembg` bg-removal → Trellis/SF3D mesh gen | `services/vision` |
| Karmashala CLI | Ollama (Llama 3) terminal AI assistant | `services/karmashala` |
| Geometry & Fabrication Core | C++ (CGAL / Open3D), mesh repair + Lego-style snap joints | `services/geometry` |
| .NET Orchestrator | C# host bridging vision / geometry / web | `services/orchestrator` |

## Monorepo layout

```
Astra-Forge/
├── apps/
│   ├── server/     # Express + Socket.IO + MongoDB API
│   └── web/        # Vite + React + React Three Fiber hologram UI
├── packages/
│   └── shared/     # shared TypeScript types
├── services/
│   ├── vision/        # Python: background removal + image-to-mesh
│   ├── karmashala/    # terminal AI assistant (Ollama)
│   ├── geometry/      # C++ geometry / fabrication core
│   └── orchestrator/  # C# .NET bridge layer
```

## Getting started

### Prerequisites
- Node.js 20+, npm 10+
- Python 3.10+
- CMake + C++17 compiler (geometry core)
- .NET 8+ SDK (orchestrator, optional)
- Ollama with a llama3 model (Karmashala CLI)

### Install

```bash
npm install                 # installs all npm workspaces
npm run vision:setup        # creates services/vision/.venv + deps (optional)
```

### Run the web stack

```bash
npm run dev                 # starts server (:4000) + web (:5173) together
```

## Roadmap status

- [x] **Phase 0** — Monorepo foundation, workspaces, shared types
- [ ] **Phase 1** — Karmashala CLI brain (Ollama + intent parsing)
- [ ] **Phase 2** — Vision engine (2D image → 3D mesh)
- [ ] **Phase 3** — Holographic interface (shaders, explode view)
- [ ] **Phase 4** — Precision engineering (mesh repair + Lego joints)