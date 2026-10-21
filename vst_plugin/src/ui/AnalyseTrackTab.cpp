#include "AnalyseTrackTab.h"

namespace app {

AnalyseTrackTab::AnalyseTrackTab (PluginProcessor& p) : processor (p)
{
    // --- Track source ---
    fileLabel.setText ("No track loaded", dontSendNotification);
    fileLabel.setFont (Font (13.0f, Font::bold));
    fileLabel.setJustificationType (Justification::left);
    fileLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (fileLabel);

    trackPathEditor.setMultiLine (false);
    trackPathEditor.setText ("", dontSendNotification);
    addAndMakeVisible (trackPathEditor);

    captureButton.setButtonText ("Capture from DAW input");
    captureButton.setClickingTogglesState (true);
    captureButton.onClick = [this]()
    {
        capturingUI = captureButton.getToggleState();
        if (capturingUI) processor.startCapture();
        else             processor.stopCapture();
        captureButton.setButtonText (capturingUI ? "Stop capture" : "Capture from DAW input");
    };
    addAndMakeVisible (captureButton);

    // --- Advanced breakdown toggle ---
    advancedButton.setButtonText ("Advanced tech breakdown? (Flamingo)");
    advancedButton.setClickingTogglesState (true);
    addAndMakeVisible (advancedButton);

    // --- Actions ---
    analyseButton.setButtonText ("Analyse track");
    analyseButton.onClick = [this]()
    {
        processor.analyseTrack (trackPathEditor.getText().trim(), advancedButton.getToggleState());
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

    fileLabel.setBounds (b.removeFromTop (22));
    auto srcRow = b.removeFromTop (28);
    trackPathEditor.setBounds (srcRow.removeFromLeft (260));
    captureButton.setBounds    (srcRow.removeFromLeft (170));

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
