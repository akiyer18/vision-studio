#pragma once

#include <JuceHeader.h>

namespace app {

struct GeminiResult
{
    bool   ok       { false };
    String text;
    String error;
    String provider;   // e.g. "gemini:gemini-2.5-flash"

    bool hasText() const { return ok && text.isNotEmpty(); }
};

// Google Gemini client. Mirrors lib/ears.js: native audio input via inlineData,
// so no GPU quota is needed. All methods block — call from a worker thread.
class GeminiClient
{
public:
    GeminiClient (const String& apiKey, const String& model = "gemini-2.5-flash");

    void setModel (const String& modelToUse) { model = modelToUse; }

    // Ask a question about one audio file.
    GeminiResult askAudio (const MemoryBlock& audioWav,
                           const String& mimeType,
                           const String& question,
                           double temperature = 0.4);

    // Ask a question comparing two audio files (original vs alternative).
    GeminiResult askAudioPair (const MemoryBlock& wavA, const String& mimeA,
                               const MemoryBlock& wavB, const String& mimeB,
                               const String& question,
                               double temperature = 0.4);

    // Plain text question (no audio).
    GeminiResult askText (const String& question, double temperature = 0.4);

private:
    GeminiResult generate (const Array<var>& parts, double temperature);

    String apiKey;
    String model;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GeminiClient)
};

} // namespace app
