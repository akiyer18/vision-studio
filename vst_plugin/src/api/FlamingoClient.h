#pragma once

#include <JuceHeader.h>

namespace app {

// NVIDIA Music Flamingo via the hosted Hugging Face Space (Gradio queue protocol).
// Used for the "advanced tech breakdown" option. Optional — needs an HF token.
class FlamingoClient
{
public:
    FlamingoClient (const String& hfToken,
                    const String& space = "https://nvidia-music-flamingo.hf.space");

    // Returns the model's text answer, or sets errorOut and returns {}.
    String ask (const MemoryBlock& audioWav,
                const String& question,
                String& errorOut);

private:
    struct FnIndex { String id, trigger; };
    FnIndex getFnIndex (String& errorOut);
    String  uploadFile (const MemoryBlock& audioWav, String& errorOut);

    String token;
    String space;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FlamingoClient)
};

} // namespace app
