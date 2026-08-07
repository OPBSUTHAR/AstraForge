#pragma once

#include <algorithm>
#include <limits>
#include <vector>

#include "mesh_types.hpp"
#include "mesh_repair.hpp"

namespace af {

struct Bounds {
  Vec3 min;
  Vec3 max;
};

inline Bounds bounds_of(const Mesh& mesh) {
  const double inf = std::numeric_limits<double>::infinity();
  Bounds b{{inf, inf, inf}, {-inf, -inf, -inf}};
  for (const auto& v : mesh.vertices) {
    for (int i = 0; i < 3; ++i) {
      b.min[i] = std::min(b.min[i], v[i]);
      b.max[i] = std::max(b.max[i], v[i]);
    }
  }
  return b;
}

inline int longest_axis(const Bounds& b) {
  const double dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
  if (dx >= dy && dx >= dz) return 0;
  if (dy >= dz) return 1;
  return 2;
}

/**
 * Split a mesh into `n` slabs along its longest axis and pack each slab's
 * triangles into its own Mesh, tagging every triangle with a part id.
 * A lightweight stand-in for real CSG plane-clipping until CGAL is wired in.
 */
inline std::vector<Mesh> split_parts_by_slab(const Mesh& mesh, std::size_t n) {
  std::vector<Mesh> parts(n);
  if (n == 1) { parts[0] = mesh; return parts; }
  const Bounds b = bounds_of(mesh);
  const int axis = longest_axis(b);
  const double lo = b.min[axis], span = (b.max[axis] - b.min[axis]) / static_cast<double>(n);
  const double eps = 1e-9;

  for (const auto& f : mesh.faces) {
    double t_min = std::numeric_limits<double>::infinity();
    double t_max = -std::numeric_limits<double>::infinity();
    for (int k = 0; k < 3; ++k) {
      t_min = std::min(t_min, mesh.vertices[f[k]][axis]);
      t_max = std::max(t_max, mesh.vertices[f[k]][axis]);
    }
    const double centroid_t = (t_min + t_max) * 0.5;
    std::size_t idx = 0;
    if (span > eps) {
      idx = static_cast<std::size_t>(std::min<double>(n - 1, (centroid_t - lo) / span));
    }
    parts[idx].faces.push_back(f);
  }

  // copy only referenced vertices into each part
  for (auto& part : parts) {
    std::vector<std::uint32_t> remap(mesh.vertices.size(), UINT32_MAX);
    for (auto& f : part.faces) {
      for (int k = 0; k < 3; ++k) {
        const std::uint32_t v = f[k];
        if (remap[v] == UINT32_MAX) {
          remap[v] = static_cast<std::uint32_t>(part.vertices.size());
          part.vertices.push_back(mesh.vertices[v]);
        }
        f[k] = remap[v];
      }
    }
  }
  return parts;
}

}  // namespace af