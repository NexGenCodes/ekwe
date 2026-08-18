#include "EkweOggMuxer.h"

#include <cstring>
#include <algorithm>
#include <cmath>

#if defined(__ANDROID__)
#include <android/log.h>
#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkveOgg", fmt, ##__VA_ARGS__)
#else
#include <cstdio>
#define ALOG(fmt, ...) std::printf("[EkveOgg] " fmt "\n", ##__VA_ARGS__)
#endif

namespace ekwe {

static const size_t OGG_PAGE_HEADER_SIZE = 27;
static const size_t MAX_SEGMENTS = 255;
static const size_t MAX_PAGE_DATA = MAX_SEGMENTS * 255;

OggMuxer::OggMuxer(const std::string& output_path, uint32_t sample_rate, int serial_number)
    : ok_(false)
    , finalized_(false)
    , file_(nullptr)
    , serial_number_(serial_number)
    , page_number_(0)
    , page_log_counter_(0)
    , sample_rate_(sample_rate)
    , last_granule_position_(0)
{
    ALOG("constructor: path=%s", output_path.c_str());
#ifdef _MSC_VER
    fopen_s(&file_, output_path.c_str(), "wb");
#else
    file_ = std::fopen(output_path.c_str(), "wb");
#endif
    if (!file_) {
        ALOG("constructor: fopen failed for path=%s", output_path.c_str());
        return;
    }
    ok_ = true;
    ALOG("constructor: SUCCESS");
}

OggMuxer::~OggMuxer() {
    if (file_) {
        std::fclose(file_);
        file_ = nullptr;
    }
}

bool OggMuxer::write_opus_header(int channels, int pre_skip, uint32_t input_sample_rate) {
    if (!ok_) return false;

    // OpusHead packet (19 bytes)
    uint8_t header[19];
    std::memset(header, 0, sizeof(header));
    header[0] = 'O';
    header[1] = 'p';
    header[2] = 'u';
    header[3] = 's';
    header[4] = 'H';
    header[5] = 'e';
    header[6] = 'a';
    header[7] = 'd';
    header[8] = 1; // Version
    header[9] = static_cast<uint8_t>(channels);
    header[10] = static_cast<uint8_t>(pre_skip & 0xFF);
    header[11] = static_cast<uint8_t>((pre_skip >> 8) & 0xFF);
    header[12] = static_cast<uint8_t>(input_sample_rate & 0xFF);
    header[13] = static_cast<uint8_t>((input_sample_rate >> 8) & 0xFF);
    header[14] = static_cast<uint8_t>((input_sample_rate >> 16) & 0xFF);
    header[15] = static_cast<uint8_t>((input_sample_rate >> 24) & 0xFF);
    // Output gain (16-bit signed, little-endian)
    header[16] = 0;
    header[17] = 0;
    // Mapping family
    header[18] = 0; // Mono/stereo

    OggPage page = make_page(header, sizeof(header), 0, true, false);
    return write_page(page);
}

bool OggMuxer::write_opus_comment(const std::string& vendor) {
    if (!ok_) {
        ALOG("write_opus_comment: not ok");
        return false;
    }
    ALOG("write_opus_comment: vendor=%s", vendor.c_str());

    std::vector<uint8_t> comment;
    // Magic string "OpusTags"
    const char* magic = "OpusTags";
    comment.insert(comment.end(), magic, magic + 8);

    // Vendor string length (32-bit LE)
    uint32_t vendor_len = static_cast<uint32_t>(vendor.size());
    comment.push_back(static_cast<uint8_t>(vendor_len & 0xFF));
    comment.push_back(static_cast<uint8_t>((vendor_len >> 8) & 0xFF));
    comment.push_back(static_cast<uint8_t>((vendor_len >> 16) & 0xFF));
    comment.push_back(static_cast<uint8_t>((vendor_len >> 24) & 0xFF));
    comment.insert(comment.end(), vendor.begin(), vendor.end());
    // User comment list length (32-bit LE) — 0 comments
    comment.push_back(0);
    comment.push_back(0);
    comment.push_back(0);
    comment.push_back(0);

    OggPage page = make_page(comment.data(), comment.size(), 0, false, false);
    return write_page(page);
}

bool OggMuxer::write_packet(const uint8_t* opus_data, size_t opus_size, int64_t granule_position) {
    if (!ok_) {
        ALOG("write_packet: not ok");
        return false;
    }
    ALOG("write_packet: size=%zu gp=%lld", opus_size, (long long)granule_position);
    last_granule_position_ = granule_position;
    OggPage page = make_page(opus_data, opus_size, granule_position, false, false);
    return write_page(page);
}

bool OggMuxer::finalize() {
    if (!ok_ || finalized_) {
        ALOG("finalize: skipped ok=%d finalized=%d", ok_, finalized_);
        return false;
    }
    ALOG("finalize: last_gp=%lld", (long long)last_granule_position_);
    finalized_ = true;

    // Write an empty page with EOS flag to properly terminate the Ogg stream
    // Per RFC 7845, the final page must have the EOS flag set
    OggPage page = make_page(nullptr, 0, last_granule_position_, false, true);
    write_page(page);

    if (file_) {
        std::fflush(file_);
    }
    return true;
}

bool OggMuxer::write_page(const OggPage& page) {
    if (!file_) {
        ALOG("write_page: no file");
        return false;
    }

    if (++page_log_counter_ % 50 == 1 || page.page_number < 5) {
        ALOG("write_page: pn=%d gp=%lld size=%zu", page.page_number, (long long)page.granule_position, page.data.size());
    }

    size_t written = std::fwrite(page.data.data(), 1, page.data.size(), file_);
    if (written != page.data.size()) {
        ok_ = false;
        return false;
    }
    return true;
}

OggPage OggMuxer::make_page(const uint8_t* data, size_t size, int64_t granule_position, bool bos, bool eos) {
    OggPage page;
    page.granule_position = granule_position;
    page.serial_number = serial_number_;
    page.page_number = page_number_++;

    // Compute the segment count in size_t BEFORE narrowing: for a page with
    // exactly 255*256 bytes of data, (size + 254) / 255 is 256 which wraps to
    // 0 when cast to uint8_t — silently producing a 0-segment page with a
    // bogus table. Clamp data to the page capacity first so the count is
    // always a valid 1..255 value.
    size_t segment_count = (size + 254) / 255;
    if (segment_count > MAX_SEGMENTS) {
        segment_count = MAX_SEGMENTS;
        size = MAX_PAGE_DATA;
    }
    page.segment_count = static_cast<uint8_t>(segment_count);

    size_t total_size = OGG_PAGE_HEADER_SIZE + page.segment_count + size;
    page.data.resize(total_size);

    // OggS magic
    page.data[0] = 'O';
    page.data[1] = 'g';
    page.data[2] = 'g';
    page.data[3] = 'S';

    // Stream version
    page.data[4] = 0;

    // Header type flag
    uint8_t header_type = 0;
    if (bos) header_type |= 0x02;
    if (eos) header_type |= 0x04;
    page.data[5] = header_type;

    // Granule position (64-bit LE)
    int64_t gp = granule_position;
    for (int i = 0; i < 8; ++i) {
        page.data[6 + i] = static_cast<uint8_t>(gp & 0xFF);
        gp >>= 8;
    }

    // Bitstream serial number (32-bit LE)
    uint32_t sn = static_cast<uint32_t>(serial_number_);
    for (int i = 0; i < 4; ++i) {
        page.data[14 + i] = static_cast<uint8_t>(sn & 0xFF);
        sn >>= 8;
    }

    // Page number (32-bit LE)
    uint32_t pn = static_cast<uint32_t>(page.page_number);
    for (int i = 0; i < 4; ++i) {
        page.data[18 + i] = static_cast<uint8_t>(pn & 0xFF);
        pn >>= 8;
    }

    // Checksum placeholder
    std::memset(&page.data[22], 0, 4);

    // Segment count
    page.data[26] = page.segment_count;

    // Segment table
    size_t remaining = size;
    for (int i = 0; i < page.segment_count; ++i) {
        size_t seg_size = (remaining > 255) ? 255 : remaining;
        page.data[OGG_PAGE_HEADER_SIZE + i] = static_cast<uint8_t>(seg_size);
        remaining -= seg_size;
    }

    // Packet data
    size_t offset = OGG_PAGE_HEADER_SIZE + page.segment_count;
    std::memcpy(&page.data[offset], data, size);

    // Calculate and write checksum
    auto checksum = calculate_checksum(page);
    std::memcpy(&page.data[22], checksum.data(), 4);

    return page;
}

std::vector<uint8_t> OggMuxer::calculate_checksum(const OggPage& page) {
    // CRC32 for Ogg pages
    static const uint32_t crc_table[256] = {
        0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9,
        0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005,
        0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61,
        0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
        0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9,
        0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75,
        0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011,
        0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
        0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039,
        0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5,
        0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81,
        0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
        0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49,
        0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95,
        0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1,
        0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
        0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae,
        0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072,
        0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16,
        0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
        0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde,
        0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02,
        0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066,
        0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
        0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e,
        0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692,
        0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6,
        0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
        0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e,
        0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2,
        0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686,
        0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
        0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637,
        0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb,
        0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f,
        0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
        0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47,
        0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b,
        0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff,
        0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
        0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7,
        0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b,
        0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f,
        0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
        0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7,
        0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b,
        0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f,
        0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
        0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640,
        0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c,
        0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8,
        0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
        0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30,
        0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec,
        0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088,
        0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
        0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0,
        0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c,
        0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18,
        0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
        0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0,
        0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c,
        0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668,
        0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4,
    };

    uint32_t crc = 0;
    for (size_t i = 0; i < page.data.size(); ++i) {
        crc = (crc << 8) ^ crc_table[((crc >> 24) ^ page.data[i]) & 0xFF];
    }

    std::vector<uint8_t> result(4);
    result[0] = static_cast<uint8_t>(crc & 0xFF);
    result[1] = static_cast<uint8_t>((crc >> 8) & 0xFF);
    result[2] = static_cast<uint8_t>((crc >> 16) & 0xFF);
    result[3] = static_cast<uint8_t>((crc >> 24) & 0xFF);
    return result;
}

} // namespace ekwe
