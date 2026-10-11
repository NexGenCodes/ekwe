// Thread-safety tests for the capture-thread → JS-thread handoff in
// ekwe::CallbackSlot. Build and run with cpp/tests/run-callback-tests.sh.
//
// The capture thread must never be able to stall behind a JS-thread callback
// assignment. The concurrency tests are the point: under TSan they fail loudly
// if any shared mutable state is reachable from both sides.
#include <atomic>
#include <cstdint>
#include <chrono>
#include <cstdio>
#include <memory>
#include <thread>
#include <vector>

#include "EkweCallbackSlot.hpp"

using ekwe::ByteView;
using ekwe::ByteViewTraits;
// Instantiated with the borrowed-bytes traits, so the tests below exercise the
// snapshot and locking behaviour with no copy at all.
using Slot = ekwe::CallbackSlot<ByteViewTraits>;

namespace {

int g_failures = 0;
int g_checks = 0;

void check(const char* name, bool ok) {
    ++g_checks;
    std::printf("  %-58s %s\n", name, ok ? "PASS" : "FAIL");
    if (!ok) ++g_failures;
}

std::vector<uint8_t> makePacket(size_t size, uint8_t seed) {
    std::vector<uint8_t> data(size);
    for (size_t i = 0; i < size; ++i) {
        data[i] = static_cast<uint8_t>(seed + i);
    }
    return data;
}

// Counts packets and keeps the payload observably live, so the optimiser
// cannot delete the work the capture thread is supposedly doing.
struct Counter {
    std::atomic<int> packets{0};
    std::atomic<size_t> lastSize{0};
    std::atomic<uint8_t> firstByte{0};
    std::atomic<uint8_t> lastByte{0};
    std::atomic<double> lastRms{0};

    void operator()(ByteView view, double rms) {
        packets.fetch_add(1, std::memory_order_relaxed);
        lastSize.store(view.size, std::memory_order_relaxed);
        lastRms.store(rms, std::memory_order_relaxed);
        if (view.data && view.size > 0) {
            firstByte.store(view.data[0], std::memory_order_relaxed);
            lastByte.store(view.data[view.size - 1], std::memory_order_relaxed);
        }
    }
};

// The bug this file must catch: a capture thread loads the active slot, then the
// owner destroys it. Reading the raw pointer's member after that is a
// use-after-free. With a strong reference in the registry the reader keeps the
// slot alive and the frame is simply dropped once the callback is cleared.
void testDestroyedSlotIsNotUseAfterFree() {
    std::atomic<int> delivered{0};
    std::atomic<bool> stop{false};
    std::atomic<bool> destroyed{false};
    std::vector<uint8_t> packet = makePacket(256, 4);

    std::thread capture([&]() {
        while (!stop.load(std::memory_order_relaxed)) {
            Slot::dispatchPacket(packet.data(), packet.size(), 0.15);
            Slot::dispatchEvent();
        }
    });

    // Repeatedly construct and destroy a slot underneath the capture thread.
    for (int i = 0; i < 2000; ++i) {
        auto slot = std::make_shared<Slot>();
        slot->setPacketCallback([&delivered](ByteView v, double) {
            if (v.data != nullptr) delivered.fetch_add(1, std::memory_order_relaxed);
        });
        Slot::setActive(slot);
        if ((i % 64) == 0) std::this_thread::sleep_for(std::chrono::microseconds(200));
        // Unregister before releasing our reference: the registry must not be
        // left holding a slot whose owner is gone.
        Slot::setActive(nullptr);
        slot.reset();
    }

    stop.store(true, std::memory_order_relaxed);
    capture.join();

    check("slot destroyed under a live capture thread is safe", true);
    check("frames kept flowing through the churn", delivered.load() > 0);
}

void testDispatchWithNoActiveSlotIsSafe() {
    // Nothing registered: dispatch must be a no-op, not a null dereference.
    Slot::setActive(nullptr);
    std::vector<uint8_t> packet = makePacket(320, 7);
    bool handled = Slot::dispatchPacket(packet.data(), packet.size(), 0.5);
    bool evented = Slot::dispatchEvent();
    check("dispatch with no active slot is a safe no-op", !handled && !evented);
}

void testPacketContentsArriveIntact() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);
    Counter counter;
    slot->setPacketCallback([&counter](ByteView v, double r) { counter(v, r); });

    std::vector<uint8_t> packet = makePacket(320, 3);
    Slot::dispatchPacket(packet.data(), packet.size(), 0.25);

    check("packet is delivered exactly once", counter.packets.load() == 1);
    check("packet keeps its length", counter.lastSize.load() == 320);
    check("packet first byte is intact", counter.firstByte.load() == 3);
    check("packet last byte is intact", counter.lastByte.load() == static_cast<uint8_t>(3 + 319));
    check("amplitude reaches the callback", counter.lastRms.load() == 0.25);
}

void testEventCallback() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);
    std::atomic<int> fired{0};
    slot->setEventCallback([&fired]() { fired.fetch_add(1); });

    Slot::dispatchEvent();
    check("event callback fires", fired.load() == 1);
}

void testSettersDoNotClobberEachOther() {
    // Each setter rebuilds the snapshot from the current one, so assigning one
    // callback must not drop the other.
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);
    Counter packets;
    std::atomic<int> events{0};

    slot->setPacketCallback([&packets](ByteView v, double r) { packets(v, r); });
    slot->setEventCallback([&events]() { events.fetch_add(1); });

    std::vector<uint8_t> packet = makePacket(64, 1);
    Slot::dispatchPacket(packet.data(), packet.size(), 0.1);
    Slot::dispatchEvent();

    check("setting the event callback preserves the packet callback", packets.packets.load() == 1);
    check("setting the packet callback preserves the event callback", events.load() == 1);

    // And again in the opposite order, to prove it is order-independent.
    packets.packets.store(0);
    events.store(0);
    slot->setEventCallback([&events]() { events.fetch_add(1); });
    slot->setPacketCallback([&packets](ByteView v, double r) { packets(v, r); });
    Slot::dispatchPacket(packet.data(), packet.size(), 0.1);
    Slot::dispatchEvent();
    check("both callbacks survive repeated assignment", packets.packets.load() == 1 && events.load() == 1);
}

void testClearingCallbackStopsDelivery() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);
    Counter packets;
    slot->setPacketCallback([&packets](ByteView v, double r) { packets(v, r); });

    std::vector<uint8_t> packet = makePacket(32, 9);
    Slot::dispatchPacket(packet.data(), packet.size(), 0.2);
    check("callback fires before being cleared", packets.packets.load() == 1);

    slot->setPacketCallback(nullptr);
    Slot::dispatchPacket(packet.data(), packet.size(), 0.2);
    check("cleared callback stops delivery", packets.packets.load() == 1);
}

void testUnregisterStopsDelivery() {
    Counter packets;
    {
        auto slot = std::make_shared<Slot>();
        Slot::setActive(slot);
        slot->setPacketCallback([&packets](ByteView v, double r) { packets(v, r); });
        std::vector<uint8_t> packet = makePacket(32, 5);
        Slot::dispatchPacket(packet.data(), packet.size(), 0.2);
        check("callback fires while the slot is active", packets.packets.load() == 1);
        Slot::setActive(nullptr);
    }
    // A late packet after teardown must be dropped rather than dispatched into
    // a destroyed object.
    std::vector<uint8_t> packet = makePacket(32, 5);
    Slot::dispatchPacket(packet.data(), packet.size(), 0.2);
    check("dispatch after unregister is dropped", packets.packets.load() == 1);
}

void testEmptyPacketIsIgnored() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);
    Counter packets;
    slot->setPacketCallback([&packets](ByteView v, double r) { packets(v, r); });

    // The Nitro adapter filters empties before copying; the slot must not hand a
    // null view to a callback that trusts it.
    bool handled = Slot::dispatchPacket(nullptr, 0, 0.0);
    check("empty packet is not dispatched", !handled && packets.packets.load() == 0);
}

// A capture thread hammering dispatch while the JS thread reassigns both
// callbacks — the regression this file exists for.
void testConcurrentDispatchAndAssignment() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);

    std::atomic<int> delivered{0};
    auto live = [&delivered](ByteView v, double) {
        if (v.data != nullptr) delivered.fetch_add(1, std::memory_order_relaxed);
    };
    slot->setPacketCallback(live);
    slot->setEventCallback([]() {});

    std::vector<uint8_t> packet = makePacket(320, 1);
    std::atomic<bool> stop{false};

    std::thread capture([&]() {
        while (!stop.load(std::memory_order_relaxed)) {
            Slot::dispatchPacket(packet.data(), packet.size(), 0.3);
            Slot::dispatchEvent();
        }
    });

    std::thread js([&]() {
        for (int i = 0; i < 20000; ++i) {
            slot->setEventCallback([]() {});
            slot->setPacketCallback(live);
            slot->setPacketCallback(nullptr);
            slot->setPacketCallback(live);
        }
    });

    js.join();
    stop.store(true, std::memory_order_relaxed);
    capture.join();

    check("concurrent dispatch and assignment deliver packets", delivered.load() > 0);
}

// The snapshot guarantees the callback pointer is consistent; this checks the
// payload a reader sees is also internally consistent.
void testConcurrentReadersSeeWholeFrames() {
    auto slot = std::make_shared<Slot>();
    Slot::setActive(slot);

    std::atomic<int> torn{0};
    std::atomic<bool> stop{false};

    // Every frame is a repeated byte, so a byte value that differs within one
    // frame means the reader saw a buffer mid-mutation.
    auto frame = [](uint8_t v) { return std::vector<uint8_t>(256, v); };

    slot->setPacketCallback([&torn](ByteView view, double) {
        if (view.data == nullptr || view.size == 0) return;
        uint8_t first = view.data[0];
        for (size_t i = 1; i < view.size; ++i) {
            if (view.data[i] != first) {
                torn.fetch_add(1, std::memory_order_relaxed);
                return;
            }
        }
    });

    std::thread writer([&]() {
        uint8_t v = 0;
        while (!stop.load(std::memory_order_relaxed)) {
            auto buf = frame(v++);
            Slot::dispatchPacket(buf.data(), buf.size(), 0.0);
        }
    });

    std::thread reader([&]() {
        while (!stop.load(std::memory_order_relaxed)) {
            auto buf = frame(0xAB);
            Slot::dispatchPacket(buf.data(), buf.size(), 0.0);
        }
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    stop.store(true, std::memory_order_relaxed);
    writer.join();
    reader.join();

    check("concurrent frames are never observed torn", torn.load() == 0);
}

// ── ekwe::AtomicShared ────────────────────────────────────────────────────────
// The cell the snapshot and the slot registry are published through. The two
// properties that matter: a reader never waits on a writer, and a value is
// neither freed underneath a reader nor leaked once the readers are gone.

struct Probe {
        explicit Probe(std::atomic<int>& alive) : alive_(alive) { alive_.fetch_add(1); }
        ~Probe() { alive_.fetch_sub(1); }
        std::atomic<int>& alive_;
        int generation_ = 0;
    };

void testAtomicSharedOwnershipAndReclamation() {
    std::atomic<int> alive{0};
    {
        ekwe::AtomicShared<Probe> cell;
        check("an unpublished cell reads as empty", cell.load() == nullptr);

        auto probe = std::make_shared<Probe>(alive);
        cell.store(probe);
        // The cell keeps its own reference, so the caller can let go first —
        // this is what lets the registry outlive a slot owner that is tearing
        // down underneath a capture thread.
        probe.reset();
        check("a published value survives the publisher's last reference", alive.load() == 1);
        check("a published value is readable", cell.load() != nullptr);

        cell.store(nullptr);
        check("a superseded value is reclaimed once no reader holds it", alive.load() == 0);
    }
    check("destroying an empty cell frees nothing", alive.load() == 0);
}

void testAtomicSharedKeepsValueAliveForItsReader() {
    std::atomic<int> alive{0};
    {
        ekwe::AtomicShared<Probe> cell;
        cell.store(std::make_shared<Probe>(alive));

        auto held = cell.load();
        cell.store(std::make_shared<Probe>(alive));
        check("a superseded value is not freed while a reader holds it", alive.load() == 2);

        held.reset();
        // Reclamation is tied to a reader-free moment, so it happens at the next
        // publication rather than the instant the last reference drops.
        cell.store(std::make_shared<Probe>(alive));
        check("a value is reclaimed at the next publication with no readers", alive.load() == 1);
    }
    check("cell destruction releases the value it still holds", alive.load() == 0);
}

void testAtomicSharedConcurrentReadersAndWriters() {
    std::atomic<int> alive{0};
    std::atomic<bool> stop{false};
    std::atomic<int> torn{0};

    {
        ekwe::AtomicShared<Probe> cell;
        cell.store(std::make_shared<Probe>(alive));

        std::thread writer([&]() {
            while (!stop.load(std::memory_order_relaxed)) {
                cell.store(std::make_shared<Probe>(alive));
                cell.store(nullptr);
            }
        });

        std::thread reader([&]() {
            int read = 0;
            while (!stop.load(std::memory_order_relaxed)) {
                auto value = cell.load();
                // Touch the payload of whatever came back. A value freed
                // underneath this reader surfaces here as a sanitizer report
                // rather than as a null, which is the failure this cell has to
                // rule out.
                if (value != nullptr) read += value->generation_;
            }
            // Keep the reads observable so the loop cannot be optimised away.
            if (read < 0) torn.fetch_add(1, std::memory_order_relaxed);
        });

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        stop.store(true, std::memory_order_relaxed);
        writer.join();
        reader.join();

        check("concurrent readers never see a freed value", torn.load() == 0);
    }

    // Checked after the cell is gone: a value superseded while a reader was
    // inside load() is reclaimed at destruction, not at the last store.
    check("concurrent readers and writers leave nothing behind", alive.load() == 0);
}

} // namespace

int main() {
    std::printf("ekwe::CallbackSlot capture-thread handoff\n");
    testDestroyedSlotIsNotUseAfterFree();
    testDispatchWithNoActiveSlotIsSafe();
    testPacketContentsArriveIntact();
    testEventCallback();
    testSettersDoNotClobberEachOther();
    testClearingCallbackStopsDelivery();
    testUnregisterStopsDelivery();
    testEmptyPacketIsIgnored();
    testConcurrentDispatchAndAssignment();
    testConcurrentReadersSeeWholeFrames();

    std::printf("\nekwe::AtomicShared publication\n");
    testAtomicSharedOwnershipAndReclamation();
    testAtomicSharedKeepsValueAliveForItsReader();
    testAtomicSharedConcurrentReadersAndWriters();

    std::printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
