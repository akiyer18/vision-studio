#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Tab 3 — tweak a sample into a new sample, then send back to the DAW.
class TweakSampleTab : public Component, public ChangeListener
{
public:
    TweakSampleTab (PluginProcessor& p);
    ~TweakSampleTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       sampleLabel;
    TextEditor  samplePathEditor;
    Label       samplePathLabel;
    Label       samplePathHint;

    TextEditor  promptEditor;
    Label       promptLabel;
    Label       promptHint;

    Label       strengthLabel;
    Label       strengthHint;
    Slider      strengthSlider;

    TextButton  tweakButton;
    TextButton  sendButton;
    TextButton  playButton;

    ResultBox   resultBox;
    StatusBar   statusBar;

    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TweakSampleTab)
};

} // namespace app
