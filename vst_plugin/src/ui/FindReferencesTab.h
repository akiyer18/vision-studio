#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Tab 4 — analyse genre history, suggest artists to listen to as reference (Soundcharts).
// Includes popularity ranking, geolocation, and recent trends.
class FindReferencesTab : public Component, public ChangeListener
{
public:
    FindReferencesTab (PluginProcessor& p);
    ~FindReferencesTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       queryLabel;
    TextEditor  queryEditor;
    TextButton  findButton;
    ResultBox   resultBox;
    StatusBar   statusBar;

    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FindReferencesTab)
};

} // namespace app
