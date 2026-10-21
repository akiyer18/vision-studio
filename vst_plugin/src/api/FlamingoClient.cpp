#include "FlamingoClient.h"
#include "Http.h"

namespace app {

namespace
{
StringPairArray authHeaders (const String& token)
{
    StringPairArray h;
    h.set ("Authorization", "Bearer " + token);
    return h;
}
}

FlamingoClient::FlamingoClient (const String& hfToken, const String& spaceToUse)
    : token (hfToken.trim()), space (spaceToUse)
{
}

FlamingoClient::FnIndex FlamingoClient::getFnIndex (String& errorOut)
{
    FnIndex fn;

    StringPairArray h;
    h.set ("Authorization", "Bearer " + token);

    auto r = Http::get (space + "/config", h, 60000);
    if (! r.ok())
    {
        errorOut = "flamingo config failed [" + String (r.status) + "]: " + r.body.substring (0, 300);
        return fn;
    }

    auto cfg = JSON::parse (r.body);
    auto* deps = cfg.getProperty ("dependencies", var()).getArray();
    if (deps == nullptr)
    {
        errorOut = "flamingo: no dependencies in config";
        return fn;
    }

    for (auto& d : *deps)
    {
        if (d["api_name"].toString() == "infer")
        {
            fn.id = d["id"].toString();
            auto* targets = d["targets"].getArray();
            if (targets != nullptr && targets->size() > 0)
            {
                auto* first = (*targets)[0].getArray();
                if (first != nullptr && first->size() > 0)
                    fn.trigger = (*first)[0].toString();
            }
            break;
        }
    }

    if (fn.id.isEmpty())
        errorOut = "flamingo: Space has no 'infer' endpoint";

    return fn;
}

String FlamingoClient::uploadFile (const MemoryBlock& audioWav, String& errorOut)
{
    URL url (space + "/gradio_api/upload");
    url = url.withDataToUpload ("files", "input.wav", audioWav, "audio/wav");

    auto r = Http::request (url, authHeaders (token), 120000);
    if (! r.ok())
    {
        errorOut = "flamingo upload " + String (r.status) + ": " + r.body.substring (0, 300);
        return {};
    }

    auto arr = JSON::parse (r.body);
    if (arr.isArray() && arr.getArray()->size() > 0)
        return (*arr.getArray())[0].toString();

    errorOut = "flamingo: upload returned no path";
    return {};
}

String FlamingoClient::ask (const MemoryBlock& audioWav, const String& question, String& errorOut)
{
    auto fn = getFnIndex (errorOut);
    if (fn.id.isEmpty())
        return {};

    auto serverPath = uploadFile (audioWav, errorOut);
    if (serverPath.isEmpty())
        return {};

    // Build the Gradio file payload.
    auto fileObj = std::make_unique<DynamicObject>();
    fileObj->setProperty ("path", serverPath);
    fileObj->setProperty ("orig_name", "input.wav");
    fileObj->setProperty ("mime_type", "audio/wav");
    fileObj->setProperty ("size", (int64) audioWav.getSize());

    Array<var> data;
    data.add (var (fileObj.release()));
    data.add (var (""));
    data.add (var (question));

    auto root = std::make_unique<DynamicObject>();
    root->setProperty ("data", data);
    root->setProperty ("fn_index", fn.id);
    root->setProperty ("trigger_id", fn.trigger);
    root->setProperty ("session_hash", Uuid().toString().substring (0, 10));
    root->setProperty ("event_data", var());

    String joinBody = JSON::toString (var (root.release()));

    auto join = Http::postJson (space + "/gradio_api/queue/join", joinBody, authHeaders (token), 60000);
    if (! join.ok())
    {
        errorOut = "flamingo join " + String (join.status) + ": " + join.body.substring (0, 300);
        return {};
    }

    auto sessionHash = JSON::parse (joinBody)["session_hash"].toString();

    // Read the SSE stream until it closes (the job completes server-side).
    URL dataUrl (space + "/gradio_api/queue/data?session_hash=" + sessionHash);
    auto stream = dataUrl.createInputStream (URL::InputStreamOptions (URL::ParameterHandling::inAddress)
                                                 .withExtraHeaders ("Authorization: Bearer " + token)
                                                 .withConnectionTimeoutMs (150000));

    if (stream == nullptr)
    {
        errorOut = "flamingo: could not open result stream";
        return {};
    }

    MemoryBlock raw;
    stream->readIntoMemoryBlock (raw);
    auto text = raw.toString();

    // Parse SSE events: lines beginning with "data:".
    StringArray lines;
    lines.addLines (text);
    for (auto& line : lines)
    {
        if (! line.startsWith ("data:"))
            continue;

        auto payload = line.substring (5).trim();
        auto ev = JSON::parse (payload);

        if (ev["msg"].toString() == "process_completed")
        {
            auto outputError = ev["output"]["error"].toString();
            if (outputError.isNotEmpty())
            {
                errorOut = "flamingo: " + outputError;
                return {};
            }

            auto* dataArr = ev["output"]["data"].getArray();
            if (dataArr != nullptr && dataArr->size() > 0)
                return (*dataArr)[0].toString().trim();

            errorOut = "flamingo: empty result";
            return {};
        }

        if (ev["msg"].toString() == "unexpected_error")
        {
            errorOut = "flamingo: " + ev["message"].toString();
            return {};
        }
    }

    errorOut = "flamingo: stream ended without a result";
    return {};
}

} // namespace app
