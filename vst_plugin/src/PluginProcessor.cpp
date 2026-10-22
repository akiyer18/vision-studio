#include "PluginProcessor.h"
#include "PluginEditor.h"

#include "api/StabilityClient.h"
#include "api/GeminiClient.h"
#include "api/FlamingoClient.h"
#include "api/SoundchartsClient.h"
#include "audio/MidiDissector.h"

namespace app {

PluginProcessor::PluginProcessor() : AudioProcessor (BusesProperties()
    .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
    .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

PluginProcessor::~PluginProcessor()
{
    pool.removeAllJobs (true, 2000);
}

AudioProcessorEditor* PluginProcessor::createEditor()
{
    return new PluginEditor (*this);
}

//==============================================================================
// AudioProcessor basics
//==============================================================================
void PluginProcessor::prepareToPlay (double sampleRate, int)
{
    captureRate = sampleRate;
    const int maxSamples = jmax (1, (int) (30.0 * sampleRate));

    const SpinLock::ScopedLockType lock (captureLock);
    captureBuffer.setSize (2, maxSamples, false, true, true);
    captureBuffer.clear();
    captureWrite = 0;
    captureMaxSamples = maxSamples;
}

void PluginProcessor::releaseResources()
{
    playing = false;
    midiPlaying = false;
    capturing = false;
}

void PluginProcessor::getStateInformation (MemoryBlock& destData)
{
    MemoryOutputStream mos (destData, false);
    mos.writeInt (selectedIndex);
    mos.writeInt (generated.size());
    for (auto* g : generated)
        mos.writeString (g->name);
    mos.flush();
    destData.setSize (mos.getDataSize());
}

void PluginProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (data == nullptr || sizeInBytes <= 0)
        return;

    MemoryInputStream mis (data, (size_t) sizeInBytes, false);
    selectedIndex = mis.readInt();
    int n = mis.readInt();
    for (int i = 0; i < n; ++i)
        mis.readString();
    sendChangeMessage();
}

//==============================================================================
// State / keys
//==============================================================================
ApiKeys PluginProcessor::getKeys() const
{
    return settings.getKeys();
}

void PluginProcessor::setKeys (const ApiKeys& keys)
{
    settings.setKeys (keys);
    sendChangeMessage();
}

GeneratedAudio* PluginProcessor::getSelected() const
{
    const SpinLock::ScopedLockType lock (generatedLock);

    if (selectedIndex >= 0 && selectedIndex < generated.size())
        return generated[selectedIndex];
    return nullptr;
}

int PluginProcessor::getNumGenerated() const
{
    const SpinLock::ScopedLockType lock (generatedLock);
    return generated.size();
}

void PluginProcessor::setSelectedIndex (int index)
{
    {
        const SpinLock::ScopedLockType lock (generatedLock);
        selectedIndex = index;
    }
    sendChangeMessage();
}

void PluginProcessor::setJobProgress (float progress, const String& text)
{
    MessageManager::callAsync ([this, progress, text]()
    {
        job.progress = progress;
        job.statusText = text;
        sendChangeMessage();
    });
}

void PluginProcessor::failJob (const String& error)
{
    MessageManager::callAsync ([this, error]()
    {
        job.running = false;
        job.failed = true;
        job.errorText = error;
        job.statusText = "Failed";
        sendChangeMessage();
    });
}

//==============================================================================
// Job plumbing
//==============================================================================
void PluginProcessor::runJob (const String& label, std::function<void()> work)
{
    job.reset();
    job.running = true;
    job.label = label;
    job.statusText = "Working...";
    sendChangeMessage();

    pool.addJob ([this, label, work]() mutable
    {
        try
        {
            work();
        }
        catch (const std::exception& e)
        {
            MessageManager::callAsync ([this, label, msg = String (e.what())]()
            {
                job.running = false;
                job.failed = true;
                job.errorText = msg;
                job.statusText = "Failed";
                sendChangeMessage();
            });
            return;
        }

        MessageManager::callAsync ([this, label]()
        {
            job.running = false;
            job.failed = false;
            job.statusText = "Done";
            sendChangeMessage();
        });
    });
}

void PluginProcessor::addGenerated (const StabilityResult& result, const String& name,
                                    const String& source, const String& prompt, int variationIndex)
{
    auto decoded = audioIO.decode (result.audio);
    if (!decoded.ok)
        throw std::runtime_error (decoded.error.isNotEmpty() ? decoded.error.toRawUTF8()
                                                            : "Could not decode generated audio");

    auto* g = new GeneratedAudio();
    g->name = name;
    g->buffer = decoded.buffer;
    g->sampleRate = decoded.sampleRate;
    g->prompt = prompt;
    g->source = source;
    g->generationId = result.generationId;
    g->variationIndex = variationIndex;

    {
        const SpinLock::ScopedLockType lock (generatedLock);
        generated.add (g);
        selectedIndex = generated.size() - 1;
    }
    sendChangeMessage();
}

//==============================================================================
// Tab 1 — create sound from scratch (prompt + optional reference audio)
//==============================================================================
void PluginProcessor::generateFromScratch (const String& prompt, const String& refPath,
                                           double strength, int durationSec)
{
    if (prompt.trim().isEmpty()) { failJob ("Enter a prompt first."); return; }

    auto keys = getKeys();
    if (! keys.hasStability()) { failJob ("Set your Stability API key in Settings."); return; }

    const bool hasRef = refPath.isNotEmpty() && File (refPath).existsAsFile();

    runJob (hasRef ? "Creating variation..." : "Generating sound...", [this, prompt, refPath, hasRef,
                                                                       strength, durationSec, keys]()
    {
        StabilityClient client (keys.stability);
        StabilityResult r;

        if (hasRef)
        {
            auto decoded = audioIO.read (File (refPath));
            if (! decoded.ok)         throw std::runtime_error (decoded.error.toRawUTF8());

            auto wav = audioIO.encodeWav (decoded.buffer, decoded.sampleRate);
            r = client.audioToAudio (wav, File (refPath).getFileName(), prompt,
                                     strength, durationSec, "wav");
        }
        else
        {
            r = client.textToAudio (prompt, durationSec, "wav");
        }

        if (! r.ok)         throw std::runtime_error (r.error.isNotEmpty() ? r.error.toRawUTF8() : "Generation failed");

        MessageManager::callAsync ([this, r, prompt, hasRef]()
        {
            try
            {
                addGenerated (r, hasRef ? "from-scratch-variation" : "from-scratch",
                              hasRef ? "variation" : "text", prompt, 0);
            }
            catch (const std::exception& e)
            {
                failJob (e.what());
            }
        });
    });
}

//==============================================================================
// Mic capture → initiate sound (7s record, ambiente, high 0.95, bpm + melodic/rhythmic)
//==============================================================================
void PluginProcessor::recordMicAndInitiate (double strength, int bpm, bool isMelodic)
{
    if (! getKeys().hasStability()) { failJob ("Set your Stability API key in Settings."); return; }

    captureMicForSeconds (7);

    runJob ("Recording mic (7s)...", [this, strength, bpm, isMelodic, keys = getKeys()]()
    {
        int waited = 0;
        while (capturing && waited < 15000)
        {
            Thread::sleep (100);
            waited += 100;
        }

        if (capturing)
        {
            capturing = false;
            MessageManager::callAsync ([this]() { sendChangeMessage(); });
            throw std::runtime_error ("Mic capture did not complete in time.");
        }

        auto trimmed = copyCapturedAudio();
        if (trimmed.getNumSamples() == 0)
            throw std::runtime_error ("No audio captured from mic.");

        String style = isMelodic ? "melodic" : "rhythmic";
        String prompt = "A " + style + " lo-fi hip-hop beat at " + String (bpm) +
                        " BPM with ambiente and chillhop vibe, warm and nostalgic.";

        const int len = trimmed.getNumSamples();
        auto wav = audioIO.encodeWav (trimmed, captureRate);

        StabilityClient client (keys.stability);
        auto r = client.audioToAudio (wav, "mic-capture.wav", prompt,
                                      strength, jmax (6, (int) (len / captureRate)), "wav");

        if (! r.ok)         throw std::runtime_error (r.error.isNotEmpty() ? r.error.toRawUTF8() : "Generation failed");

        MessageManager::callAsync ([this, r, prompt, style, bpm]()
        {
            try
            {
                addGenerated (r, "mic-initiate", "variation",
                              prompt + " [style=" + style + ", bpm=" + String (bpm) + "]", 0);
            }
            catch (const std::exception& e)
            {
                failJob (e.what());
            }
        });
    });
}

//==============================================================================
// Tab 2 — analyse uploaded / captured track
//==============================================================================
void PluginProcessor::analyseTrack (const String& path, bool advancedBreakdown)
{
    const File fallback = lastCaptureFile;

    runJob (advancedBreakdown ? "Advanced breakdown..." : "Analysing track...",
            [this, path, advancedBreakdown, fallback]()
    {
        File file = path.isNotEmpty() ? File (path) : fallback;
        if (! file.existsAsFile())
            throw std::runtime_error ("Load a track or capture from the DAW first.");

        auto decoded = audioIO.read (file);
        if (! decoded.ok)         throw std::runtime_error (decoded.error.toRawUTF8());

        auto wav = audioIO.encodeWav (decoded.buffer, decoded.sampleRate);

        auto keys = getKeys();
        String text, err;

        if (advancedBreakdown && keys.hasFlamingo())
        {
            FlamingoClient flamingo (keys.huggingFace);
            text = flamingo.ask (wav, Prompts::analyseTrack(), err);
        }

        if (text.isEmpty())
        {
            GeminiClient gemini (keys.gemini, keys.geminiModel);
            auto res = gemini.askAudio (wav, "audio/wav", Prompts::analyseTrack());
            text = res.text;
            err = res.error;
        }

        if (text.isEmpty())
            throw std::runtime_error (err.isNotEmpty() ? err.toRawUTF8() : "Analysis returned no text");

        MessageManager::callAsync ([this, text, file, decoded]()
        {
            analysisText = text;
            analysisPath = file.getFullPathName();
            analysedFile = file;
            analysedAudio = decoded;
            sendChangeMessage();
        });
    });
}

void PluginProcessor::suggestImprovements()
{
    if (! analysedAudio.ok) { failJob ("Analyse a track first."); return; }

    runJob ("Suggesting improvements...", [this]()
    {
        auto wav = audioIO.encodeWav (analysedAudio.buffer, analysedAudio.sampleRate);
        auto keys = getKeys();

        GeminiClient gemini (keys.gemini, keys.geminiModel);
        auto res = gemini.askAudio (wav, "audio/wav", Prompts::suggestImprovements());

        if (! res.hasText()) throw std::runtime_error (res.error.toRawUTF8());

        MessageManager::callAsync ([this, text = res.text]()
        {
            improvementsText = text;
            sendChangeMessage();
        });
    });
}

void PluginProcessor::generateAlternatives()
{
    if (! analysedAudio.ok) { failJob ("Analyse a track first."); return; }

    auto keys = getKeys();
    if (! keys.hasStability()) { failJob ("Set your Stability API key in Settings."); return; }

    const int duration = jmax (6, (int) analysedAudio.lengthSeconds());
    const int altCount = 3;

    runJob ("Generating 3 alternatives...", [this, keys, duration, altCount]()
    {
        auto wav = audioIO.encodeWav (analysedAudio.buffer, analysedAudio.sampleRate);
        StabilityClient client (keys.stability);

        for (int i = 1; i <= altCount; ++i)
        {
            setJobProgress ((float) (i - 1) / (float) altCount,
                            "Generating alternative " + String (i) + "/" + String (altCount) + "...");

            auto r = client.audioToAudio (wav, "original.wav",
                                          "A lo-fi hip hop production variation of this track, "
                                          "same genre and mood, different arrangement and sound design.",
                                          0.5, duration, "wav");

        if (! r.ok) throw std::runtime_error (r.error.isNotEmpty() ? r.error.toRawUTF8() : "Generation failed");

            const int index = i;
            MessageManager::callAsync ([this, r, index]()
            {
                try
                {
                    addGenerated (r, "alternative-" + String (index), "variation",
                                  "Variation " + String (index), index);
                }
                catch (const std::exception& e)
                {
                    failJob (e.what());
                }
            });
        }
    });
}

void PluginProcessor::compareAlternative (int index)
{
    if (index < 0 || index >= generated.size()) return;
    if (! analysedAudio.ok) { failJob ("Analyse a track first."); return; }

    AudioBuffer<float> altBuf = generated[index]->buffer;
    double altRate = generated[index]->sampleRate;

    runJob ("Comparing alternative...", [this, index, altBuf, altRate]()
    {
        auto origWav = audioIO.encodeWav (analysedAudio.buffer, analysedAudio.sampleRate);
        auto altWav  = audioIO.encodeWav (altBuf, altRate);

        auto keys = getKeys();
        GeminiClient gemini (keys.gemini, keys.geminiModel);
        auto res = gemini.askAudioPair (origWav, "audio/wav", altWav, "audio/wav",
                                        Prompts::explainChanges());

        if (! res.hasText()) throw std::runtime_error (res.error.toRawUTF8());

        MessageManager::callAsync ([this, index, text = res.text]()
        {
            if (index >= 0 && index < generated.size())
                generated[index]->analysis = text;
            sendChangeMessage();
        });
    });
}

void PluginProcessor::findReferences (const String& query)
{
    runJob ("Finding references...", [this, query]()
    {
        auto keys = getKeys();
        String out;

        if (keys.hasSoundcharts())
        {
            SoundchartsClient sc (keys.soundcharts);
            String err;
            auto json = sc.findReferences (query.isNotEmpty() ? query : "lofi hip hop", err);
            if (json.isNotEmpty())
                out += "Similar artists (Soundcharts):\n" + json + "\n\n";
            else
                out += "Soundcharts unavailable: " + err + "\n\n";
        }

        GeminiClient gemini (keys.gemini, keys.geminiModel);
        String context = analysisText.isNotEmpty() ? analysisText.substring (0, 2000)
                                                   : (query.isNotEmpty() ? query : "lo-fi hip hop");

        auto res = gemini.askText (String (Prompts::genreHistoryAndArtists())
                                   + "\n\nRank references by popularity. Include geolocation (where the genre is strongest) "
                                     "and recent trends (what is trending in the last months).\n\n"
                                   + "Context about the track:\n" + context);
        if (res.hasText())
            out += "Genre history & references (ranked by popularity, with geolocation and trends):\n" + res.text;

        if (out.isEmpty())
            throw std::runtime_error ("No reference results (check keys in Settings).");

        MessageManager::callAsync ([this, out]()
        {
            referencesText = out;
            sendChangeMessage();
        });
    });
}

//==============================================================================
// Tab 3 — tweak a sample
//==============================================================================
void PluginProcessor::tweakSample (const String& path, const String& prompt, double strength)
{
    if (! File (path).existsAsFile()) { failJob ("Choose a sample file first."); return; }

    auto keys = getKeys();
    if (! keys.hasStability()) { failJob ("Set your Stability API key in Settings."); return; }

    runJob ("Tweaking sample...", [this, path, prompt, strength, keys]()
    {
        auto decoded = audioIO.read (File (path));
        if (! decoded.ok) throw std::runtime_error (decoded.error.toRawUTF8());

        auto wav = audioIO.encodeWav (decoded.buffer, decoded.sampleRate);
        StabilityClient client (keys.stability);

        auto r = client.audioToAudio (wav, File (path).getFileName(), prompt, strength,
                                      jmax (6, (int) decoded.lengthSeconds()), "wav");

        if (! r.ok)         throw std::runtime_error (r.error.isNotEmpty() ? r.error.toRawUTF8() : "Generation failed");

        MessageManager::callAsync ([this, r, prompt]()
        {
            try
            {
                addGenerated (r, "tweak", "tweak", prompt, 0);
            }
            catch (const std::exception& e)
            {
                failJob (e.what());
            }
        });
    });
}

//==============================================================================
// Send to DAW
//==============================================================================
void PluginProcessor::sendToDaw (int index, bool writeFiles)
{
    if (index < 0 || index >= generated.size()) { failJob ("Nothing to send."); return; }

    AudioBuffer<float> buf  = generated[index]->buffer;
    double             rate = generated[index]->sampleRate;
    String             name = generated[index]->name;
    String             folder = settings.getExportFolder().getFullPathName();

    runJob ("Sending to DAW...", [this, buf, rate, name, folder, index, writeFiles]()
    {
        GeneratedAudio ga;
        ga.buffer = buf;
        ga.sampleRate = rate;
        ga.name = name;

        MidiDissector dissector;
        auto tracks = dissector.dissect (ga);
        auto midiBuffer = dissector.toBuffer (tracks);

        String exportedTo;
        if (writeFiles)
        {
            File dir (folder);
            dir.createDirectory();

            String base = File::createLegalFileName (name.isNotEmpty() ? name : "adehack");
            base = base + "_" + String (index + 1);

            auto wav = audioIO.encodeWav (ga.buffer, ga.sampleRate);
            File wavFile = dir.getChildFile (base + ".wav");
            wavFile.replaceWithData (wav.getData(), wav.getSize());

            File midFile = dir.getChildFile (base + ".mid");
            dissector.writeMidiFile (tracks, midFile);

            exportedTo = dir.getFullPathName();
        }

        MessageManager::callAsync ([this, midiBuffer, exportedTo]()
        {
            pendingMidi = midiBuffer;

            int maxTs = 0;
            for (const auto metadata : pendingMidi)
                maxTs = jmax (maxTs, (int) metadata.getMessage().getTimeStamp());

            midiTotalSamples = maxTs + 1;
            midiCursor = 0;
            midiPlaying = true;
            playing = true;
            playPosition = 0;
            lastExportFolder = exportedTo;

            job.running = false;
            job.failed = false;
            job.statusText = exportedTo.isNotEmpty() ? ("Exported to " + exportedTo)
                                                     : "Playing in DAW";
            sendChangeMessage();
        });
    });
}

//==============================================================================
// Carry on — how the track can develop (text ideas only, no artifact rebuild)
//==============================================================================
void PluginProcessor::carryOnTrack (int index)
{
    if (index < 0 || index >= generated.size()) { failJob ("Nothing to develop."); return; }
    if (! analysedAudio.ok) { failJob ("Analyse a track first."); return; }

    auto* g = generated[index];
    AudioBuffer<float> buf = g->buffer;
    double rate = g->sampleRate;
    String name = g->name;
    String prompt = g->prompt;

    runJob ("Generating carry-on ideas...", [this, index, buf, rate, name, prompt]()
    {
        auto wav = audioIO.encodeWav (buf, rate);
        auto keys = getKeys();

        GeminiClient gemini (keys.gemini, keys.geminiModel);
        String question = String (Prompts::carryOnDevelop())
                          + "\n\nTrack prompt: \"" + prompt + "\"\n"
                            "Track duration: " + String (buf.getNumSamples() / rate, 2) + " seconds.";
        auto res = gemini.askAudio (wav, "audio/wav", question);

        if (! res.hasText()) throw std::runtime_error (res.error.toRawUTF8());

        MessageManager::callAsync ([this, index, text = res.text]()
        {
            carryOnText = text;
            sendChangeMessage();
        });
    });
}

//==============================================================================
// DAW input capture
//==============================================================================
void PluginProcessor::startCapture()
{
    double rate = getSampleRate() > 0 ? getSampleRate() : 44100.0;
    captureRate = rate;
    const int maxSamples = jmax (1, (int) (30.0 * rate));

    {
        const SpinLock::ScopedLockType lock (captureLock);

        if (captureBuffer.getNumChannels() != 2 || captureBuffer.getNumSamples() < maxSamples)
            captureBuffer.setSize (2, maxSamples, false, true, true);

        captureBuffer.clear();
        captureWrite = 0;
        captureMaxSamples = jmin (maxSamples, captureBuffer.getNumSamples());
        capturing = true;
    }

    sendChangeMessage();
}

void PluginProcessor::stopCapture()
{
    capturing = false;
    sendChangeMessage();
}

File PluginProcessor::stopCaptureAndSave()
{
    capturing = false;
    return saveCaptureToDisk();
}

void PluginProcessor::captureMicForSeconds (int seconds)
{
    double rate = getSampleRate() > 0 ? getSampleRate() : 44100.0;
    captureRate = rate;
    const int maxSamples = jmax (1, seconds) * (int) rate;

    {
        const SpinLock::ScopedLockType lock (captureLock);

        if (captureBuffer.getNumChannels() != 2 || captureBuffer.getNumSamples() < maxSamples)
            captureBuffer.setSize (2, maxSamples, false, true, true);

        captureBuffer.clear();
        captureWrite = 0;
        captureMaxSamples = jmin (maxSamples, captureBuffer.getNumSamples());
        capturing = true;
    }

    sendChangeMessage();
}

String PluginProcessor::getMicCaptureStatus() const
{
    if (! capturing)
        return "Idle";

    double secs = captureRate > 0 ? (double) captureWrite.load() / captureRate : 0.0;
    double total = captureRate > 0 ? (double) captureMaxSamples.load() / captureRate : 0.0;
    return String ("Capturing mic: ") + String (secs, 1) + "s / " + String (total, 0) + "s";
}

AudioBuffer<float> PluginProcessor::copyCapturedAudio() const
{
    const SpinLock::ScopedLockType lock (captureLock);

    const int len = jmin (captureWrite.load(), captureBuffer.getNumSamples());
    if (len <= 0)
        return {};

    AudioBuffer<float> copy (captureBuffer.getNumChannels(), len);
    for (int ch = 0; ch < captureBuffer.getNumChannels(); ++ch)
        copy.copyFrom (ch, 0, captureBuffer, ch, 0, len);

    return copy;
}

File PluginProcessor::saveCaptureToDisk()
{
    capturing = false;

    auto trimmed = copyCapturedAudio();
    if (trimmed.getNumSamples() <= 0)
    {
        sendChangeMessage();
        return {};
    }

    File dir = File::getSpecialLocation (File::userApplicationDataDirectory)
                 .getChildFile ("ADE Hack").getChildFile ("captures");
    dir.createDirectory();

    File f = dir.getChildFile ("daw-capture-" + Time::getCurrentTime().formatted ("%Y%m%d-%H%M%S") + ".wav");

    auto wav = audioIO.encodeWav (trimmed, captureRate);
    f.replaceWithData (wav.getData(), wav.getSize());
    lastCaptureFile = f;

    sendChangeMessage();
    return f;
}

//==============================================================================
// Audio
//==============================================================================
void PluginProcessor::processBlock (AudioBuffer<float>& audio, MidiBuffer& midi)
{
    const int numSamples = audio.getNumSamples();

    // Capture DAW input
    if (capturing.load (std::memory_order_relaxed))
    {
        auto input = getBusBuffer (audio, true, 0);
        const int numInputChannels = input.getNumChannels();

        if (numInputChannels > 0)
        {
            bool finished = false;

            {
                const SpinLock::ScopedTryLockType lock (captureLock);

                if (lock.isLocked() && captureBuffer.getNumSamples() > 0)
                {
                    const int target = captureMaxSamples.load (std::memory_order_relaxed);
                    const int written = captureWrite.load (std::memory_order_relaxed);
                    const int toCopy = jmin (numSamples, target - written);

                    if (toCopy > 0)
                    {
                        for (int ch = 0; ch < captureBuffer.getNumChannels(); ++ch)
                            captureBuffer.copyFrom (ch, written, input,
                                                    jmin (ch, numInputChannels - 1), 0, toCopy);

                        captureWrite.store (written + toCopy, std::memory_order_relaxed);
                    }

                    if (captureWrite.load (std::memory_order_relaxed) >= target)
                    {
                        capturing = false;
                        finished = true;
                    }
                }
            }

            if (finished)
                sendChangeMessage();
        }
    }

    auto output = getBusBuffer (audio, false, 0);
    output.clear();

    // Playback the selected generated audio
    {
        const SpinLock::ScopedTryLockType lock (generatedLock);

        if (lock.isLocked() && playing
            && selectedIndex >= 0 && selectedIndex < generated.size())
        {
            auto* g = generated[selectedIndex];

            if (g != nullptr && g->buffer.getNumSamples() > 0)
            {
                const int total = g->buffer.getNumSamples();

                if (playPosition < 0 || playPosition >= total)
                    playPosition = 0;

                int pos = playPosition;
                int written = 0;

                while (written < numSamples)
                {
                    const int chunk = jmin (numSamples - written, total - pos);

                    for (int ch = 0; ch < output.getNumChannels(); ++ch)
                    {
                        const int srcCh = jmin (ch, g->buffer.getNumChannels() - 1);
                        output.copyFrom (ch, written, g->buffer, srcCh, pos, chunk);
                    }

                    written += chunk;
                    pos += chunk;
                    if (pos >= total)
                        pos = 0;   // seamless loop
                }

                playPosition = pos;
            }
        }
    }

    // Emit dissected MIDI
    if (midiPlaying && ! pendingMidi.isEmpty() && midiTotalSamples > 0)
    {
        for (const auto metadata : pendingMidi)
        {
            auto msg = metadata.getMessage();
            int ts = (int) msg.getTimeStamp();
            if (ts >= midiCursor && ts < midiCursor + numSamples)
                midi.addEvent (msg, ts - midiCursor);
        }

        midiCursor += numSamples;
        if (midiCursor >= midiTotalSamples)
            midiCursor = 0;   // loop
    }
}

} // namespace app

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new app::PluginProcessor();
}
