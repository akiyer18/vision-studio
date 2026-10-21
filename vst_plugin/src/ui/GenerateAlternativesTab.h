#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// One alternative row: play + Gemini comparison with original.
class GenAltRow : public Component
{
public:
    GenAltRow (PluginProcessor& p, int index);
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;
    int index;
    Label       nameLabel;
    TextButton  playButton;
    TextButton  compareButton;
    ResultBox   compareResult;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GenAltRow)
};

// Tab 3 — generate alternatives (3x Stability) + per-alternative Gemini explainer.
class GenerateAlternativesTab : public Component, public ChangeListener
{
public:
    GenerateAlternativesTab (PluginProcessor& p);
    ~GenerateAlternativesTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       sourceLabel;
    TextButton  generateButton;
    ResultBox   analysisResult;
    Component   altContainer;
    Array<std::unique_ptr<GenAltRow>> altRows;

    void rebuildAltRows ();
    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GenerateAlternativesTab)
};

} // namespace app
