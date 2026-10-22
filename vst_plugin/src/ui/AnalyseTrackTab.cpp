#include "AnalyseTrackTab.h"

namespace app {

AnalyseTrackTab::AnalyseTrackTab (PluginProcessor& p) : processor (p)
{
    // --- Track source ---
    styleFieldHint (fileLabel, "No track loaded");
    addAndMakeVisible (fileLabel);

    styleFieldTitle (pathLabel, "Track file path");
    addAndMakeVisible (pathLabel);

    trackPathEditor.setMultiLine (false);
    trackPathEditor.setText ("", dontSendNotification);
    trackPathEditor.setColour (TextEditor::textColourId, Colours::white);
    addAndMakeVisible (trackPathEditor);

    styleFieldHint (pathHint, "Absolute path to a .wav, .mp3 or .flac file. Leave empty to use the latest DAW capture.");
    addAndMakeVisible (pathHint);

    captureButton.setButtonText ("Capture from DAW input");
    captureButton.setClickingTogglesState (true);
    captureButton.onClick = [this]()
    {
        capturingUI = captureButton.getToggleState();

        if (capturingUI)
        {
            processor.startCapture();
            captureButton.setButtonText ("Stop capture");
            fileLabel.setText ("Capturing from DAW input...", dontSendNotification);
        }
        else
        {
            auto captured = processor.stopCaptureAndSave();
            captureButton.setButtonText ("Capture from DAW input");

            if (captured.existsAsFile())
            {
                trackPathEditor.setText (captured.getFullPathName(), dontSendNotification);
                fileLabel.setText ("Captured: " + captured.getFileName(), dontSendNotification);
            }
            else
            {
                fileLabel.setText ("No audio captured. Check the plugin's audio input routing.", dontSendNotification);
            }
        }
    };
    addAndMakeVisible (captureButton);

    styleFieldHint (captureHint, "Records up to 30 s from this track's audio input. Route audio to the plugin input in your DAW first.");
    addAndMakeVisible (captureHint);

    // --- Advanced breakdown toggle ---
    advancedButton.setButtonText ("Advanced tech breakdown? (Flamingo)");
    advancedButton.setClickingTogglesState (true);
    addAndMakeVisible (advancedButton);

    // --- Actions ---
    analyseButton.setButtonText ("Analyse track");
    analyseButton.onClick = [this]()
    {
        auto path = trackPathEditor.getText().trim();

        if (path.isEmpty() && ! processor.getLastCaptureFile().existsAsFile())
        {
            fileLabel.setText ("Load a track or capture from the DAW first.", dontSendNotification);
            return;
        }

        processor.analyseTrack (path, advancedButton.getToggleState());
    };
    addAndMakeVisible (analyseButton);

    improvementsButton.setButtonText ("Suggest improvements");
    improvementsButton.onClick = [this]() { processor.suggestImprovements(); };
    addAndMakeVisible (improvementsButton);

    // --- Results ---
    addAndMakeVisible (analysisResult);
    addAndMakeVisible (improvementsResult);

    setSize (640, 600);

    processor.addChangeListener (this);
}

AnalyseTrackTab::~AnalyseTrackTab()
{
    processor.removeChangeListener (this);
}

void AnalyseTrackTab::updateStatus ()
{
    auto& js = processor.getJobState();
    analyseButton.setEnabled (! js.running);
    improvementsButton.setEnabled (! js.running);

    if (capturingUI && ! processor.isCapturing())
    {
        capturingUI = false;
        captureButton.setToggleState (false, dontSendNotification);
        captureButton.setButtonText ("Capture from DAW input");

        auto captured = processor.saveCaptureToDisk();

        if (captured.existsAsFile())
        {
            trackPathEditor.setText (captured.getFullPathName(), dontSendNotification);
            fileLabel.setText ("Captured: " + captured.getFileName(), dontSendNotification);
        }
        else
        {
            fileLabel.setText ("No audio captured. Check the plugin's audio input routing.", dontSendNotification);
        }
    }

    if (! processor.getAnalysisText().isEmpty())
        analysisResult.setText (processor.getAnalysisText());
    if (! processor.getImprovementsText().isEmpty())
        improvementsResult.setText (processor.getImprovementsText());
}

void AnalyseTrackTab::paint (Graphics&)
{
}

void AnalyseTrackTab::resized()
{
    auto b = getLocalBounds().reduced (10);

    fileLabel.setBounds (b.removeFromTop (20));
    pathLabel.setBounds (b.removeFromTop (18));
    trackPathEditor.setBounds (b.removeFromTop (26));
    pathHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (8);
    captureButton.setBounds (b.removeFromTop (28));
    captureHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (8);
    advancedButton.setBounds (b.removeFromTop (24));

    auto btnRow = b.removeFromTop (34);
    analyseButton.setBounds     (btnRow.removeFromLeft (150));
    improvementsButton.setBounds(btnRow.removeFromLeft (160));

    b.removeFromTop (10);
    analysisResult.setBounds (b.removeFromTop (140));

    b.removeFromTop (8);
    improvementsResult.setBounds (b.removeFromTop (140));
}

void AnalyseTrackTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
