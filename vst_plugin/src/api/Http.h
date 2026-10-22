#pragma once

#include <JuceHeader.h>

namespace app {

// Result of a blocking HTTP request. Binary payloads live in `raw`.
struct HttpResponse
{
    int          status  { 0 };
    String       body;
    MemoryBlock  raw;
    StringPairArray headers;

    bool ok() const noexcept { return status >= 200 && status < 300; }
    String header (const String& key) const { return headers.getValue (key, {}); }
};

// Thin blocking wrapper around juce::URL. MUST be called from a background
// thread (never the message thread) because createInputStream() blocks.
class Http
{
public:
    // Generic request against an already-built URL (use URL::withParameter /
    // withFileToUpload / withPOSTData to shape the request).
    static HttpResponse request (const URL& url,
                                 const StringPairArray& headers = {},
                                 int timeoutMs = 60000)
    {
        return readStream (url, buildHeaderString (headers), timeoutMs);
    }

    static HttpResponse get (const String& url,
                             const StringPairArray& headers = {},
                             int timeoutMs = 60000)
    {
        return readStream (URL (url), buildHeaderString (headers), timeoutMs,
                           URL::ParameterHandling::inAddress);
    }

    static HttpResponse postJson (const String& url,
                                  const String& json,
                                  const StringPairArray& headers = {},
                                  int timeoutMs = 60000)
    {
        auto all = headers;
        all.set ("Content-Type", "application/json");

        MemoryBlock mb;
        mb.replaceAll (json.toUTF8(), (size_t) json.getNumBytesAsUTF8());

        URL u (url);
        u = u.withPOSTData (mb);
        return readStream (u, buildHeaderString (all), timeoutMs);
    }

    static HttpResponse postMultipart (const String& url,
                                       const StringPairArray& fields,
                                       const String& fileField = {},
                                       const String& fileName = {},
                                       const MemoryBlock& fileData = {},
                                       const String& fileMimeType = "application/octet-stream",
                                       const StringPairArray& headers = {},
                                       int timeoutMs = 60000)
    {
        const auto boundary = "----ADEHack" + String::toHexString (Random::getSystemRandom().nextInt64());

        MemoryOutputStream body;
        for (auto& key : fields.getAllKeys())
        {
            body << "--" << boundary << "\r\n";
            body << "Content-Disposition: form-data; name=\"" << key << "\"\r\n\r\n";
            body << fields[key] << "\r\n";
        }

        if (fileField.isNotEmpty() && fileData.getSize() > 0)
        {
            body << "--" << boundary << "\r\n";
            body << "Content-Disposition: form-data; name=\"" << fileField
                 << "\"; filename=\"" << fileName << "\"\r\n";
            body << "Content-Type: " << fileMimeType << "\r\n\r\n";
            body.write (fileData.getData(), fileData.getSize());
            body << "\r\n";
        }

        body << "--" << boundary << "--\r\n";

        MemoryBlock payload (body.getData(), body.getDataSize());

        auto all = headers;
        all.set ("Content-Type", "multipart/form-data; boundary=" + boundary);

        URL u (url);
        u = u.withPOSTData (payload);
        return readStream (u, buildHeaderString (all), timeoutMs);
    }

private:
    static String buildHeaderString (const StringPairArray& headers)
    {
        String s;
        for (auto& key : headers.getAllKeys())
            s << key << ": " << headers[key] << "\r\n";
        return s;
    }

    static HttpResponse readStream (const URL& url,
                                    const String& extraHeaders,
                                    int timeoutMs,
                                    URL::ParameterHandling handling = URL::ParameterHandling::inPostData)
    {
        int status = 0;
        StringPairArray respHeaders;

        auto stream = url.createInputStream (URL::InputStreamOptions (handling)
                                                .withExtraHeaders (extraHeaders)
                                                .withConnectionTimeoutMs (timeoutMs)
                                                .withStatusCode (&status)
                                                .withResponseHeaders (&respHeaders));

        HttpResponse r;
        r.status  = status;
        r.headers = respHeaders;

        if (stream != nullptr)
            stream->readIntoMemoryBlock (r.raw);

        r.body = r.raw.toString();
        return r;
    }
};

} // namespace app
