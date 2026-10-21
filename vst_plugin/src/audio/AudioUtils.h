#pragma once

#include <JuceHeader.h>

namespace app {

struct DecodedAudio
{
    AudioBuffer<float> buffer;
    double             sampleRate { 44100.0 };
    bool               ok { false };
    String             error;

    int  getNumSamples() const { return buffer.getNumSamples(); }
    double lengthSeconds() const { return sampleRate > 0 ? (double) buffer.getNumSamples() / sampleRate : 0.0; }
};

// Owns the AudioFormatManager and provides read/decode/encode helpers.
class AudioIO
{
public:
    AudioIO();

    AudioFormatManager& getFormatManager() { return formatManager; }

    // Read an audio file from disk (wav/mp3/aiff/flac).
    DecodedAudio read (const File& file);

    // Decode in-memory audio bytes (e.g. a Stability result).
    DecodedAudio decode (const MemoryBlock& bytes);

    // Encode a buffer to 16-bit stereo WAV bytes.
    MemoryBlock encodeWav (const AudioBuffer<float>& buffer, double sampleRate);

private:
    AudioFormatManager formatManager;
};

} // namespace app
