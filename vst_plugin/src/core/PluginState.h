#pragma once

#include <JuceHeader.h>

namespace app {

// ---------------------------------------------------------------------------
// API credentials + model choices, persisted by SettingsStore.
// ---------------------------------------------------------------------------
struct ApiKeys
{
    String stability;
    String gemini;
    String geminiModel    { "gemini-2.5-flash" };
    String huggingFace;   // optional, for Music Flamingo advanced breakdown
    String soundcharts;   // optional, for "Find references"

    bool hasStability() const { return stability.trim().isNotEmpty(); }
    bool hasGemini()    const { return gemini.trim().isNotEmpty(); }
    bool hasFlamingo()  const { return huggingFace.trim().isNotEmpty(); }
    bool hasSoundcharts() const { return soundcharts.trim().isNotEmpty(); }
};

// Gemini models offered in the settings dropdown (matches the ADE Hack web app).
inline StringArray geminiModelChoices()
{
    return { "gemini-2.5-flash", "gemini-2.5-pro",
             "gemini-3.5-flash", "gemini-3.6-flash",
             "gemini-3.7-flash", "gemini-3.8-flash" };
}

// ---------------------------------------------------------------------------
// A piece of generated audio held in the plugin's memory.
// ---------------------------------------------------------------------------
struct GeneratedAudio
{
    String     name;
    AudioBuffer<float> buffer;
    double     sampleRate { 44100.0 };
    String     prompt;      // the prompt that produced it
    String     source;      // "text" | "variation" | "tweak"
    String     generationId;// Stability id (for reference / resuming)
    int        variationIndex { 0 }; // 1..N for "alternatives"
    String     analysis;    // Gemini comparison text, if produced

    double getLengthSeconds() const
    {
        return sampleRate > 0.0 ? (double) buffer.getNumSamples() / sampleRate : 0.0;
    }
};

// ---------------------------------------------------------------------------
// Status of the currently running background job (drives the progress bar).
// ---------------------------------------------------------------------------
struct JobState
{
    String  label;
    bool    running     { false };
    float   progress    { -1.0f };  // -1 == indeterminate
    String  statusText;
    String  errorText;
    bool    failed      { false };

    void reset()
    {
        label = statusText = errorText = {};
        running = failed = false;
        progress = -1.0f;
    }
};

// MIDI channel plan for the "dissected" tracks written back to the DAW.
// The plugin emits these channels; the DAW can split them into separate tracks.
enum DissectChannel
{
    ChannelDrums  = 10,  // General MIDI drum channel
    ChannelBass   = 2,
    ChannelChords = 3,
    ChannelLead   = 4
};

// Prompts used across the UI (kept in one place so they match the ADE Hack app).
namespace Prompts
{
    inline const char* analyseTrack()
    {
        return "genre, tempo, and key, then dive into the instruments, production style, "
               "and overall mood it creates";
    }

    inline const char* suggestImprovements()
    {
        return "You are a music producer and mixing engineer. Based on this track, suggest "
               "concrete, actionable improvements across arrangement, sound design, mix "
               "(EQ, compression, space), and emotional impact. Be specific and practical.";
    }

    inline const char* explainChanges()
    {
        return "you are a music production explainer. please analyse the beginning beat and "
               "the resulting lo fi prod and explain the changes made. dive into the "
               "instruments, production style and overall mood it creates";
    }

    inline const char* genreHistoryAndArtists()
    {
        return "Give a brief history of this genre and suggest 5-8 artists and specific "
               "tracks to listen to as references for understanding the style.";
    }

    inline const char* suggestSamples()
    {
        return "Suggest 5 concrete sample/loop ideas a producer could search for or generate "
               "to fit this vibe. Include genre, instrument, mood and typical tempo range.";
    }

    inline const char* carryOnDevelop()
    {
        return "You are a music producer. Based on the track described below, suggest concrete "
               "ways to develop and extend it further: new sections, instrument additions, "
               "arrangement changes, melodic/rhythmic variations, mix ideas, and next production steps. "
               "Do not regenerate audio — just give actionable production advice.";
    }
}

} // namespace app
