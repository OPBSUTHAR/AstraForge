#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace af {

using Vec3 = std::array<double, 3>;

inline Vec3 operator+(const Vec3& a, const Vec3& b) { return {a[0] + b[0], a[1] + b[1], a[2] + b[2]}; }
inline Vec3 operator-(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
inline Vec3 operator*(const Vec3& a, double s) { return {a[0] * s, a[1] * s, a[2] * s}; }
inline double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
inline double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}
inline Vec3 normalize(const Vec3& a) {
  const double n = norm(a);
  if (n <= 1e-12) return {0, 0, 0};
  return a * (1.0 / n);
}

/** Indexed triangle mesh. Faces are CCW with outward normals. */
struct Mesh {
  std::vector<Vec3> vertices;
  std::vector<std::array<std::uint32_t, 3>> faces;

  std::size_t vertex_count() const { return vertices.size(); }
  std::size_t face_count() const { return faces.size(); }
  bool empty() const { return faces.empty(); }
  void clear() {
    vertices.clear();
    faces.clear();
  }

  Vec3 face_normal(std::size_t f) const {
    const auto& idx = faces[f];
    Vec3 e1 = vertices[idx[1]] - vertices[idx[0]];
    Vec3 e2 = vertices[idx[2]] - vertices[idx[0]];
    Vec3 n = cross(e1, e2);
    double len = norm(n);
    if (len <= 1e-12) return {0, 0, 0};
    return n * (1.0 / len);
  }

  std::pair<Vec3, Vec3> bounds() const {
    if (vertices.empty()) return {{0, 0, 0}, {0, 0, 0}};
    Vec3 mn = vertices[0], mx = vertices[0];
    for (auto& v : vertices) {
      for (int i = 0; i < 3; ++i) {
        mn[i] = std::min(mn[i], v[i]);
        mx[i] = std::max(mx[i], v[i]);
      }
    }
    return {mn, mx};
  }
};

struct MeshStats {
  std::size_t vertices = 0;
  std::size_t triangles = 0;
  bool watertight = false;
  std::size_t boundary_edges = 0;
  double min_wall_thickness = std::numeric_limits<double>::infinity();
  double volume = 0.0;
};

struct HalfEdge {
  std::uint32_t vertex;
  std::uint32_t face;
  std::uint32_t next;
  std::uint32_t twin = UINT32_MAX;
};

}  // namespace af
