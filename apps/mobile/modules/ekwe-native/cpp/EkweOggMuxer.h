#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <array>
#include <cstdio>

namespace ekwe {

struct OggPage {
    std::vector<uint8_t> data;
    int64_t granule_position;
    int serial_number;
    int page_number;
    uint8_t segment_count;
};

class OggMuxer {
public:
    OggMuxer(const std::string& output_path, uint32_t sample_rate, int serial_number = 1);
    ~OggMuxer();

    bool is_ok() const { return ok_; }

    bool write_opus_header(int channels, int pre_skip, uint32_t input_sample_rate);
    bool write_opus_comment(const std::string& vendor = "Ekwe");
    bool write_packet(const uint8_t* opus_data, size_t opus_size, int64_t granule_position);

    bool finalize();

    OggMuxer(const OggMuxer&) = delete;
    OggMuxer& operator=(const OggMuxer&) = delete;

private:
    bool ok_;
    bool finalized_;
    std::FILE* file_;
    int serial_number_;
    int page_number_;
    int page_log_counter_;
    uint32_t sample_rate_;
    int64_t last_granule_position_;

    bool write_page(const OggPage& page);
    OggPage make_page(const uint8_t* data, size_t size, int64_t granule_position, bool bos, bool eos);
    std::array<uint8_t, 4> calculate_checksum(const OggPage& page);
};

} // namespace ekwe
