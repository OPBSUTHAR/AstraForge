#include <cstdlib>
#include <iostream>
#include <string>

#include "engine.hpp"

namespace {
void usage() {
  std::cout << "astraforge_cli — geometry & fabrication core\n"
            << "  info   <in.obj|in.stl>                 show mesh stats\n"
            << "  repair <in> <out.obj|out.stl>          weld + orient + close holes\n"
            << "  joints <in> <out_prefix> [parts=4] [peg_mm=4.8]\n"
            << "                                         split into parts + joint pair\n";
}

int handle(int argc, char** argv) {
  using namespace af;
  const std::string cmd = argv[1];
  if (cmd == "info" && argc >= 3) {
    return mesh_info(argv[2]) ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (cmd == "repair" && argc >= 5) {
    return repair_mesh(argv[2], argv[3]) ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (cmd == "joints" && argc >= 4) {
    const std::size_t parts = argc >= 5 ? std::stoul(argv[4]) : 4;
    const double peg = argc >= 6 ? std::stod(argv[5]) : 4.8;
    return split_with_joints(argv[2], argv[3], parts, peg) ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  usage();
  return EXIT_FAILURE;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    usage();
    return EXIT_FAILURE;
  }
  return handle(argc, argv);
}