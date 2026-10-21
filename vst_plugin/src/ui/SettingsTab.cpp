#include "SettingsTab.h"

namespace app {

SettingsTab::SettingsTab (PluginProcessor& p)
    : processor (p),
      stabilityKey  ("Stability AI API key", p.getKeys().stability),
      geminiKey     ("Gemini API key",       p.getKeys().gemini),
      hfKey         ("Hugging Face token (Flamingo advanced)", p.getKeys().huggingFace),
      soundchartsKey("Soundcharts API key (optional)", p.getKeys().soundcharts)
{
    // --- Keys ---
    addAndMakeVisible (stabilityKey);
    addAndMakeVisible (geminiKey);

    addAndMakeVisible (modelCombo);
    modelCombo.addItemList (geminiModelChoices(), 1);
    const ApiKeys& keys = p.getKeys();
    modelCombo.setSelectedItemIndex (geminiModelChoices().indexOf (keys.geminiModel), dontSendNotification);
    modelCombo.setEditableText (true);

    addAndMakeVisible (hfKey);
    addAndMakeVisible (soundchartsKey);

    // --- Export folder ---
    folderLabel.setText ("Export folder path", dontSendNotification);
    folderLabel.setFont (Font (12.0f));
    folderLabel.setJustificationType (Justification::left);
    folderLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (folderLabel);

    exportPathEditor.setMultiLine (false);
    exportPathEditor.setText (processor.getSettings().getExportFolder().getFullPathName(), dontSendNotification);
    addAndMakeVisible (exportPathEditor);

    saveButton.setButtonText ("Save settings");
    saveButton.onClick = [this]()
    {
        ApiKeys k;
        k.stability   = stabilityKey.getText();
        k.gemini      = geminiKey.getText();
        k.geminiModel = modelCombo.getText().isNotEmpty() ? modelCombo.getText()
                                                          : "gemini-2.5-flash";
        k.huggingFace = hfKey.getText();
        k.soundcharts = soundchartsKey.getText();
        processor.getSettings().setExportFolder (exportPathEditor.getText().trim());
        processor.setKeys (k);
        saveButton.setButtonText ("Saved!");
        saveButton.setEnabled (false);
        Timer::callAfterDelay (1200, [this]()
        {
            saveButton.setButtonText ("Save settings");
            saveButton.setEnabled (true);
        });
    };
    addAndMakeVisible (saveButton);

    setSize (520, 420);
}

void SettingsTab::paint (Graphics&)
{
}

void SettingsTab::resized()
{
    auto b = getLocalBounds().reduced (10);
    stabilityKey.setBounds (b.removeFromTop (44));
    geminiKey.setBounds  (b.removeFromTop (44));
    modelCombo.setBounds (b.removeFromTop (28));
    hfKey.setBounds      (b.removeFromTop (44));
    soundchartsKey.setBounds (b.removeFromTop (44));

    b.removeFromTop (10);
    exportPathEditor.setBounds (b.removeFromTop (26));
    folderLabel.setBounds        (b.removeFromTop (34));
    b.removeFromTop (8);
    saveButton.setBounds (b.removeFromTop (30));
}

} // namespace app
