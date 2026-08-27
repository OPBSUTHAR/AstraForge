#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>

#include "../mesh/mesh_types.hpp"

namespace af {

inline std::string to_lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
  return s;
}

// Parses 'f 1/2/3 4/5/6 7/8/9' by taking the segment before any '/'
inline bool parse_face_index(const std::string& token, std::uint32_t& out) {
  std::string num = token;
  auto slash = num.find('/');
  if (slash != std::string::npos) num = num.substr(0, slash);
  if (num.empty() || num == "-" || num == "0") return false;
  try {
    out = static_cast<std::uint32_t>(std::stoul(num));
    return out != 0;
  } catch (...) {
    return false;
  }
}

inline bool load_obj(const std::string& path, Mesh& mesh) {
  std::ifstream in(path);
  if (!in) return false;
  mesh = Mesh();
  std::string line;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#') continue;
    std::istringstream ss(line);
    std::string kind;
    ss >> kind;
    if (kind == "v") {
      Vec3 v{0, 0, 0};
      if (!(ss >> v[0] >> v[1] >> v[2])) continue;
      mesh.vertices.push_back(v);
    } else if (kind == "f") {
      std::vector<std::string> tokens;
      std::string tok;
      while (ss >> tok) tokens.push_back(tok);
      if (tokens.size() < 3) continue;
      // Triangulate polygon fan
      std::vector<std::uint32_t> idx;
      for (auto& t : tokens) {
        std::uint32_t v = 0;
        if (parse_face_index(t, v)) idx.push_back(v - 1);
      }
      for (size_t i = 1; i + 1 < idx.size(); ++i) {
        mesh.faces.push_back({idx[0], idx[i], idx[i + 1]});
      }
    }
  }
  return !mesh.faces.empty();
}

inline bool save_obj(const std::string& path, const Mesh& mesh) {
  std::ofstream out(path);
  if (!out) return false;
  out << "# AstraForge geometry core v0.2\n";
  for (const auto& v : mesh.vertices) out << "v " << v[0] << ' ' << v[1] << ' ' << v[2] << '\n';
  for (const auto& f : mesh.faces) out << "f " << f[0] + 1 << ' ' << f[1] + 1 << ' ' << f[2] + 1 << '\n';
  return true;
}

inline bool load_stl_ascii(const std::string& path, Mesh& mesh) {
  std::ifstream in(path);
  if (!in) return false;
  std::string line;
  std::getline(in, line);
  // must start with 'solid'
  auto lower = to_lower(line);
  if (lower.find("solid") == std::string::npos) return false;
  mesh = Mesh();
  Vec3 tri[3];
  int k = 0;
  while (std::getline(in, line)) {
    std::istringstream ss(line);
    std::string word;
    ss >> word;
    word = to_lower(word);
    if (word == "vertex") {
      Vec3 v{0, 0, 0};
      ss >> v[0] >> v[1] >> v[2];
      tri[k++] = v;
      if (k == 3) {
        auto base = static_cast<std::uint32_t>(mesh.vertices.size());
        for (int i = 0; i < 3; ++i) mesh.vertices.push_back(tri[i]);
        mesh.faces.push_back({base, base + 1, base + 2});
        k = 0;
      }
    }
  }
  return !mesh.faces.empty();
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
  if (count == 0) return false;
  // Some exporters pad file; allow >=
  if (84ull + static_cast<std::uint64_t>(count) * 50ull > file_size) return false;
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
  const char header[80] = "AstraForge geometry core v0.2";
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
  auto lower = to_lower(path);
  if (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".obj") return load_obj(path, mesh);
  if (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".stl") {
    // try binary first, then ascii
    if (load_stl_binary(path, mesh)) return true;
    return load_stl_ascii(path, mesh);
  }
  // try obj then stl
  if (load_obj(path, mesh)) return true;
  return load_stl_binary(path, mesh);
}

}  // namespace af
