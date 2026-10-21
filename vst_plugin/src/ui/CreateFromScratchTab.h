#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Tab 1 — create from scratch (prompt text + optional sound).
// Also supports recording mic for 7s to initiate a sound with ambiente + high 0.95 strength.
class CreateFromScratchTab : public Component, public ChangeListener
{
public:
    CreateFromScratchTab (PluginProcessor& p);
    ~CreateFromScratchTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       promptLabel;
    TextEditor  promptEditor;
    Label       refLabel;
    TextEditor  refPathEditor;

    // Mic / initiate controls
    Label       micLabel;
    TextButton  recordMicButton;
    Label       micStatusLabel;
    Label       bpmLabel;
    TextEditor  bpmEditor;
    ToggleButton  melodicToggle;

    Label       strengthLabel;
    Slider      strengthSlider;
    Label       durationLabel;
    TextEditor  durationEditor;

    TextButton  generateButton;
    TextButton  playButton;
    ResultBox   resultBox;
    StatusBar   statusBar;

    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CreateFromScratchTab)
};

} // namespace app
