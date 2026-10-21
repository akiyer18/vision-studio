#include "TweakSampleTab.h"

namespace app {

TweakSampleTab::TweakSampleTab (PluginProcessor& p) : processor (p)
{
    // --- Sample source ---
    sampleLabel.setText ("No sample loaded", dontSendNotification);
    sampleLabel.setFont (Font (13.0f, Font::bold));
    sampleLabel.setJustificationType (Justification::left);
    sampleLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (sampleLabel);

    samplePathLabel.setText ("Sample path", dontSendNotification);
    samplePathLabel.setFont (Font (12.0f));
    samplePathLabel.setJustificationType (Justification::left);
    addAndMakeVisible (samplePathLabel);

    samplePathEditor.setMultiLine (false);
    samplePathEditor.setText ("", dontSendNotification);
    addAndMakeVisible (samplePathEditor);

    // --- Prompt ---
    promptLabel.setText ("Tweak prompt", dontSendNotification);
    promptLabel.setFont (Font (14.0f, Font::bold));
    promptLabel.setJustificationType (Justification::left);
    addAndMakeVisible (promptLabel);

    promptEditor.setMultiLine (true);
    promptEditor.setReturnKeyStartsNewLine (true);
    promptEditor.setScrollbarsShown (true);
    promptEditor.setText ("Make this a warmer, dustier lo-fi hip-hop beat: softer transients, "
                          "more vinyl crackle, rounded sub-bass, relaxed swing.",
                          dontSendNotification);
    addAndMakeVisible (promptEditor);

    // --- Strength ---
    strengthLabel.setText ("Noise / variation strength", dontSendNotification);
    strengthLabel.setFont (Font (12.0f));
    strengthLabel.setJustificationType (Justification::left);
    addAndMakeVisible (strengthLabel);

    strengthSlider.setRange (0.0, 1.0, 0.05);
    strengthSlider.setValue (0.4);
    strengthSlider.setSliderStyle (Slider::LinearHorizontal);
    strengthSlider.setTextBoxStyle (Slider::TextBoxRight, false, 60, 20);
    addAndMakeVisible (strengthSlider);

    // --- Actions ---
    tweakButton.setButtonText ("Tweak sample");
    tweakButton.onClick = [this]()
    {
        if (samplePathEditor.getText().trim().isEmpty()) { resultBox.setText ("Enter a sample path first."); return; }
        processor.tweakSample (samplePathEditor.getText().trim(), promptEditor.getText().trim(), strengthSlider.getValue());
    };
    addAndMakeVisible (tweakButton);

    sendButton.setButtonText ("Send selected to DAW (+ dissected MIDI)");
    sendButton.onClick = [this]()
    {
        int idx = processor.getSelectedIndex();
        if (idx < 0) { resultBox.setText ("Nothing generated yet."); return; }
        processor.sendToDaw (idx, true);
    };
    addAndMakeVisible (sendButton);

    playButton.setButtonText ("Play selected");
    playButton.onClick = [this]()
    {
        processor.setPlaying (! processor.isPlaying());
        playButton.setButtonText (processor.isPlaying() ? "Stop" : "Play selected");
    };
    addAndMakeVisible (playButton);

    // --- Results ---
    addAndMakeVisible (resultBox);
    addAndMakeVisible (statusBar);

    setSize (560, 640);

    processor.addChangeListener (this);
}

TweakSampleTab::~TweakSampleTab()
{
    processor.removeChangeListener (this);
}

void TweakSampleTab::updateStatus ()
{
    auto& js = processor.getJobState();
    statusBar.setState (js);
    tweakButton.setEnabled (! js.running);

    if (js.failed)
        resultBox.setText ("Error: " + js.errorText);
    else if (js.statusText == "Done" && processor.getNumGenerated() > 0)
    {
        auto* g = processor.getSelected();
        resultBox.setText ("Tweaked: " + g->name + "  (" + g->source + ")"
                           + "\nDuration: " + String (g->getLengthSeconds(), 2) + " s"
                           + "\nPrompt: " + g->prompt);
    }
}

void TweakSampleTab::paint (Graphics&)
{
}

void TweakSampleTab::resized()
{
    auto b = getLocalBounds().reduced (10);

    sampleLabel.setBounds (b.removeFromTop (22));
    samplePathLabel.setBounds (b.removeFromTop (20));
    samplePathEditor.setBounds (b.removeFromTop (26));

    b.removeFromTop (8);
    promptLabel.setBounds (b.removeFromTop (20));
    promptEditor.setBounds (b.removeFromTop (100));

    b.removeFromTop (10);
    strengthLabel.setBounds (b.removeFromTop (18));
    strengthSlider.setBounds (b.removeFromTop (24));

    b.removeFromTop (14);
    auto btnRow = b.removeFromTop (34);
    tweakButton.setBounds (btnRow.removeFromLeft (150));
    sendButton.setBounds  (btnRow.removeFromLeft (220));

    b.removeFromTop (10);
    playButton.setBounds (b.removeFromTop (26));

    b.removeFromTop (10);
    resultBox.setBounds (b.removeFromTop (130));

    b.removeFromTop (6);
    statusBar.setBounds (b.removeFromTop (100));
}

void TweakSampleTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
