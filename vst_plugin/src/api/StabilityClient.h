#pragma once

#include <JuceHeader.h>

namespace app {

// Result of a Stability generation.
struct StabilityResult
{
    bool        ok     { false };
    MemoryBlock audio;      // encoded audio bytes (wav/mp3)
    int         seed   { 0 };
    String      error;
    String      generationId;

    bool hasAudio() const { return ok && audio.getSize() > 0; }
};

// Stable Audio 3.0 (Large) client. All methods block — call from a worker thread.
class StabilityClient
{
public:
    explicit StabilityClient (const String& apiKey);

    // Text -> audio. Returns encoded audio (default wav).
    StabilityResult textToAudio (const String& prompt,
                                 int durationSec = 30,
                                 const String& outputFormat = "wav");

    // Audio -> audio (variation). `audioWav` is the source sample (wav bytes).
    StabilityResult audioToAudio (const MemoryBlock& audioWav,
                                  const String& sourceFilename,
                                  const String& prompt,
                                  double strength = 0.4,
                                  int durationSec = 30,
                                  const String& outputFormat = "wav");

    // Poll a previously submitted generation id until it finishes.
    StabilityResult fetchResult (const String& generationId);

private:
    String submit (const URL& url);
    String apiKey;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StabilityClient)
};

} // namespace app
