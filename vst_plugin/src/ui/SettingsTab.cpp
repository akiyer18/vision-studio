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
    styleFieldHint (stabilityHint, "Used to generate audio. Get a key at platform.stability.ai.");
    addAndMakeVisible (stabilityHint);

    addAndMakeVisible (geminiKey);
    styleFieldHint (geminiHint, "Used for analysis, comparisons and references. Get a key at aistudio.google.com.");
    addAndMakeVisible (geminiHint);

    styleFieldTitle (modelLabel, "Gemini model");
    addAndMakeVisible (modelLabel);
    addAndMakeVisible (modelCombo);
    modelCombo.addItemList (geminiModelChoices(), 1);
    const ApiKeys& keys = p.getKeys();
    modelCombo.setSelectedItemIndex (geminiModelChoices().indexOf (keys.geminiModel), dontSendNotification);
    modelCombo.setEditableText (true);
    styleFieldHint (modelHint, "Model used for all Gemini analysis requests.");
    addAndMakeVisible (modelHint);

    addAndMakeVisible (hfKey);
    styleFieldHint (hfHint, "Optional. Enables Music Flamingo advanced breakdowns.");
    addAndMakeVisible (hfHint);

    addAndMakeVisible (soundchartsKey);
    styleFieldHint (soundchartsHint, "Optional. Enables artist and reference lookup.");
    addAndMakeVisible (soundchartsHint);

    // --- Export folder ---
    styleFieldTitle (folderLabel, "Export folder path");
    addAndMakeVisible (folderLabel);

    exportPathEditor.setMultiLine (false);
    exportPathEditor.setText (processor.getSettings().getExportFolder().getFullPathName(), dontSendNotification);
    addAndMakeVisible (exportPathEditor);

    styleFieldHint (exportHint, "Folder where Send to DAW writes .wav and .mid files.");
    addAndMakeVisible (exportHint);

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
    stabilityHint.setBounds (b.removeFromTop (16));
    geminiKey.setBounds (b.removeFromTop (44));
    geminiHint.setBounds (b.removeFromTop (16));

    modelLabel.setBounds (b.removeFromTop (18));
    modelCombo.setBounds (b.removeFromTop (26));
    modelHint.setBounds (b.removeFromTop (16));

    hfKey.setBounds (b.removeFromTop (44));
    hfHint.setBounds (b.removeFromTop (16));
    soundchartsKey.setBounds (b.removeFromTop (44));
    soundchartsHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (10);
    folderLabel.setBounds (b.removeFromTop (18));
    exportPathEditor.setBounds (b.removeFromTop (26));
    exportHint.setBounds (b.removeFromTop (16));
    b.removeFromTop (8);
    saveButton.setBounds (b.removeFromTop (30));
}

} // namespace app
