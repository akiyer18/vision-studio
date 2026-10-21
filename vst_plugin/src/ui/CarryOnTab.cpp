#include "CarryOnTab.h"

namespace app {

CarryOnTab::CarryOnTab (PluginProcessor& p) : processor (p)
{
    sourceLabel.setText ("No track analysed yet", dontSendNotification);
    sourceLabel.setFont (Font (13.0f, Font::bold));
    sourceLabel.setJustificationType (Justification::left);
    sourceLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (sourceLabel);

    carryOnButton.setButtonText ("Generate carry-on development ideas");
    carryOnButton.onClick = [this]()
    {
        int idx = processor.getSelectedIndex();
        if (idx < 0) { resultBox.setText ("Select a generated track first."); return; }
        processor.carryOnTrack (idx);
    };
    addAndMakeVisible (carryOnButton);

    addAndMakeVisible (resultBox);
    addAndMakeVisible (statusBar);

    setSize (640, 560);

    processor.addChangeListener (this);
}

CarryOnTab::~CarryOnTab()
{
    processor.removeChangeListener (this);
}

void CarryOnTab::updateStatus ()
{
    auto& js = processor.getJobState();
    statusBar.setState (js);

    carryOnButton.setEnabled (! js.running && processor.getSelectedIndex() >= 0);

    if (processor.hasAnalysedAudio())
        sourceLabel.setText ("Source: " + processor.getAnalysisPath().isNotEmpty()
                             ? File (processor.getAnalysisPath()).getFileName()
                             : "captured audio", dontSendNotification);
    else
        sourceLabel.setText ("No track analysed yet", dontSendNotification);

    if (! processor.getCarryOnText().isEmpty())
        resultBox.setText (processor.getCarryOnText());
    else
        resultBox.setText ("Select a generated track and click Generate carry-on development ideas.", dontSendNotification);
}

void CarryOnTab::paint (Graphics&)
{
}

void CarryOnTab::resized()
{
    auto b = getLocalBounds().reduced (10);

    sourceLabel.setBounds (b.removeFromTop (22));
    carryOnButton.setBounds (b.removeFromTop (34));

    b.removeFromTop (10);
    resultBox.setBounds (b.removeFromTop (340));

    b.removeFromTop (6);
    statusBar.setBounds (b.removeFromTop (80));
}

void CarryOnTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
