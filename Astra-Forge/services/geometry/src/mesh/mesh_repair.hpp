#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "mesh_types.hpp"

namespace af {

inline bool nearly_equal(double a, double b, double eps = 1e-9) {
  return std::fabs(a - b) <= eps;
}

static double signed_volume(const Mesh& mesh) {
  double vol = 0.0;
  for (const auto& f : mesh.faces) {
    const Vec3& a = mesh.vertices[f[0]];
    const Vec3& b = mesh.vertices[f[1]];
    const Vec3& c = mesh.vertices[f[2]];
    vol += dot(a, cross(b, c)) / 6.0;
  }
  return vol;
}

static void flip_faces(Mesh& mesh) {
  for (auto& f : mesh.faces) std::swap(f[1], f[2]);
}

/** Merge vertices sharing the same position (within eps). */
inline void weld_vertices(Mesh& mesh, double eps = 1e-6) {
  using GridKey = std::tuple<long long, long long, long long>;
  auto key_of = [eps](const Vec3& v) {
    return GridKey(static_cast<long long>(std::round(v[0] / eps)),
                   static_cast<long long>(std::round(v[1] / eps)),
                   static_cast<long long>(std::round(v[2] / eps)));
  };
  std::map<GridKey, std::uint32_t> seen;
  std::vector<std::uint32_t> remap(mesh.vertices.size());
  std::vector<Vec3> out;
  out.reserve(mesh.vertices.size());
  for (std::size_t i = 0; i < mesh.vertices.size(); ++i) {
    const auto key = key_of(mesh.vertices[i]);
    const auto hit = seen.find(key);
    if (hit != seen.end()) {
      remap[i] = hit->second;
    } else {
      const auto idx = static_cast<std::uint32_t>(out.size());
      seen.emplace(key, idx);
      out.push_back(mesh.vertices[i]);
      remap[i] = idx;
    }
  }
  std::vector<std::array<std::uint32_t, 3>> faces;
  faces.reserve(mesh.faces.size());
  for (const auto& f : mesh.faces) {
    std::array<std::uint32_t, 3> r = {remap[f[0]], remap[f[1]], remap[f[2]]};
    if (r[0] != r[1] && r[1] != r[2] && r[0] != r[2]) faces.push_back(r);
  }
  mesh.vertices = std::move(out);
  mesh.faces = std::move(faces);
}

/** Drop faces with zero area. */
static void remove_degenerate_faces(Mesh& mesh) {
  std::vector<std::array<std::uint32_t, 3>> faces;
  faces.reserve(mesh.faces.size());
  for (const auto& f : mesh.faces) {
    const Vec3 n = cross(mesh.vertices[f[1]] - mesh.vertices[f[0]],
                         mesh.vertices[f[2]] - mesh.vertices[f[0]]);
    if (norm(n) > 1e-12) faces.push_back(f);
  }
  mesh.faces = std::move(faces);
}

/**
 * Unordered pair -> list of incident faces. Used for adjacency / boundary work.
 */
static std::unordered_map<std::uint64_t, std::vector<std::uint32_t>>
build_edge_adjacency(const Mesh& mesh, std::size_t* boundary_edges_out = nullptr) {
  const auto pair_key = [](std::uint32_t a, std::uint32_t b) {
    std::uint64_t lo = std::min(a, b), hi = std::max(a, b);
    return (hi << 32) | lo;
  };
  std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> edges;
  std::unordered_map<std::uint64_t, std::uint32_t> counts;
  for (std::size_t f = 0; f < mesh.faces.size(); ++f) {
    const auto& tri = mesh.faces[f];
    for (int k = 0; k < 3; ++k) {
      const auto key = pair_key(tri[k], tri[(k + 1) % 3]);
      edges[key].push_back(static_cast<std::uint32_t>(f));
      ++counts[key];
    }
  }
  if (boundary_edges_out) {
    std::size_t boundary = 0;
    for (const auto& entry : counts) { if (entry.second == 1) ++boundary; }
    *boundary_edges_out = boundary;
  }
  return edges;
}

/** Fix winding so all faces are consistently outward. */
inline void orient_consistent(Mesh& mesh) {
  if (mesh.faces.empty()) return;
  remove_degenerate_faces(mesh);
  const auto edges = build_edge_adjacency(mesh);

  std::vector<int> visited(mesh.faces.size(), 0);
  for (std::size_t start = 0; start < mesh.faces.size(); ++start) {
    if (visited[start]) continue;
    visited[start] = 1;
    std::vector<std::uint32_t> stack{static_cast<std::uint32_t>(start)};
    while (!stack.empty()) {
      const auto f = stack.back();
      stack.pop_back();
      const auto& tri = mesh.faces[f];
      for (int k = 0; k < 3; ++k) {
        const std::uint32_t a = tri[k], b = tri[(k + 1) % 3];
        auto it = edges.find((static_cast<std::uint64_t>(std::min(a, b)) << 32) | std::max(a, b));
        if (it == edges.end()) continue;
        for (const auto nf : it->second) {
          if (visited[nf]) continue;
          visited[nf] = 1;
          bool neighbor_has_ba = false;
          const auto& t2 = mesh.faces[nf];
          for (int j = 0; j < 3; ++j)
            if (t2[j] == b && t2[(j + 1) % 3] == a) neighbor_has_ba = true;
          if (!neighbor_has_ba) std::swap(mesh.faces[nf][1], mesh.faces[nf][2]);
          stack.push_back(nf);
        }
      }
    }
  }
  if (signed_volume(mesh) < 0) flip_faces(mesh);
}

inline bool is_watertight(const Mesh& mesh) {
  std::size_t boundary = 0;
  build_edge_adjacency(mesh, &boundary);
  return boundary == 0;
}

static double ray_triangle(const Vec3& o, const Vec3& d, const Vec3& a, const Vec3& b, const Vec3& c) {
  const double eps = 1e-9;
  const Vec3 e1 = b - a, e2 = c - a;
  const Vec3 pvec = cross(d, e2);
  const double det = dot(e1, pvec);
  if (std::fabs(det) < eps) return -1.0;
  const double inv = 1.0 / det;
  const Vec3 tvec = o - a;
  const double u = dot(tvec, pvec) * inv;
  if (u < 0.0 || u > 1.0) return -1.0;
  const Vec3 qvec = cross(tvec, e1);
  const double v = dot(d, qvec) * inv;
  if (v < 0.0 || u + v > 1.0) return -1.0;
  const double t = dot(e2, qvec) * inv;
  return t;
}

/**
 * Approximate minimum wall thickness: from each face centroid shoot a ray
 * along -normal and take the nearest hit (the far side of the local wall).
 */
inline double min_wall_thickness(const Mesh& mesh) {
  double min_t = std::numeric_limits<double>::infinity();
  for (std::size_t f = 0; f < mesh.faces.size(); ++f) {
    const Vec3& a = mesh.vertices[mesh.faces[f][0]];
    const Vec3& b = mesh.vertices[mesh.faces[f][1]];
    const Vec3& c = mesh.vertices[mesh.faces[f][2]];
    const Vec3 centroid = (a + b + c) * (1.0 / 3.0);
    const Vec3 n = mesh.face_normal(f);
    const Vec3 dir = { -n[0], -n[1], -n[2] };
    double best = std::numeric_limits<double>::infinity();
    for (std::size_t g = 0; g < mesh.faces.size(); ++g) {
      if (g == f) continue;
      const Vec3& p = mesh.vertices[mesh.faces[g][0]];
      const Vec3& q = mesh.vertices[mesh.faces[g][1]];
      const Vec3& r = mesh.vertices[mesh.faces[g][2]];
      const double t = ray_triangle(centroid, dir, p, q, r);
      if (t > 1e-9 && t < best) best = t;
    }
    if (best < min_t) min_t = best;
  }
  return min_t;
}

/**
 * Close boundary loops by fan-triangulating each loop to a new centroid
 * vertex. Handles simple single-loop holes (Phase-4 hardness lives in CGAL).
 */
inline void fill_small_holes(Mesh& mesh, std::size_t max_loop_size = 256) {
  const auto pair_key = [](std::uint32_t a, std::uint32_t b) {
    std::uint64_t lo = std::min(a, b), hi = std::max(a, b);
    return (hi << 32) | lo;
  };
  if (is_watertight(mesh)) return;

  for (int pass = 0; pass < 50; ++pass) {
    std::size_t boundary = 0;
    const auto edges = build_edge_adjacency(mesh, &boundary);
    if (boundary == 0) break;

    // collect one oriented loop starting from a boundary vertex
    std::uint32_t start = 0, prev = 0;
    for (const auto& entry : edges) {
      if (entry.second.size() == 1) { start = static_cast<std::uint32_t>(entry.first & 0xFFFFFFFFu); break; }
    }
    std::vector<std::uint32_t> loop{start};
    std::uint32_t cur = start;
    prev = start;
    for (int step = 0; step < 2000; ++step) {
      // find boundary edge from cur to a vertex other than prev
      std::uint32_t nxt = start;
      bool found = false;
      for (const auto& entry : edges) {
        if (entry.second.size() != 1) continue;
        const std::uint32_t a = static_cast<std::uint32_t>(entry.first >> 32);
        const std::uint32_t b = static_cast<std::uint32_t>(entry.first & 0xFFFFFFFF);
        if (a == cur && b != prev) { nxt = b; found = true; break; }
        if (b == cur && a != prev) { nxt = a; found = true; break; }
      }
      if (!found || nxt == start) break;
      loop.push_back(nxt);
      prev = cur;
      cur = nxt;
    }

    if (loop.size() < 3 || loop.size() > max_loop_size) break;

    Vec3 center = {0, 0, 0};
    for (auto v : loop) center = center + mesh.vertices[v];
    center = center * (1.0 / static_cast<double>(loop.size()));
    const auto new_idx = static_cast<std::uint32_t>(mesh.vertices.size());
    mesh.vertices.push_back(center);
    for (std::size_t i = 0; i < loop.size(); ++i) {
      const auto a = loop[i];
      const auto b = loop[(i + 1) % loop.size()];
      mesh.faces.push_back({new_idx, b, a});
    }
  }
}

}  // namespace af