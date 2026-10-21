#include "StabilityClient.h"
#include "Http.h"

namespace app {

namespace
{
    const char* const kBase = "https://api.stability.ai/v2beta/audio";
}

StabilityClient::StabilityClient (const String& apiKey) : apiKey (apiKey.trim())
{
}

String StabilityClient::submit (const URL& url)
{
    StringPairArray h;
    h.set ("Authorization", "Bearer " + apiKey);
    h.set ("Accept", "audio/*");

    auto r = Http::request (url, h, 120000);

    if (r.status == 202)
    {
        auto json = JSON::parse (r.body);
        return json.getProperty ("id", {}).toString();
    }

    if (r.status == 200)
        return {}; // synchronous result (older API behaviour)

    throw std::runtime_error (("Stability submit failed [" + String (r.status) + "]: " + r.body.substring (0, 400)).toRawUTF8());
}

StabilityResult StabilityClient::fetchResult (const String& generationId)
{
    StabilityResult result;
    result.generationId = generationId;

    const int maxAttempts = 150;
    for (int i = 0; i < maxAttempts; ++i)
    {
        StringPairArray h;
        h.set ("Authorization", "Bearer " + apiKey);
        h.set ("Accept", "audio/*");

        auto r = Http::get (String (kBase) + "/results/" + generationId, h, 60000);

        if (r.status == 200)
        {
            result.ok    = true;
            result.audio = r.raw;
            auto seedStr = r.header ("seed");
            result.seed  = seedStr.isNotEmpty() ? seedStr.getIntValue() : 0;
            return result;
        }

        if (r.status != 202)
        {
            result.error = "Stability result failed [" + String (r.status) + "]: " + r.body.substring (0, 400);
            return result;
        }

        Thread::sleep (2000);
    }

    result.error = "Stability: timed out waiting for generation result";
    return result;
}

StabilityResult StabilityClient::textToAudio (const String& prompt, int durationSec, const String& outputFormat)
{
    StabilityResult result;

    URL url (String (kBase) + "/stable-audio/text-to-audio");
    url = url.withParameter ("prompt", prompt);
    url = url.withParameter ("duration", String (durationSec));
    url = url.withParameter ("output_format", outputFormat);
    url = url.withParameter ("seed", "0");   // random

    try
    {
        auto id = submit (url);
        if (id.isNotEmpty())
            return fetchResult (id);

        // Synchronous fallback: re-issue and read bytes directly.
        StringPairArray h;
        h.set ("Authorization", "Bearer " + apiKey);
        h.set ("Accept", "audio/*");
        auto r = Http::request (url, h, 120000);
        result.ok    = r.ok();
        result.audio = r.raw;
        result.error = r.ok() ? "" : r.body;
    }
    catch (const std::exception& e)
    {
        result.error = e.what();
    }

    return result;
}

StabilityResult StabilityClient::audioToAudio (const MemoryBlock& audioWav,
                                               const String& sourceFilename,
                                               const String& prompt,
                                               double strength,
                                               int durationSec,
                                               const String& outputFormat)
{
    StabilityResult result;

    URL url (String (kBase) + "/stable-audio/audio-to-audio");
    url = url.withParameter ("prompt", prompt);
    url = url.withParameter ("strength", String (strength, 3));
    url = url.withParameter ("duration", String (durationSec));
    url = url.withParameter ("output_format", outputFormat);
    url = url.withParameter ("seed", "0");
    url = url.withDataToUpload ("audio", sourceFilename.isNotEmpty() ? sourceFilename : "input.wav",
                                audioWav, "audio/wav");

    try
    {
        auto id = submit (url);
        if (id.isNotEmpty())
            return fetchResult (id);

        StringPairArray h;
        h.set ("Authorization", "Bearer " + apiKey);
        h.set ("Accept", "audio/*");
        auto r = Http::request (url, h, 120000);
        result.ok    = r.ok();
        result.audio = r.raw;
        result.error = r.ok() ? "" : r.body;
    }
    catch (const std::exception& e)
    {
        result.error = e.what();
    }

    return result;
}

} // namespace app
