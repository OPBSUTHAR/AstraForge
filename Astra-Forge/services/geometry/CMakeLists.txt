cmake_minimum_required(VERSION 3.20)
project(astraforge_geometry CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Header-only core (no external deps required to build).
add_library(astraforge_core INTERFACE)
target_include_directories(astraforge_core INTERFACE src)

add_executable(astraforge_cli src/cli.cpp)
target_link_libraries(astraforge_cli PRIVATE astraforge_core)

enable_testing()
add_executable(astraforge_tests tests/test_core.cpp)
target_link_libraries(astraforge_tests PRIVATE astraforge_core)
add_test(NAME geometry_tests COMMAND astraforge_tests)