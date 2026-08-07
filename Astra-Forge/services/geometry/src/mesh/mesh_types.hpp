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

  Vec3 face_normal(std::size_t f) const {
    const auto& idx = faces[f];
    return normalize(cross(vertices[idx[1]] - vertices[idx[0]], vertices[idx[2]] - vertices[idx[0]]));
  }

  bool empty() const { return faces.empty(); }
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
  std::uint32_t vertex;       // start vertex
  std::uint32_t face;         // owning face
  std::uint32_t next;         // next half-edge in face (index into half_edges)
  std::uint32_t twin = UINT32_MAX;
};

}  // namespace af