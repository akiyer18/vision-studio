#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "Widgets.h"

namespace app {

// Tab 6 — carry on: generates how the track can develop (text ideas only, no artifact rebuild).
class CarryOnTab : public Component, public ChangeListener
{
public:
    CarryOnTab (PluginProcessor& p);
    ~CarryOnTab() override;
    void paint (Graphics& g) override;
    void resized() override;

private:
    PluginProcessor& processor;

    Label       sourceLabel;
    TextButton  carryOnButton;
    ResultBox   resultBox;
    StatusBar   statusBar;

    void updateStatus ();

    void changeListenerCallback (ChangeBroadcaster*) override;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CarryOnTab)
};

} // namespace app
