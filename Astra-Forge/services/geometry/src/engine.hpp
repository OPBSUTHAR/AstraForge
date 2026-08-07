#pragma once

#include <iostream>
#include <limits>
#include <string>
#include <vector>

#include "io/mesh_io.hpp"
#include "mesh/boolean_ops.hpp"
#include "mesh/joints.hpp"
#include "mesh/mesh_repair.hpp"
#include "mesh/mesh_types.hpp"

namespace af {

struct MeshRepairOptions {
  bool weld = true;
  bool fill_holes = true;
  bool orient = true;
};

/** Load, clean and report basic stats for a mesh. */
inline bool mesh_info(const std::string& path) {
  Mesh mesh;
  if (!load_mesh(path, mesh)) {
    std::cerr << "error: could not read " << path << '\n';
    return false;
  }
  std::cout << "vertices:  " << mesh.vertex_count() << '\n';
  std::cout << "triangles: " << mesh.face_count() << '\n';
  std::cout << "watertight: " << (is_watertight(mesh) ? "yes" : "no") << '\n';
  std::cout << "min wall thickness: "
            << (min_wall_thickness(mesh) < std::numeric_limits<double>::infinity()
                    ? std::to_string(min_wall_thickness(mesh)) + " mm"
                    : "n/a (open mesh)")
            << '\n';
  return true;
}

/** Repair pipeline: weld -> orient outward -> close simple holes, then save. */
inline bool repair_mesh(const std::string& input, const std::string& output,
                        const MeshRepairOptions& opts = {}) {
  Mesh mesh;
  if (!load_mesh(input, mesh)) {
    std::cerr << "error: could not read " << input << '\n';
    return false;
  }
  if (opts.weld) weld_vertices(mesh);
  if (opts.orient) orient_consistent(mesh);
  if (opts.fill_holes) fill_small_holes(mesh);

  if (output.size() > 4 && output.substr(output.size() - 4) == ".obj")
    save_obj(output, mesh);
  else
    save_stl_binary(output, mesh);

  std::cout << "repaired -> " << output << " (watertight: "
            << (is_watertight(mesh) ? "yes" : "no") << ")\n";
  return true;
}

/** Split into peq_count slabs and emit joint pair G-code data (Phase 4). */
inline bool split_with_joints(const std::string& input, const std::string& output_prefix,
                              std::size_t part_count, double peg_diameter) {
  Mesh mesh;
  if (!load_mesh(input, mesh)) {
    std::cerr << "error: could not read " << input << '\n';
    return false;
  }
  weld_vertices(mesh);
  orient_consistent(mesh);

  const auto parts = split_parts_by_slab(mesh, part_count);
  JointSpec spec;
  if (peg_diameter > 0) spec.peg_diameter = peg_diameter;
  const auto joint_pair = make_joint_pair(spec);
  const Mesh& male = joint_pair.first;
  const Mesh& female = joint_pair.second;

  for (std::size_t i = 0; i < parts.size(); ++i) {
    const std::string out = output_prefix + "_part" + std::to_string(i + 1) + ".stl";
    save_stl_binary(out, parts[i]);
    std::cout << "part " << (i + 1) << " -> " << out << '\n';
  }
  save_stl_binary(output_prefix + "_joint_peg.stl", male);
  save_stl_binary(output_prefix + "_joint_housing.stl", female);
  std::cout << "joint peg/housing generated (" << male.face_count() << " / "
            << female.face_count() << " tris)\n";
  std::cout << "note: boolean carving into part seams ships with CGAL core (Phase 4)\n";
  return true;
}

}  // namespace af