# AstraForge Geometry & Fabrication Core (C++17, header-only)

Mathematically safe mesh operations for 3D printing: repair, watertight
validation, wall-thickness checks, and Lego-style interlocking joint
generation. No external dependencies — plain C++17 so it always builds.
(Swap in CGAL/Open3D later for large-scale ops.)

## Build

```bash
cmake -S . -B build
cmake --build build --config Release
```

## CLI

```bash
build/astraforge_cli info  model.stl                 # stats + watertight check
build/astraforge_cli repair model.obj out.obj        # close holes, fix normals
build/astraforge_cli joints model.stl out.stl 4 1.2  # split into 4 + joints (peg Ø 1.2 mm)
```

## Layout

- `src/mesh/mesh_types.hpp` — `Mesh` (vertices/faces, stats)
- `src/mesh/mesh_repair.hpp` — hole filling, dedupe, normals, watertight, min wall
- `src/mesh/boolean_ops.hpp` — signed-volume boolean helpers
- `src/mesh/joints.hpp` — male/female snap-fit "Lego" joint generator
- `src/io/*.hpp` — OBJ / STL readers and writers
- `src/cli.cpp` — CLI entry point
- `tests/test_core.cpp` — unit tests (ctest)

## Roadmap (Phase 4)

- CGAL-managed Booleans (Nef polyhedra) for real CSG
- Tolerance-aware snap-fit solver driven by print-method (FDM/SLA)
- Multi-object packing and support generation