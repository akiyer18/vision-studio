#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "ui/SettingsTab.h"
#include "ui/CreateFromScratchTab.h"
#include "ui/AnalyseTrackTab.h"
#include "ui/GenerateAlternativesTab.h"
#include "ui/FindReferencesTab.h"
#include "ui/TweakSampleTab.h"
#include "ui/CarryOnTab.h"

namespace app {

// Tabbed editor for the ADE Hack VST (6 tabs per spec).
class PluginEditor : public AudioProcessorEditor
{
public:
    PluginEditor (PluginProcessor&);
    ~PluginEditor() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    TabbedComponent tabs { TabbedButtonBar::TabsAtTop };

    SettingsTab        settingsTab   { processor };
    CreateFromScratchTab createTab   { processor };
    AnalyseTrackTab    analyseTab    { processor };
    GenerateAlternativesTab altTab   { processor };
    FindReferencesTab  refsTab       { processor };
    TweakSampleTab     tweakTab      { processor };
    CarryOnTab         carryOnTab    { processor };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginEditor)
};

} // namespace app
