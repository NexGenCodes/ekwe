# Install script for directory: C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "C:/Program Files (x86)/EkweNative")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "RelWithDebInfo")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Install shared libraries without execute permission?
if(NOT DEFINED CMAKE_INSTALL_SO_NO_EXE)
  set(CMAKE_INSTALL_SO_NO_EXE "0")
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "TRUE")
endif()

# Set default install directory permissions.
if(NOT DEFINED CMAKE_OBJDUMP)
  set(CMAKE_OBJDUMP "C:/Users/USER/AppData/Local/Android/Sdk/ndk/27.0.12077973/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-objdump.exe")
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY FILES "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/libogg.a")
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/include/ogg" TYPE FILE FILES
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/include/ogg/config_types.h"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/include/ogg/ogg.h"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/include/ogg/os_types.h"
    )
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  if(EXISTS "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg/OggTargets.cmake")
    file(DIFFERENT EXPORT_FILE_CHANGED FILES
         "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg/OggTargets.cmake"
         "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/CMakeFiles/Export/lib/cmake/Ogg/OggTargets.cmake")
    if(EXPORT_FILE_CHANGED)
      file(GLOB OLD_CONFIG_FILES "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg/OggTargets-*.cmake")
      if(OLD_CONFIG_FILES)
        message(STATUS "Old export file \"$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg/OggTargets.cmake\" will be replaced.  Removing files [${OLD_CONFIG_FILES}].")
        file(REMOVE ${OLD_CONFIG_FILES})
      endif()
    endif()
  endif()
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg" TYPE FILE FILES "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/CMakeFiles/Export/lib/cmake/Ogg/OggTargets.cmake")
  if("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg" TYPE FILE FILES "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/CMakeFiles/Export/lib/cmake/Ogg/OggTargets-relwithdebinfo.cmake")
  endif()
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/Ogg" TYPE FILE FILES
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/OggConfig.cmake"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/OggConfigVersion.cmake"
    )
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/pkgconfig" TYPE FILE FILES "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/android/.cxx/RelWithDebInfo/4a37615e/arm64-v8a/libogg_build/ogg.pc")
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/share/doc/libogg/html" TYPE FILE FILES
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/framing.html"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/index.html"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/oggstream.html"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/ogg-multiplex.html"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/fish_xiph_org.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/multiplex1.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/packets.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/pages.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/stream.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/vorbisword2.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/white-ogg.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/white-xifish.png"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/rfc3533.txt"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/rfc5334.txt"
    "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/skeleton.html"
    )
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/share/doc/libogg/html" TYPE DIRECTORY FILES "C:/Users/USER/Desktop/ekwe2/modules/ekwe-native/cpp/thirdparty/libogg/doc/libogg")
endif()

