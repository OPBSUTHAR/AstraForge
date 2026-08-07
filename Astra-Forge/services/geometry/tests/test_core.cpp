#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>

#include "mesh/boolean_ops.hpp"
#include "mesh/joints.hpp"
#include "mesh/mesh_repair.hpp"
#include "mesh/mesh_types.hpp"
#include "io/mesh_io.hpp"

using namespace af;

static bool approx(double a, double b, double eps = 1e-9) {
  return std::fabs(a - b) <= eps;
}

static Mesh make_cube(double size = 2.0) {
  Mesh m;
  const double h = size / 2.0;
  const Vec3 c[8] = {
      {-h, -h, -h}, {h, -h, -h}, {h, h, -h}, {-h, h, -h},
      {-h, -h, h},  {h, -h, h},  {h, h, h},  {-h, h, h},
  };
  const std::uint32_t idx[6][4] = {
      {0, 1, 2, 3},  // bottom
      {5, 4, 7, 6},  // top
      {4, 0, 3, 7},  // left
      {1, 5, 6, 2},  // right
      {3, 2, 6, 7},  // back
      {4, 5, 1, 0},  // front
  };
  for (auto& quad : idx) {
    m.faces.push_back({quad[0], quad[1], quad[2]});
    m.faces.push_back({quad[0], quad[2], quad[3]});
  }
  for (const auto& v : c) m.vertices.push_back(v);
  return m;
}

int main() {
  // --- watertightness ---
  Mesh cube = make_cube();
  orient_consistent(cube);
  assert(is_watertight(cube));
  const double vol = std::fabs(signed_volume(cube));
  assert(approx(vol, 8.0, 1e-6));
  std::cout << "cube: watertight, volume=8\n";

  // --- hole closing ---
  Mesh holed = cube;
  holed.faces.pop_back();  // remove one face -> one boundary loop
  assert(!is_watertight(holed));
  fill_small_holes(holed);
  assert(is_watertight(holed));
  std::cout << "hole filled: watertight after fill\n";

  // --- welding duplicates ---
  Mesh dup = cube;
  dup.vertices.push_back(dup.vertices[0]);
  const auto before = dup.vertex_count();
  weld_vertices(dup);
  assert(dup.vertex_count() < before);
  std::cout << "weld: " << before << " -> " << dup.vertex_count() << " vertices\n";

  // --- slab split ---
  const auto parts = split_parts_by_slab(cube, 4);
  assert(parts.size() == 4);
  std::size_t tris = 0;
  for (const auto& p : parts) tris += p.face_count();
  assert(tris == cube.face_count());
  std::cout << "split: 4 parts, " << tris << " triangles preserved\n";

  // --- joints ---
  JointSpec spec;
  const auto joint = make_joint_pair(spec);
  const Mesh& male = joint.first;
  const Mesh& female = joint.second;
  assert(male.face_count() > 0 && female.face_count() > 0);
  std::cout << "joints: peg " << male.face_count() << " tris, housing "
            << female.face_count() << " tris\n";

  // --- io round trip ---
  const std::string tmp = "test_core_tmp.obj";
  save_obj(tmp, cube);
  Mesh reloaded;
  assert(load_obj(tmp, reloaded));
  assert(reloaded.face_count() == cube.face_count());
  std::remove(tmp.c_str());
  std::cout << "io: obj round-trip ok\n";

  std::cout << "ALL GEOMETRY TESTS PASSED\n";
  return EXIT_SUCCESS;
}