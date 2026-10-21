#include "SoundchartsClient.h"
#include "Http.h"

namespace app {

namespace
{
    const char* const kBase = "https://api.soundcharts.com/api/v2";

    StringPairArray auth (const String& token)
    {
        StringPairArray h;
        h.set ("Authorization", "Bearer " + token);
        h.set ("Accept", "application/json");
        return h;
    }
}

SoundchartsClient::SoundchartsClient (const String& tokenToUse)
    : token (tokenToUse.trim())
{
}

String SoundchartsClient::searchArtist (const String& query, String& errorOut)
{
    auto r = Http::get (String (kBase) + "/search/" + URL::addEscapeChars (query, true),
                        auth (token), 60000);
    if (! r.ok())
    {
        errorOut = "soundcharts search " + String (r.status) + ": " + r.body.substring (0, 300);
        return {};
    }
    return r.body;
}

String SoundchartsClient::getSimilarArtists (const String& artistId, String& errorOut)
{
    auto r = Http::get (String (kBase) + "/artist/" + artistId + "/similar",
                        auth (token), 60000);
    if (! r.ok())
    {
        errorOut = "soundcharts similar " + String (r.status) + ": " + r.body.substring (0, 300);
        return {};
    }
    return r.body;
}

String SoundchartsClient::findReferences (const String& genreOrArtist, String& errorOut)
{
    if (token.isEmpty())
    {
        errorOut = "Soundcharts API key is not set (Settings tab).";
        return {};
    }

    auto searchBody = searchArtist (genreOrArtist, errorOut);
    if (searchBody.isEmpty())
        return {};

    // Pull the first artist id out of the search response.
    auto searchJson = JSON::parse (searchBody);
    String artistId;

    if (auto* arr = searchJson.getProperty ("data", var()).getArray())
    {
        if (arr->size() > 0)
            artistId = (*arr)[0]["id"].toString();
    }
    else if (auto* obj = searchJson.getProperty ("data", var()).getDynamicObject())
    {
        if (obj->hasProperty ("id"))
            artistId = obj->getProperty ("id").toString();
    }

    auto result = std::make_unique<DynamicObject>();
    result->setProperty ("query", genreOrArtist);

    if (artistId.isEmpty())
    {
        // No artist found — hand the raw search back to the caller.
        result->setProperty ("artists", var());
        result->setProperty ("raw", searchBody);
        return JSON::toString (var (result.release()));
    }

    auto similarBody = getSimilarArtists (artistId, errorOut);
    if (similarBody.isEmpty())
        return {};

    result->setProperty ("artists", JSON::parse (similarBody));
    return JSON::toString (var (result.release()));
}

} // namespace app
