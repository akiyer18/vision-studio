#pragma once

#include <atomic>

#include <JuceHeader.h>

#include "core/PluginState.h"
#include "core/SettingsStore.h"
#include "audio/AudioUtils.h"
#include "api/StabilityClient.h"

namespace app {

class PluginProcessor : public AudioProcessor,
                        public ChangeBroadcaster
{
public:
    PluginProcessor();
    ~PluginProcessor() override;

    //==========================================================================
    // AudioProcessor
    //==========================================================================
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock (AudioBuffer<float>&, MidiBuffer&) override;
    bool supportsDoublePrecisionProcessing() const override { return false; }

    AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const String getName() const override { return "ADE Hack"; }

    bool acceptsMidi()  const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int  getNumPrograms() override { return 1; }
    int  getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const String getProgramName (int) override { return {}; }
    void changeProgramName (int, const String&) override {}

    void getStateInformation (MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    //==========================================================================
    // State access (UI)
    //==========================================================================
    SettingsStore& getSettings() { return settings; }
    ApiKeys getKeys() const;
    void setKeys (const ApiKeys& keys);

    OwnedArray<GeneratedAudio>& getGenerated() { return generated; }
    int getNumGenerated() const;
    GeneratedAudio* getSelected() const;
    int getSelectedIndex() const { return selectedIndex; }
    void setSelectedIndex (int index);

    JobState& getJobState() { return job; }
    void setJobProgress (float progress, const String& text);
    void failJob (const String& error);

    // Text results for the UI.
    String getAnalysisText() const { return analysisText; }
    String getAnalysisPath() const { return analysisPath; }
    String getImprovementsText() const { return improvementsText; }
    String getReferencesText() const { return referencesText; }
    String getCarryOnText() const { return carryOnText; }
    bool hasAnalysedAudio() const { return analysedAudio.ok; }
    bool isPlaying() const { return playing; }
    bool isMicCapturing() const { return capturing; }
    String getMicCaptureStatus() const;
    void setPlaying (bool shouldPlay) { playing = shouldPlay; job.reset(); sendChangeMessage(); }

    //==========================================================================
    // Actions (all run on a worker thread; UI gets a ChangeBroadcaster ping)
    //==========================================================================
    void generateFromScratch (const String& prompt, const String& refPath,
                              double strength, int durationSec);
    void captureMicForSeconds (int seconds);
    void recordMicAndInitiate (double strength, int bpm, bool isMelodic);
    void analyseTrack (const String& path, bool advancedBreakdown);
    void suggestImprovements();
    void generateAlternatives();
    void compareAlternative (int index);
    void findReferences (const String& query);
    void tweakSample (const String& path, const String& prompt, double strength);
    void carryOnTrack (int index);
    void sendToDaw (int index, bool writeFiles);

    // DAW input capture (the "from DAW" option on the analyse tab).
    void startCapture();
    void stopCapture();
    File stopCaptureAndSave();
    bool isCapturing() const { return capturing; }
    File saveCaptureToDisk();
    File getLastCaptureFile() const { return lastCaptureFile; }

    // Export the dissected tracks for the given generated item.
    String getLastExportFolder() const { return lastExportFolder; }

private:
    void runJob (const String& label, std::function<void()> work);
    void addGenerated (const StabilityResult& result, const String& name,
                       const String& source, const String& prompt, int variationIndex);
    void emitJobDone();

    SettingsStore settings;
    AudioIO        audioIO;

    OwnedArray<GeneratedAudio> generated;
    mutable SpinLock generatedLock;
    int  selectedIndex { -1 };

    JobState job;

    // Analysis state
    String     analysisText;
    String     analysisPath;
    String     improvementsText;
    String     referencesText;
    String     carryOnText;
    DecodedAudio analysedAudio;
    File       analysedFile;

    // Playback
    bool playing { false };
    int  playPosition { 0 };

    // Live MIDI emission
    bool      midiPlaying { false };
    int       midiCursor { 0 };
    int       midiTotalSamples { 0 };
    MidiBuffer pendingMidi;

    // Capture
    std::atomic<bool> capturing { false };
    AudioBuffer<float> captureBuffer;
    std::atomic<int>  captureWrite { 0 };
    double            captureRate { 44100.0 };
    std::atomic<int>  captureMaxSamples { 0 };
    File              lastCaptureFile;
    mutable SpinLock  captureLock;

    AudioBuffer<float> copyCapturedAudio() const;

    String lastExportFolder;

    ThreadPool pool { 1 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginProcessor)
};

} // namespace app
