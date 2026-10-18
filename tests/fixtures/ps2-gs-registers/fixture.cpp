// The queue/lifecycle method bodies and mailbox implementation are extracted
// verbatim by the driver. Only archive I/O and the GS backend are observations.
#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <future>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

// Test-only access lets the blocked-worker test observe a queued promise under
// the real mailbox mutex, without sleeps, production hooks or policy changes.
#define private public
#include "MailBox.h"
#undef private
#include "Types.h"
#include "Integer64.h"
#include "Convertible.h"
#include "registers.inc"
#include "state-names.inc"

struct Record {
    std::vector<uint8> bytes;
    std::map<std::string, uint64> registers;
};
struct StateFile {
    std::string name;
    Record record;
    explicit StateFile(const char* n) : name(n) {}
    virtual ~StateFile() = default;
};
struct CMemoryStateFile : StateFile {
    CMemoryStateFile(const char* n, const void* p, std::size_t bytes) : StateFile(n) {
        const auto* at = static_cast<const uint8*>(p);
        record.bytes.assign(at, at + bytes);
    }
};
struct Stream {
    Record record;
    std::size_t Read(void* p, std::size_t n) {
        const auto count = std::min(n, record.bytes.size());
        std::memcpy(p, record.bytes.data(), count);
        return count;
    }
};
struct CRegisterStateFile : StateFile {
    explicit CRegisterStateFile(const char* n) : StateFile(n) {}
    explicit CRegisterStateFile(Stream& s) : StateFile("") { record = s.record; }
    void SetRegister64(const char* n, uint64 v) { record.registers[n] = v; }
    void SetRegister32(const char* n, uint32 v) { record.registers[n] = v; }
    uint64 GetRegister64(const char* n) { return record.registers.at(n); }
    uint32 GetRegister32(const char* n) { return record.registers.at(n); }
};
namespace Framework {
struct CZipArchiveWriter {
    std::map<std::string, Record> files;
    void InsertFile(std::unique_ptr<StateFile> f) { files.emplace(f->name, f->record); }
};
struct CZipArchiveReader {
    std::map<std::string, Record> files;
    explicit CZipArchiveReader(const CZipArchiveWriter& w) : files(w.files) {}
    std::shared_ptr<Stream> BeginReadFile(const char* name) {
        return std::make_shared<Stream>(Stream{files.at(name)});
    }
};
}
struct CGsPacketMetadata {};

class CGSHandler {
public:
#include "types.inc"
    using RegisterWrite = std::pair<uint8, uint64>;
    static constexpr int MAX_INFLIGHT_FRAMES = 2;
    struct DISPLAY_INFO {};
    explicit CGSHandler(bool threaded = true) : m_gsThreaded(threaded) {
        m_pRAM = new uint8[RAMSIZE];
        m_pCLUT = new uint16[CLUTENTRYCOUNT];
        for(auto& buffer : m_writeBuffers) buffer = new RegisterWrite[REGISTERWRITEBUFFER_SIZE];
        ResetBase();
        if(threaded) m_thread = std::thread([this] { ThreadProc(); });
    }
    ~CGSHandler() {
        if(m_gsThreaded) { SendGSCall([this] { m_threadDone = true; }); m_thread.join(); }
        for(auto buffer : m_writeBuffers) delete[] buffer;
        delete[] m_pRAM;
        delete[] m_pCLUT;
    }
#include "write.inc"
    void Reset();
    void ResetBase();
    void SaveState(Framework::CZipArchiveWriter&);
    void LoadState(Framework::CZipArchiveReader&);
    void Copy(CGSHandler*);
    void SetVBlank();
    void ResetVBlank();
    void Finish(bool = false);
    void Flip(uint32 = 0);
    void FeedImageData(const void*, uint32);
    void ReadImageData(void*, uint32);
    void ProcessWriteBuffer(const CGsPacketMetadata*);
    void SubmitWriteBuffer();
    void FlushWriteBuffer();
    void SubmitWriteBufferImpl(const RegisterWrite*, const RegisterWrite*);
    void ThreadProc();
    void SendGSCall(const CMailBox::FunctionType&, bool = false, bool = false);
    void SendGSCall(CMailBox::FunctionType&&);
    enum { FLIP_FLAG_WAIT = 1, FLIP_FLAG_FORCE = 2 };
    void ResetImpl() { backend.push_back("reset"); }
    void SyncMemoryCache() { backend.push_back("sync"); }
    void WriteBackMemoryCache() { backend.push_back("restore"); }
    DISPLAY_INFO GetCurrentDisplayInfo() { return {}; }
    uint8* GetRam() { return m_pRAM; }
    void MarkNewFrame() { backend.push_back("frame"); }
    void FlipImpl(const DISPLAY_INFO&) { backend.push_back("flip"); }
    void NotifyEvent(uint32 event) { events.push_back(event); }
    void WriteRegisterImpl(uint8 r, uint64 v) {
        observed.emplace_back(r, v);
        m_nReg[r] = v;
        m_regsDirty = true;
    }
    void FeedImageDataImpl(const uint8* p, uint32 n) {
        assert(n == sizeof(uint64));
        uint64 value = 0; std::memcpy(&value, p, n);
        assert(value == m_nReg[GS_REG_RGBAQ]);
        backend.push_back("image");
    }
    void ReadImageDataImpl(void* p, uint32 n) {
        assert(n == sizeof(uint64));
        std::memcpy(p, &m_nReg[GS_REG_RGBAQ], n);
        backend.push_back("read");
    }
    void Drain() { SendGSCall([] {}, true, true); }
    void Write(uint8 r, uint64 v) { WriteRegister({r, v}); ProcessWriteBuffer(nullptr); }
    uint64 Value() { Drain(); return m_nReg[GS_REG_RGBAQ]; }
    uint64 m_nReg[REGISTER_MAX]{};
    uint64 m_nPMODE{}, m_nSMODE2{}, m_nCSR{}, m_nIMR{}, m_nBUSDIR{}, m_nSIGLBLID{};
    DELAYED_REGISTER m_nDISPFB1{}, m_nDISPLAY1{}, m_nDISPFB2{}, m_nDISPLAY2{};
    CRT_MODE m_crtMode{};
    uint32 m_nCBP0{}, m_nCBP1{};
    TRXCONTEXT m_trxCtx{};
    uint8* m_pRAM = nullptr;
    uint16* m_pCLUT = nullptr;
    RegisterWrite* m_writeBuffers[MAX_INFLIGHT_FRAMES]{};
    RegisterWrite* m_currentWriteBuffer = nullptr;
    uint32 m_writeBufferIndex{}, m_writeBufferSize{}, m_writeBufferProcessIndex{}, m_writeBufferSubmitIndex{};
    std::atomic<int> m_framesInFlight{0};
    std::recursive_mutex m_registerMutex;
    bool m_gsThreaded = true, m_threadDone = false, m_regsDirty = false;
    std::thread m_thread;
    CMailBox m_mailBox;
    std::vector<RegisterWrite> observed;
    std::vector<std::string> backend;
    std::vector<uint32> events;
};
#include "methods.inc"

static int checks = 0;
static void require(bool condition, const char* message) {
    ++checks;
    if(!condition) throw std::runtime_error(message);
}
static uint64 saved_value(const Framework::CZipArchiveWriter& archive) {
    uint64 value = 0;
    const auto& bytes = archive.files.at(STATE_REGS).bytes;
    std::memcpy(&value, bytes.data() + GS_REG_RGBAQ * sizeof(value), sizeof(value));
    return value;
}
struct Gate {
    std::mutex mutex;
    std::condition_variable condition;
    bool entered = false, open = false;
    void Block() {
        std::unique_lock lock(mutex);
        entered = true; condition.notify_all();
        condition.wait(lock, [&] { return open; });
    }
    void Wait() {
        std::unique_lock lock(mutex);
        require(condition.wait_for(lock, std::chrono::seconds(3), [&] { return entered; }), "worker gate timeout");
    }
    void Open() { std::lock_guard lock(mutex); open = true; condition.notify_all(); }
};
static void wait_for_promise(CGSHandler& gs) {
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while(std::chrono::steady_clock::now() < end) {
        {
            std::lock_guard lock(gs.m_mailBox.m_callMutex);
            for(const auto& message : gs.m_mailBox.m_calls) if(message.promise) return;
        }
        std::this_thread::yield();
    }
    throw std::runtime_error("synchronous queue admission timeout");
}

int main(int argc, char** argv) {
    try {
        require(argc == 2, "expected baseline/candidate");
        const bool fixed = std::string(argv[1]) == "candidate";
        // Current baseline loses even one processed, unsubmitted register on save.
        {
            CGSHandler gs;
            gs.Write(GS_REG_RGBAQ, 0x1234);
            Framework::CZipArchiveWriter archive;
            gs.SaveState(archive);
            require(saved_value(archive) == (fixed ? 0x1234u : 0u), "save tail control");
            require(gs.m_writeBufferSubmitIndex == (fixed ? 1u : 0u), "save native submission boundary");
        }
        // A tail from before load must never execute in the replacement state.
        {
            CGSHandler gs;
            Framework::CZipArchiveWriter archive;
            gs.SaveState(archive);
            gs.Write(GS_REG_RGBAQ, 0x4567);
            Framework::CZipArchiveReader reader(archive);
            gs.LoadState(reader);
            gs.Finish(true);
            require(gs.Value() == (fixed ? 0u : 0x4567u), "stale load tail control");
        }
        // Block the real GS worker, queue a register callback, then replace its
        // state. Seeing the real mailbox promise proves Reset entered its first
        // synchronous SendGSCall. No timing assumptions decide this ordering.
        for(bool load : {false, true}) {
            CGSHandler gs;
            Framework::CZipArchiveWriter archive;
            gs.SaveState(archive);
            Gate gate;
            gs.SendGSCall([&] { gate.Block(); });
            gate.Wait();
            gs.Write(GS_REG_RGBAQ, 0x6789);
            gs.SubmitWriteBuffer();
            std::thread replace([&] {
                if(load) { Framework::CZipArchiveReader reader(archive); gs.LoadState(reader); gs.Drain(); }
                else gs.Reset();
            });
            wait_for_promise(gs);
            gate.Open();
            replace.join();
            require(gs.Value() == (fixed ? 0u : 0x6789u), load ? "load queued callback control" : "reset queued callback control");
            const uint32 pending = !fixed && load ? 1u : 0u;
            require(gs.m_writeBufferSize == pending && gs.m_writeBufferProcessIndex == pending && gs.m_writeBufferSubmitIndex == pending,
                    "replacement clears native indices");
        }
        {
            CGSHandler source, target;
            source.Write(GS_REG_RGBAQ, 0x89ab);
            target.Copy(&source);
            require(target.Value() == (fixed ? 0x89abu : 0u), "copy source tail control");
        }
        {
            CGSHandler gs;
            gs.Write(GS_REG_RGBAQ, 0xabcd);
            gs.Flip(CGSHandler::FLIP_FLAG_WAIT | CGSHandler::FLIP_FLAG_FORCE);
            require(gs.Value() == (fixed ? 0xabcdu : 0u), "standalone forced flip tail control");
        }
        // Existing transfer, event and frame boundaries remain exact.
        {
            CGSHandler gs;
            const uint64 value = 0xcdef;
            gs.Write(GS_REG_RGBAQ, value);
            gs.FeedImageData(&value, sizeof(value));
            uint64 read = 0;
            gs.ReadImageData(&read, sizeof(read));
            require(read == value, "image/read ordering");
            gs.Write(GS_REG_SIGNAL, (uint64(0xffffffff) << 32) | 0x42u);
            gs.Write(GS_REG_FINISH, 0);
            gs.Write(GS_REG_LABEL, (uint64(0xffffffff) << 32) | 0x43u);
            require(gs.events.size() == 2 && gs.events[0] == CGSHandler::CSR_SIGNAL_EVENT && gs.events[1] == CGSHandler::CSR_FINISH_EVENT,
                    "events must be immediate before a mailbox drain");
            require((gs.m_nCSR & 3) == 3 && gs.m_nSIGLBLID == ((uint64(0x43) << 32) | 0x42), "event register values");
            gs.Finish(true);
            require(gs.m_writeBufferIndex == 1 && gs.m_framesInFlight == 0, "first ring boundary");
            for(unsigned frame = 0; frame < 8; ++frame) {
                gs.Write(GS_REG_RGBAQ, frame);
                gs.SetVBlank();
            }
            gs.Finish(true);
            require(gs.Value() == 7 && gs.m_framesInFlight == 0, "ring reuse and idle/no-flip boundary");
            gs.Drain();
            const auto flips = std::count(gs.backend.begin(), gs.backend.end(), "flip");
            for(unsigned frame = 0; frame < 8; ++frame) gs.SetVBlank();
            gs.Finish(true);
            require(std::count(gs.backend.begin(), gs.backend.end(), "flip") == flips,
                    "idle vblank must drain/rotate without inventing a display");
        }
        {
            CGSHandler gs;
            Gate gate;
            gs.SendGSCall([&] { gate.Block(); });
            gate.Wait();
            for(unsigned i = 0; i < 4096; ++i) gs.Write(GS_REG_RGBAQ, i);
            std::size_t jobs;
            { std::lock_guard lock(gs.m_mailBox.m_callMutex); jobs = gs.m_mailBox.m_calls.size(); }
            require(jobs == 4096 / CGSHandler::REGISTERWRITEBUFFER_SUBMIT_THRESHOLD,
                    "actual register mailbox job count");
            gate.Open();
            gs.Finish(true);
            require(gs.observed.size() == 4096 && gs.Value() == 4095, "batched mailbox stream completeness");
            std::cout << "register-only jobs/4096 writes=" << jobs << '\n';
        }
        // Equivalence across threshold edges, short tails and large packets.
        // The expected stream comes from producer inputs, never a second queue.
        for(unsigned count : {0u, 1u, 255u, 256u, 257u, 1023u, 1024u, 1025u, 4097u, 20001u}) {
            CGSHandler gs;
            std::vector<CGSHandler::RegisterWrite> expected;
            for(unsigned i = 0; i < count; ++i) {
                expected.emplace_back(GS_REG_RGBAQ, uint64(i) * 0x102030405ull);
                gs.WriteRegister(expected.back());
                if(i % 37 == 0 || i + 1 == count) gs.ProcessWriteBuffer(nullptr);
            }
            gs.Finish(true);
            require(gs.observed == expected, "ordered register stream equivalence");
            require(gs.m_writeBufferIndex == 1 && gs.m_framesInFlight == 0, "capacity/frame lifetime");
        }
        std::cout << (fixed ? "PASS candidate" : "PASS baseline negative controls: save/load/reset/copy/flip failures reproduced")
                  << "; " << checks << " checks; threshold=" << CGSHandler::REGISTERWRITEBUFFER_SUBMIT_THRESHOLD << '\n';
    } catch(const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
