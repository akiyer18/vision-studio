#include "FindReferencesTab.h"

namespace app {

FindReferencesTab::FindReferencesTab (PluginProcessor& p) : processor (p)
{
    styleFieldTitle (queryLabel, "Genre / artist query");
    addAndMakeVisible (queryLabel);

    queryEditor.setMultiLine (false);
    queryEditor.setText ("lo-fi hip hop", dontSendNotification);
    queryEditor.setColour (TextEditor::textColourId, Colours::white);
    addAndMakeVisible (queryEditor);

    styleFieldHint (queryHint, "Genre, era or artist to research. Adds genre history, popular artists, geolocation and recent trends.");
    addAndMakeVisible (queryHint);

    findButton.setButtonText ("Find references (genre history + artists)");
    findButton.onClick = [this]() { processor.findReferences (queryEditor.getText().trim()); };
    addAndMakeVisible (findButton);

    addAndMakeVisible (resultBox);
    addAndMakeVisible (statusBar);

    setSize (640, 600);

    processor.addChangeListener (this);
}

FindReferencesTab::~FindReferencesTab()
{
    processor.removeChangeListener (this);
}

void FindReferencesTab::updateStatus ()
{
    auto& js = processor.getJobState();
    statusBar.setState (js);

    findButton.setEnabled (! js.running);

    if (! processor.getReferencesText().isEmpty())
        resultBox.setText (processor.getReferencesText());
    else
        resultBox.setText ("Enter a genre/artist and click Find references.");
}

void FindReferencesTab::paint (Graphics&)
{
}

void FindReferencesTab::resized()
{
    auto b = getLocalBounds().reduced (10);

    queryLabel.setBounds (b.removeFromTop (20));
    queryEditor.setBounds (b.removeFromTop (26));
    queryHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (10);
    findButton.setBounds (b.removeFromTop (34));

    b.removeFromTop (10);
    resultBox.setBounds (b.removeFromTop (320));

    b.removeFromTop (6);
    statusBar.setBounds (b.removeFromTop (90));
}

void FindReferencesTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
