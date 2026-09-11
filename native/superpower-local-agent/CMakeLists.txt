cmake_minimum_required(VERSION 3.24)

project(SuperpowerLocalAgent VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Widgets Sql Network)

add_library(superpower_local_core STATIC
  src/agent_core.cpp
  src/agent_core.h
  src/file_locator.cpp
  src/file_locator.h
  src/gui_event_bus.cpp
  src/gui_event_bus.h
  src/memory_store.cpp
  src/memory_store.h
)

target_include_directories(superpower_local_core PUBLIC src)
target_link_libraries(superpower_local_core PUBLIC Qt6::Core Qt6::Gui Qt6::Sql Qt6::Network)

add_executable(superpower-local-agent
  src/native_main.cpp
  src/native_messaging.cpp
  src/native_messaging.h
)
target_link_libraries(superpower-local-agent PRIVATE superpower_local_core Qt6::Core Qt6::Gui)

if(WIN32)
  add_executable(superpower-local-gui WIN32
    src/gui_main.cpp
    src/main_window.cpp
    src/main_window.h
  )
else()
  add_executable(superpower-local-gui
    src/gui_main.cpp
    src/main_window.cpp
    src/main_window.h
  )
endif()
target_link_libraries(superpower-local-gui PRIVATE superpower_local_core Qt6::Widgets Qt6::Network)

install(TARGETS superpower-local-agent superpower-local-gui
  RUNTIME DESTINATION bin
)
