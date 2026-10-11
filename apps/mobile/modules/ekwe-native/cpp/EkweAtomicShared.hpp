#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

namespace ekwe {

// A cell that publishes a shared_ptr<const T> to readers that must never wait on
// a writer.
//
// std::atomic<std::shared_ptr<T>> is the obvious spelling and is what this
// replaced, but that is C++20 (P0718R2) and the libc++ shipped with NDK r27 —
// what the Android build compiles against — does not implement it, so the code
// did not build there. The C++11 std::atomic_load / std::atomic_store pair does
// exist in that libc++, but it serialises every access on one process-wide lock,
// which is exactly the lock a capture thread must never end up behind. So the
// publication is done by hand instead: a plain pointer published with release
// semantics, plus a reader count that holds a grace period open until the last
// reader able to see a superseded value has finished with it.
//
// Readers pay two atomic increments and a load — no allocation, no lock, and no
// waiting on the writer. Writers may block; they are the rare side (a callback
// assignment, a slot registering itself). Superseded values are held until a
// moment with no readers in it, so nothing leaks and nothing is freed underneath
// a reader. The one wait a reader can impose is on destruction, and only until
// the readers already inside load() have left it.
template <typename T>
class AtomicShared {
public:
    using Pointer = std::shared_ptr<const T>;

    AtomicShared() = default;
    ~AtomicShared() { destroy(); }

    AtomicShared(const AtomicShared&) = delete;
    AtomicShared& operator=(const AtomicShared&) = delete;

    // Writer side. The cell takes a reference of its own, so the caller may drop
    // theirs immediately.
    void store(Pointer value) {
        std::lock_guard<std::mutex> lock(writeMutex_);
        // The superseded value stays owned here until a reader-free moment, so
        // it cannot be freed while somebody is still reading through it.
        if (current_ != nullptr) {
            retired_.push_back(std::move(current_));
        }
        current_ = std::move(value);
        published_.store(current_.get(), std::memory_order_seq_cst);
        if (readers_.count.load(std::memory_order_seq_cst) == 0) {
            retired_.clear();
        }
    }

    // Reader side. The returned reference is valid for as long as the caller
    // keeps it: the reader count is released when the reference dies, and the
    // cell will not free a superseded value while that count is above zero.
    Pointer load() const {
        // seq_cst on both halves is load-bearing, not habit. The writer frees a
        // superseded value once it observes a zero count, and that only excludes
        // readers which entered before its publication. A reader entering after
        // that observation must be guaranteed to see the new value, and the
        // single total order over seq_cst operations is what guarantees it.
        readers_.count.fetch_add(1, std::memory_order_seq_cst);
        const T* value = published_.load(std::memory_order_seq_cst);
        if (value == nullptr) {
            readers_.count.fetch_sub(1, std::memory_order_seq_cst);
            return nullptr;
        }
        // Non-owning on purpose. The count, not this reference, is what keeps the
        // value alive; a real reference would also be the wrong shape here,
        // because taking one from a raw pointer is the very race being closed.
        // `this` outlives the deleter: the destructor does not return until the
        // count reaches zero, which is exactly when the last copy of a reference
        // handed out here is destroyed and this runs.
        return Pointer(value, [this](const T*) {
            readers_.count.fetch_sub(1, std::memory_order_seq_cst);
        });
    }

private:
    // Waits out any reader that could still hold a value this cell owns, then
    // lets go of all of them. Only for the destructor: a live cell releases a
    // superseded value as soon as it sees a moment with no readers in it.
    void destroy() {
        {
            std::lock_guard<std::mutex> lock(writeMutex_);
            // Unpublish first, so a reader that has not already entered cannot
            // obtain what is about to be freed.
            published_.store(nullptr, std::memory_order_seq_cst);
        }
        while (readers_.count.load(std::memory_order_seq_cst) != 0) {
            std::this_thread::yield();
        }
        std::lock_guard<std::mutex> lock(writeMutex_);
        current_.reset();
        retired_.clear();
    }

    struct Readers {
        std::atomic<uint32_t> count{0};
    };

    // Mutable because the reader side counts itself in, and load() is const:
    // a reader must not be able to observe the cell as anything but readable.
    mutable Readers readers_;

    mutable std::mutex writeMutex_;
    std::atomic<const T*> published_{nullptr};
    // The published value plus everything superseded, still owned here. The
    // reader count is what decides when a superseded value may go.
    std::shared_ptr<const T> current_;
    std::vector<std::shared_ptr<const T>> retired_;
};

} // namespace ekwe