#pragma once

#include "EkweAtomicShared.hpp"

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>

namespace ekwe {

// Non-owning view of one encoded frame, valid only for the duration of the
// callback that receives it. Handing one around costs nothing, which is what
// lets the host-side tests exercise the handoff with no copy at all.
struct ByteView {
    const uint8_t* data = nullptr;
    size_t size = 0;
};

// Traits for a packet type that is the borrowed bytes themselves.
struct ByteViewTraits {
    using Packet = ByteView;
    static Packet make(const uint8_t* data, size_t size) { return Packet{data, size}; }
};

// Lock-free handoff for the capture-thread → JS-thread callback pair.
//
// Capture callbacks arrive on a thread the JS thread never blocks on (the serial
// capture queue on iOS, the AudioRecord worker on Android), so a JS-thread
// assignment must never be able to stall an audio callback on a lock. Both
// callbacks live in one immutable snapshot published by a single atomic store:
// readers take a reference with atomic loads only — never a lock — and a
// half-updated pair is never observable.
//
// The two publications — the snapshot and the registry of the live slot — go
// through ekwe::AtomicShared rather than std::atomic<std::shared_ptr<T>>: that
// is a C++20 library feature the libc++ in the Android NDK does not have, and
// the C++11 replacement takes a process-wide lock this path cannot afford.
//
// Traits decides how a dispatched frame becomes the callback's packet argument,
// so the slot stores whatever type the consumer's callback actually takes. That
// keeps the packet copy in one place, and lets this header stay free of Nitro
// and JSI so the ordering can be exercised on the host.
template <typename Traits>
class CallbackSlot {
public:
    using Packet = typename Traits::Packet;
    using PacketFn = std::function<void(const Packet&, double)>;
    using EventFn = std::function<void()>;

    struct Snapshot {
        PacketFn onPacket;
        EventFn onEvent;
    };

    // Registers the live slot. Pass nullptr to unregister. The registry holds a
    // strong reference so a reader that has already loaded the slot keeps it
    // alive across the dereference below; otherwise teardown racing a capture
    // thread would free the slot mid-read.
    static void setActive(std::shared_ptr<const CallbackSlot> slot) {
        s_active.store(std::move(slot));
    }

    static std::shared_ptr<const CallbackSlot> active() {
        return s_active.load();
    }

    // Snapshot read for a capture thread. Safe with no active slot.
    static std::shared_ptr<const Snapshot> load() {
        auto slot = active();
        if (!slot) return nullptr;
        return slot->snapshot_.load();
    }

    std::shared_ptr<const Snapshot> get() const {
        return snapshot_.load();
    }

    void setPacketCallback(const PacketFn& fn) {
        std::lock_guard<std::mutex> lock(writeMutex_);
        Snapshot next;
        auto current = snapshot_.load();
        // Carry over the callback we are not changing, so assigning one never
        // silently drops the other.
        next.onEvent = current ? current->onEvent : EventFn();
        next.onPacket = fn;
        publish(std::move(next));
    }

    void setEventCallback(const EventFn& fn) {
        std::lock_guard<std::mutex> lock(writeMutex_);
        Snapshot next;
        auto current = snapshot_.load();
        next.onPacket = current ? current->onPacket : PacketFn();
        next.onEvent = fn;
        publish(std::move(next));
    }

    // Capture-thread entry points. No locking happens here; the packet is only
    // materialised once we know someone is listening.
    static bool dispatchPacket(const uint8_t* data, size_t size, double rms) {
        // Reject empty frames here rather than making every consumer check: a
        // callback is entitled to trust the packet it is handed.
        if (data == nullptr || size == 0) return false;
        auto snapshot = load();
        if (!snapshot || !snapshot->onPacket) return false;
        Packet packet = Traits::make(data, size);
        snapshot->onPacket(packet, rms);
        return true;
    }

    static bool dispatchEvent() {
        auto snapshot = load();
        if (!snapshot || !snapshot->onEvent) return false;
        snapshot->onEvent();
        return true;
    }

private:
    void publish(Snapshot next) {
        snapshot_.store(std::make_shared<const Snapshot>(std::move(next)));
    }

    AtomicShared<Snapshot> snapshot_;
    // Serialises read-modify-write between the two setters. Never taken by a
    // reader, which is the whole point.
    std::mutex writeMutex_;

    inline static AtomicShared<CallbackSlot> s_active;
};

} // namespace ekwe
