#pragma once

#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>

#include "../mesh/mesh_types.hpp"

namespace af {

inline bool load_obj(const std::string& path, Mesh& mesh) {
  std::ifstream in(path);
  if (!in) return false;
  mesh = Mesh();
  std::string line;
  while (std::getline(in, line)) {
    std::istringstream ss(line);
    char kind = 0;
    ss >> kind;
    if (kind == 'v') {
      Vec3 v{0, 0, 0};
      ss >> v[0] >> v[1] >> v[2];
      mesh.vertices.push_back(v);
    } else if (kind == 'f') {
      std::uint32_t a = 0, b = 0, c = 0;
      ss >> a >> b >> c;
      if (a && b && c) mesh.faces.push_back({a - 1, b - 1, c - 1});
    }
  }
  return !mesh.faces.empty();
}

inline bool save_obj(const std::string& path, const Mesh& mesh) {
  std::ofstream out(path);
  if (!out) return false;
  out << "# AstraForge geometry core\n";
  for (const auto& v : mesh.vertices) out << "v " << v[0] << ' ' << v[1] << ' ' << v[2] << '\n';
  for (const auto& f : mesh.faces)
    out << "f " << f[0] + 1 << ' ' << f[1] + 1 << ' ' << f[2] + 1 << '\n';
  return true;
}

inline bool load_stl_binary(const std::string& path, Mesh& mesh) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  in.seekg(0, std::ios::end);
  const auto size = in.tellg();
  in.seekg(0, std::ios::beg);
  if (size < 84) return false;
  const auto file_size = static_cast<std::uint64_t>(size);

  char header[80];
  in.read(header, 80);
  std::uint32_t count = 0;
  in.read(reinterpret_cast<char*>(&count), 4);
  if (count == 0 || (84ull + static_cast<std::uint64_t>(count) * 50ull) != file_size) return false;

  mesh = Mesh();
  std::uint32_t base = 0;
  for (std::uint32_t i = 0; i < count; ++i) {
    float normal[3] = {0, 0, 0};
    float vs[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
    std::uint16_t attr = 0;
    in.read(reinterpret_cast<char*>(normal), 12);
    in.read(reinterpret_cast<char*>(vs), 36);
    in.read(reinterpret_cast<char*>(&attr), 2);
    (void)normal;
    for (int k = 0; k < 3; ++k) mesh.vertices.push_back({vs[3 * k], vs[3 * k + 1], vs[3 * k + 2]});
    mesh.faces.push_back({base, base + 1, base + 2});
    base += 3;
  }
  return true;
}

inline bool save_stl_binary(const std::string& path, const Mesh& mesh) {
  std::ofstream out(path, std::ios::binary);
  if (!out) return false;
  const char header[80] = "AstraForge geometry core";
  out.write(header, 80);
  const std::uint32_t count = static_cast<std::uint32_t>(mesh.faces.size());
  out.write(reinterpret_cast<const char*>(&count), 4);
  for (std::size_t fi = 0; fi < mesh.faces.size(); ++fi) {
    const auto& f = mesh.faces[fi];
    const Vec3 n = mesh.face_normal(fi);
    const float normal[3] = {static_cast<float>(n[0]), static_cast<float>(n[1]), static_cast<float>(n[2])};
    out.write(reinterpret_cast<const char*>(normal), 12);
    for (int k = 0; k < 3; ++k) {
      const Vec3& v = mesh.vertices[f[k]];
      const float vv[3] = {static_cast<float>(v[0]), static_cast<float>(v[1]), static_cast<float>(v[2])};
      out.write(reinterpret_cast<const char*>(vv), 12);
    }
    const std::uint16_t attr = 0;
    out.write(reinterpret_cast<const char*>(&attr), 2);
  }
  return true;
}

inline bool load_mesh(const std::string& path, Mesh& mesh) {
  if (path.size() > 4 && path.substr(path.size() - 4) == ".obj") return load_obj(path, mesh);
  return load_stl_binary(path, mesh);
}

}  // namespace af