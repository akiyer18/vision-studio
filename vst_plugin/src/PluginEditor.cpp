#include "PluginEditor.h"

namespace app {

PluginEditor::PluginEditor (PluginProcessor& p)
    : AudioProcessorEditor (&p), processor (p)
{
    tabs.addTab ("Settings",          Colours::white, &settingsTab,   false);
    tabs.addTab ("Create from scratch", Colours::white, &createTab,   false);
    tabs.addTab ("Analyse track",     Colours::white, &analyseTab,    false);
    tabs.addTab ("Generate alternatives", Colours::white, &altTab,    false);
    tabs.addTab ("Find references",   Colours::white, &refsTab,       false);
    tabs.addTab ("Tweak sample",      Colours::white, &tweakTab,      false);
    tabs.addTab ("Carry on",          Colours::white, &carryOnTab,    false);

    addAndMakeVisible (tabs);

    setSize (720, 820);
}

PluginEditor::~PluginEditor()
{
}

void PluginEditor::paint (Graphics& g)
{
    g.fillAll (Colours::black);
}

void PluginEditor::resized()
{
    tabs.setBounds (getLocalBounds());
}

} // namespace app
