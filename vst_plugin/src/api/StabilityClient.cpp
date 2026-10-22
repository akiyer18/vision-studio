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

String StabilityClient::submit (const HttpResponse& r)
{
    if (r.status == 202)
    {
        auto json = JSON::parse (r.body);
        auto id = json.getProperty ("id", {}).toString();
        if (id.isEmpty())
            throw std::runtime_error ("Stability submit returned no generation id");
        return id;
    }

    if (r.status == 200)
        return {};

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

    StringPairArray fields;
    fields.set ("prompt", prompt);
    fields.set ("duration", String (durationSec));
    fields.set ("output_format", outputFormat);
    fields.set ("seed", "0");

    StringPairArray h;
    h.set ("Authorization", "Bearer " + apiKey);
    h.set ("Accept", "audio/*");

    try
    {
        auto r = Http::postMultipart (String (kBase) + "/stable-audio/text-to-audio",
                                      fields, {}, {}, {}, {}, h, 120000);
        auto id = submit (r);
        if (id.isNotEmpty())
            return fetchResult (id);

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

    StringPairArray fields;
    fields.set ("prompt", prompt);
    fields.set ("strength", String (strength, 3));
    fields.set ("duration", String (durationSec));
    fields.set ("output_format", outputFormat);
    fields.set ("seed", "0");

    StringPairArray h;
    h.set ("Authorization", "Bearer " + apiKey);
    h.set ("Accept", "audio/*");

    try
    {
        auto r = Http::postMultipart (String (kBase) + "/stable-audio/audio-to-audio",
                                      fields, "audio",
                                      sourceFilename.isNotEmpty() ? sourceFilename : "input.wav",
                                      audioWav, "audio/wav", h, 120000);
        auto id = submit (r);
        if (id.isNotEmpty())
            return fetchResult (id);

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
