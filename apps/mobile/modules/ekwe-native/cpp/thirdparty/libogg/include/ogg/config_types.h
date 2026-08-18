#ifndef __CONFIG_TYPES_H__
#define __CONFIG_TYPES_H__

/* this is the generated config_types.h (from config_types.h.in) that
   autotools/cmake would emit into the build dir. It is platform-independent
   (int16_t/int32_t/int64_t are the same on every supported target), so it is
   checked in for the iOS CocoaPods build, which compiles these sources
   directly without a configure step. */

#define INCLUDE_INTTYPES_H 1
#define INCLUDE_STDINT_H 1
#define INCLUDE_SYS_TYPES_H 1

#if INCLUDE_INTTYPES_H
#  include <inttypes.h>
#endif
#if INCLUDE_STDINT_H
#  include <stdint.h>
#endif
#if INCLUDE_SYS_TYPES_H
#  include <sys/types.h>
#endif

typedef int16_t ogg_int16_t;
typedef uint16_t ogg_uint16_t;
typedef int32_t ogg_int32_t;
typedef uint32_t ogg_uint32_t;
typedef int64_t ogg_int64_t;
typedef uint64_t ogg_uint64_t;

#endif
