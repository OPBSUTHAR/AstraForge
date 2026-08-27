#pragma once

#include <cmath>
#include <cstdint>
#include <numbers>
#include <vector>

#include "mesh_types.hpp"

#ifndef M_PI
#define M_PI std::numbers::pi
#endif

namespace af {

/** Tolerances for a snap-fit joint pair (Lego-style). Dimensions in mm. */
struct JointSpec {
  double peg_diameter = 4.8;   // classic Lego stud Ø
  double peg_height = 1.8;
  double housing_clearance = 0.25;  // print tolerance added to housing Ø
  std::uint32_t radial_segments = 24;
};

/**
 * Build a male (peg) and female (housing) joint pair as capped cylinder
 * meshes centered at the origin, oriented along +Z. The fabrication engine
 * will booleans-carve these into part seams (Phase 4, CGAL).
 */
inline std::pair<Mesh, Mesh> make_joint_pair(const JointSpec& spec) {
  const auto make_cylinder = [&](double radius, double height, bool cap_bottom,
                                 bool cap_top) {
    Mesh m;
    const auto& seg = spec.radial_segments;
    std::vector<std::uint32_t> ring;
    for (std::uint32_t i = 0; i < seg; ++i) {
      const double a = 2.0 * M_PI * static_cast<double>(i) / static_cast<double>(seg);
      m.vertices.push_back({radius * std::cos(a), radius * std::sin(a), 0.0});
      m.vertices.push_back({radius * std::cos(a), radius * std::sin(a), height});
      ring.push_back(static_cast<std::uint32_t>(m.vertices.size() - 2));
    }
    // side quads
    for (std::uint32_t i = 0; i < seg; ++i) {
      const std::uint32_t next = (i + 1) % seg;
      const std::uint32_t a0 = ring[i], a1 = ring[next];
      const std::uint32_t b0 = a0 + 1, b1 = a1 + 1;
      m.faces.push_back({a0, a1, b1});
      m.faces.push_back({a0, b1, b0});
    }
    const auto add_cap = [&](double z) {
      const auto idx = static_cast<std::uint32_t>(m.vertices.size());
      m.vertices.push_back({0.0, 0.0, z});
      for (std::uint32_t i = 0; i < seg; ++i) {
        const std::uint32_t next = (i + 1) % seg;
        const std::uint32_t r0 = (z <= 0.0) ? ring[i] : ring[i] + 1;
        const std::uint32_t r1 = (z <= 0.0) ? ring[next] : ring[next] + 1;
        if (z <= 0.0) {
          m.faces.push_back({idx, r1, r0});  // bottom cap
        } else {
          m.faces.push_back({idx, r0, r1});  // top cap
        }
      }
    };
    if (cap_bottom) add_cap(0.0);
    if (cap_top) add_cap(height);
    return m;
  };

  const double peg_radius = spec.peg_diameter / 2.0;
  const double housing_radius = peg_radius + spec.housing_clearance;

  Mesh male = make_cylinder(peg_radius, spec.peg_height, true, true);
  Mesh female = make_cylinder(housing_radius, spec.peg_height + 0.8, true, false);
  return {male, female};
}

}  // namespace af