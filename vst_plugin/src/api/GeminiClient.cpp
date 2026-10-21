#include "GeminiClient.h"
#include "Http.h"

namespace app {

namespace
{
    const char* const kHost = "https://generativelanguage.googleapis.com/v1beta/models/";

    String b64 (const MemoryBlock& mb)
    {
        return Base64::toBase64 (mb.getData(), mb.getSize());
    }

    std::unique_ptr<DynamicObject> inlineDataPart (const MemoryBlock& audio,
                                                   const String& mimeType)
    {
        auto d = std::make_unique<DynamicObject>();
        d->setProperty ("mimeType", mimeType);
        d->setProperty ("data", b64 (audio));
        return d;
    }

    std::unique_ptr<DynamicObject> textPart (const String& text)
    {
        auto d = std::make_unique<DynamicObject>();
        d->setProperty ("text", text);
        return d;
    }

    String extractText (const String& body, String& errorOut)
    {
        auto root = JSON::parse (body);

        if (root.getProperty ("error", var()).isObject())
        {
            auto msg = root["error"]["message"].toString();
            errorOut = "gemini: " + msg;
            return {};
        }

        auto* candidates = root.getProperty ("candidates", var()).getArray();
        if (candidates == nullptr || candidates->isEmpty())
        {
            errorOut = "gemini: empty answer (" + body.substring (0, 300) + ")";
            return {};
        }

        auto content = (*candidates)[0].getProperty ("content", var());
        auto* parts = content.getProperty ("parts", var()).getArray();
        if (parts == nullptr)
        {
            errorOut = "gemini: no content parts";
            return {};
        }

        String out;
        for (auto& p : *parts)
            out += p.getProperty ("text", var()).toString();

        return out.trim();
    }
}

GeminiClient::GeminiClient (const String& apiKey, const String& modelToUse)
    : apiKey (apiKey.trim()), model (modelToUse.isNotEmpty() ? modelToUse : "gemini-2.5-flash")
{
}

GeminiResult GeminiClient::generate (const Array<var>& parts, double temperature)
{
    GeminiResult result;

    if (apiKey.isEmpty())
    {
        result.error = "Gemini API key is not set (Settings tab).";
        return result;
    }

    // Build: { contents: [{ role:"user", parts: [...] }], generationConfig: {...} }
    Array<var> partsArray;
    for (auto& p : parts)
        partsArray.add (p);

    auto content = std::make_unique<DynamicObject>();
    content->setProperty ("role", "user");
    content->setProperty ("parts", partsArray);

    Array<var> contents;
    contents.add (var (content.release()));

    auto config = std::make_unique<DynamicObject>();
    config->setProperty ("temperature", temperature);
    config->setProperty ("maxOutputTokens", 2048);

    auto root = std::make_unique<DynamicObject>();
    root->setProperty ("contents", contents);
    root->setProperty ("generationConfig", var (config.release()));

    String json = JSON::toString (var (root.release()));

    const String fullUrl = String (kHost) + model + ":generateContent?key=" + apiKey;

    try
    {
        auto r = Http::postJson (fullUrl, json, {}, 120000);

        if (! r.ok())
        {
            result.error = "gemini(" + model + ") " + String (r.status) + ": " + r.body.substring (0, 400);
            return result;
        }

        String err;
        result.text = extractText (r.body, err);
        if (result.text.isEmpty())
        {
            result.error = err.isNotEmpty() ? err : "gemini: empty answer";
            return result;
        }

        result.ok = true;
        result.provider = "gemini:" + model;
    }
    catch (const std::exception& e)
    {
        result.error = e.what();
    }

    return result;
}

GeminiResult GeminiClient::askAudio (const MemoryBlock& audioWav,
                                     const String& mimeType,
                                     const String& question,
                                     double temperature)
{
    Array<var> parts;
    parts.add (var (inlineDataPart (audioWav, mimeType.isNotEmpty() ? mimeType : "audio/wav").release()));
    parts.add (var (textPart (question).release()));
    return generate (parts, temperature);
}

GeminiResult GeminiClient::askAudioPair (const MemoryBlock& wavA, const String& mimeA,
                                         const MemoryBlock& wavB, const String& mimeB,
                                         const String& question, double temperature)
{
    Array<var> parts;
    parts.add (var (inlineDataPart (wavA, mimeA.isNotEmpty() ? mimeA : "audio/wav").release()));
    parts.add (var (inlineDataPart (wavB, mimeB.isNotEmpty() ? mimeB : "audio/wav").release()));
    parts.add (var (textPart (question).release()));
    return generate (parts, temperature);
}

GeminiResult GeminiClient::askText (const String& question, double temperature)
{
    Array<var> parts;
    parts.add (var (textPart (question).release()));
    return generate (parts, temperature);
}

} // namespace app
