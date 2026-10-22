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
    Label    stabilityHint;
    KeyField geminiKey;
    Label    geminiHint;
    Label    modelLabel;
    ComboBox modelCombo;
    Label    modelHint;
    KeyField hfKey;
    Label    hfHint;
    KeyField soundchartsKey;
    Label    soundchartsHint;

    Label       folderLabel;
    TextEditor  exportPathEditor;
    Label       exportHint;
    TextButton  saveButton;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SettingsTab)
};

} // namespace app
