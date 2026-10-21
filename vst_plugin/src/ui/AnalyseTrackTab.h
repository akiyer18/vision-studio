#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Tab 2 — analyse uploaded / from DAW track to suggest improvements.
// Dropdown for advanced tech breakdown (Flamingo), Gemini analysis, improvements.
class AnalyseTrackTab : public Component, public ChangeListener
{
public:
    AnalyseTrackTab (PluginProcessor& p);
    ~AnalyseTrackTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       fileLabel;
    TextEditor  trackPathEditor;
    TextButton  captureButton;   // toggle: capture from DAW input
    bool        capturingUI { false };

    ToggleButton advancedButton; // "Advanced tech breakdown?" → Flamingo
    TextButton  analyseButton;
    TextButton  improvementsButton;

    ResultBox   analysisResult;
    ResultBox   improvementsResult;

    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AnalyseTrackTab)
};

} // namespace app
