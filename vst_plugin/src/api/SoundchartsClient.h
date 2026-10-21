#pragma once

#include <JuceHeader.h>

namespace app {

// Soundcharts client for the "Find references" feature. Given a genre/artist
// query it returns a JSON string of similar artists, or sets errorOut.
// Optional — if no key is set, the UI falls back to Gemini.
class SoundchartsClient
{
public:
    explicit SoundchartsClient (const String& token);

    // Returns JSON: { "query": ..., "artists": [ { name, genres, followers } ] }
    String findReferences (const String& genreOrArtist, String& errorOut);

private:
    String searchArtist (const String& query, String& errorOut);
    String getSimilarArtists (const String& artistId, String& errorOut);

    String token;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SoundchartsClient)
};

} // namespace app
