#include "GenerateAlternativesTab.h"

namespace app {

GenAltRow::GenAltRow (PluginProcessor& p, int idx)
    : processor (p), index (idx)
{
    auto* g = processor.getGenerated()[index];
    nameLabel.setText (g->name.isNotEmpty() ? g->name : ("Alternative " + String (index + 1)),
                       dontSendNotification);
    nameLabel.setFont (Font (13.0f, Font::bold));
    addAndMakeVisible (nameLabel);

    playButton.setButtonText ("Play");
    playButton.onClick = [this]() { processor.setSelectedIndex (index); processor.setPlaying (true); };
    addAndMakeVisible (playButton);

    compareButton.setButtonText ("Compare with original");
    compareButton.onClick = [this]() { processor.compareAlternative (index); };
    addAndMakeVisible (compareButton);

    addAndMakeVisible (compareResult);

    setSize (520, 150);
}

void GenAltRow::paint (Graphics& g)
{
    g.setColour (Colours::white.withAlpha (0.06f));
    g.fillRoundedRectangle (getLocalBounds().toFloat(), 5.0f);
}

void GenAltRow::resized()
{
    auto b = getLocalBounds().reduced (8);
    nameLabel.setBounds (b.removeFromLeft (180));
    playButton.setBounds (b.removeFromLeft (70));
    compareButton.setBounds (b.removeFromLeft (150));
    compareResult.setBounds (b);
}

//==============================================================================
GenerateAlternativesTab::GenerateAlternativesTab (PluginProcessor& p) : processor (p)
{
    addAndMakeVisible (altContainer);

    sourceLabel.setText ("No track analysed yet", dontSendNotification);
    sourceLabel.setFont (Font (13.0f, Font::bold));
    sourceLabel.setJustificationType (Justification::left);
    sourceLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (sourceLabel);

    generateButton.setButtonText ("Generate 3 alternatives (Stability)");
    generateButton.onClick = [this]() { processor.generateAlternatives(); };
    addAndMakeVisible (generateButton);

    addAndMakeVisible (analysisResult);

    setSize (640, 700);

    processor.addChangeListener (this);
}

GenerateAlternativesTab::~GenerateAlternativesTab()
{
    processor.removeChangeListener (this);
}

void GenerateAlternativesTab::rebuildAltRows ()
{
    altContainer.removeAllChildren();
    altRows.clear();

    for (int i = 0; i < processor.getNumGenerated(); ++i)
    {
        auto* g = processor.getGenerated()[i];
        if (g->source != "variation")
            continue;

        auto rowComp = std::make_unique<GenAltRow> (processor, i);
        altContainer.addAndMakeVisible (rowComp.get());
        altRows.add (std::move (rowComp));
    }

    resized();
}

void GenerateAlternativesTab::updateStatus ()
{
    auto& js = processor.getJobState();
    generateButton.setEnabled (! js.running);

    if (processor.hasAnalysedAudio())
        sourceLabel.setText ("Source: " + processor.getAnalysisPath().isNotEmpty()
                             ? File (processor.getAnalysisPath()).getFileName()
                             : "captured audio", dontSendNotification);
    else
        sourceLabel.setText ("No track analysed yet", dontSendNotification);

    if (! processor.getAnalysisText().isEmpty())
        analysisResult.setText (processor.getAnalysisText());
    else
        analysisResult.setText ("Analyse a track first, then generate alternatives.", dontSendNotification);

    rebuildAltRows ();
}

void GenerateAlternativesTab::paint (Graphics&)
{
}

void GenerateAlternativesTab::resized()
{
    auto b = getLocalBounds().reduced (10);

    sourceLabel.setBounds (b.removeFromTop (22));
    generateButton.setBounds (b.removeFromTop (30));

    b.removeFromTop (10);
    analysisResult.setBounds (b.removeFromTop (120));

    b.removeFromTop (8);
    altContainer.setBounds (b);
    rebuildAltRows ();
}

void GenerateAlternativesTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
