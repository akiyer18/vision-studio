#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Settings tab: API keys, Gemini model, export folder.
class SettingsTab : public Component
{
public:
    SettingsTab (PluginProcessor& p);
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    KeyField stabilityKey;
    KeyField geminiKey;
    ComboBox   modelCombo;
    KeyField hfKey;
    KeyField soundchartsKey;

    Label       folderLabel;
    TextEditor  exportPathEditor;
    TextButton  saveButton;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SettingsTab)
};

} // namespace app
