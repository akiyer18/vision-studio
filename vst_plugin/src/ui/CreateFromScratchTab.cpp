#include "CreateFromScratchTab.h"

namespace app {

CreateFromScratchTab::CreateFromScratchTab (PluginProcessor& p) : processor (p)
{
    // --- Prompt ---
    styleFieldTitle (promptLabel, "Prompt");
    addAndMakeVisible (promptLabel);

    promptEditor.setMultiLine (true);
    promptEditor.setReturnKeyStartsNewLine (true);
    promptEditor.setScrollbarsShown (true);
    promptEditor.setText ("A mellow lo-fi hip-hop beat in the chillhop style, warm vinyl crackle, "
                          "dusty boom-bap drums, jazzy Rhodes chords, relaxed nostalgic mood.",
                          dontSendNotification);
    addAndMakeVisible (promptEditor);

    styleFieldHint (promptHint, "Describe genre, instruments, mood and tempo. Add a reference sound below to vary an existing clip.");
    addAndMakeVisible (promptHint);

    // --- Reference sound (optional) ---
    styleFieldTitle (refLabel, "Reference sound path (optional)");
    addAndMakeVisible (refLabel);

    refPathEditor.setMultiLine (false);
    refPathEditor.setText ("", dontSendNotification);
    addAndMakeVisible (refPathEditor);

    styleFieldHint (refHint, "Absolute path to an audio file. When set, the prompt becomes an audio-to-audio variation.");
    addAndMakeVisible (refHint);

    // --- Mic initiate ---
    styleFieldTitle (micLabel, "Or record mic for 7s to initiate sound");
    addAndMakeVisible (micLabel);

    recordMicButton.setButtonText ("Record mic 7s");
    recordMicButton.setClickingTogglesState (true);
    recordMicButton.onClick = [this]()
    {
        bool rec = recordMicButton.getToggleState();
        if (rec) processor.captureMicForSeconds (7);
        else     processor.stopCapture();
        recordMicButton.setButtonText (rec ? "Stop mic capture" : "Record mic 7s");
        micStatusLabel.setText (processor.getMicCaptureStatus(), dontSendNotification);
    };
    addAndMakeVisible (recordMicButton);

    micStatusLabel.setText ("Idle", dontSendNotification);
    micStatusLabel.setFont (Font (11.0f));
    micStatusLabel.setJustificationType (Justification::left);
    micStatusLabel.setColour (Label::textColourId, Colours::lightgrey);
    addAndMakeVisible (micStatusLabel);

    styleFieldTitle (bpmLabel, "BPM");
    addAndMakeVisible (bpmLabel);

    bpmEditor.setMultiLine (false);
    bpmEditor.setText ("120", dontSendNotification);
    addAndMakeVisible (bpmEditor);

    melodicToggle.setButtonText ("Melodic (off = rhythmic)");
    melodicToggle.setToggleState (true, dontSendNotification);
    addAndMakeVisible (melodicToggle);

    styleFieldHint (bpmHint, "Tempo used when creating a sound from a mic recording.");
    addAndMakeVisible (bpmHint);

    // --- Strength / duration ---
    styleFieldTitle (strengthLabel, "Noise / variation strength (high 0.95 = more variation)");
    addAndMakeVisible (strengthLabel);

    strengthSlider.setRange (0.0, 1.0, 0.05);
    strengthSlider.setValue (0.95);
    strengthSlider.setSliderStyle (Slider::LinearHorizontal);
    strengthSlider.setTextBoxStyle (Slider::TextBoxRight, false, 60, 20);
    addAndMakeVisible (strengthSlider);

    styleFieldTitle (durationLabel, "Duration (seconds)");
    addAndMakeVisible (durationLabel);

    durationEditor.setText ("30", dontSendNotification);
    durationEditor.setMultiLine (false);
    addAndMakeVisible (durationEditor);

    styleFieldHint (durationHint, "Clip length in seconds. Audio-to-audio requires 6-380 seconds.");
    addAndMakeVisible (durationHint);

    // --- Generate ---
    generateButton.setButtonText ("Generate sound");
    generateButton.onClick = [this]()
    {
        String prompt = promptEditor.getText().trim();
        double strength = strengthSlider.getValue();
        int duration = durationEditor.getText().getIntValue();
        if (duration <= 0) duration = 30;

        bool useMic = false;
        if (recordMicButton.getToggleState())
        {
            int bpm = bpmEditor.getText().getIntValue();
            if (bpm <= 0) bpm = 120;
            bool isMelodic = melodicToggle.getToggleState();
            processor.recordMicAndInitiate (strength, bpm, isMelodic);
            useMic = true;
        }

        if (! useMic)
            processor.generateFromScratch (prompt, refPathEditor.getText().trim(), strength, duration);
    };
    addAndMakeVisible (generateButton);

    // --- Playback ---
    playButton.setButtonText ("Play selected");
    playButton.onClick = [this]()
    {
        processor.setPlaying (! processor.isPlaying());
        playButton.setButtonText (processor.isPlaying() ? "Stop" : "Play selected");
    };
    addAndMakeVisible (playButton);

    sendButton.setButtonText ("Send selected to DAW");
    sendButton.onClick = [this]()
    {
        int idx = processor.getSelectedIndex();
        if (idx < 0) { resultBox.setText ("Generate a sound first."); return; }
        processor.sendToDaw (idx, true);
    };
    addAndMakeVisible (sendButton);

    // --- Results ---
    addAndMakeVisible (resultBox);
    addAndMakeVisible (statusBar);

    setSize (600, 720);

    processor.addChangeListener (this);
}

CreateFromScratchTab::~CreateFromScratchTab()
{
    processor.removeChangeListener (this);
}

void CreateFromScratchTab::updateStatus ()
{
    auto& js = processor.getJobState();
    statusBar.setState (js);

    micStatusLabel.setText (processor.getMicCaptureStatus(), dontSendNotification);
    sendButton.setEnabled (! js.running && processor.getSelectedIndex() >= 0);

    if (js.running)
    {
        generateButton.setEnabled (false);
        generateButton.setButtonText ("Generating...");
    }
    else
    {
        generateButton.setEnabled (true);
        generateButton.setButtonText ("Generate sound");
        if (js.failed)
            resultBox.setText ("Error: " + js.errorText);
        else if (js.statusText == "Done" && processor.getNumGenerated() > 0)
        {
            auto* g = processor.getSelected();
            resultBox.setText ("Generated: " + g->name + "  (" + g->source + ")"
                               + "\nDuration: " + String (g->getLengthSeconds(), 2) + " s"
                               + "\nPrompt: " + g->prompt);
        }
    }
}

void CreateFromScratchTab::paint (Graphics&)
{
}

void CreateFromScratchTab::resized()
{
    auto b = getLocalBounds().reduced (10);
    promptLabel.setBounds (b.removeFromTop (20));
    promptEditor.setBounds (b.removeFromTop (90));
    promptHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (8);
    refLabel.setBounds (b.removeFromTop (18));
    refPathEditor.setBounds (b.removeFromTop (24));
    refHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (8);
    micLabel.setBounds (b.removeFromTop (20));
    recordMicButton.setBounds (b.removeFromTop (26));
    micStatusLabel.setBounds (b.removeFromTop (18));

    auto micRow = b.removeFromTop (24);
    bpmLabel.setBounds (micRow.removeFromLeft (40));
    bpmEditor.setBounds (micRow.removeFromLeft (50));
    melodicToggle.setBounds (micRow);
    bpmHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (10);
    strengthLabel.setBounds (b.removeFromTop (18));
    strengthSlider.setBounds (b.removeFromTop (24));

    b.removeFromTop (8);
    durationLabel.setBounds (b.removeFromTop (18));
    durationEditor.setBounds (b.removeFromTop (24));
    durationHint.setBounds (b.removeFromTop (16));

    b.removeFromTop (14);
    generateButton.setBounds (b.removeFromTop (34));

    b.removeFromTop (10);
    auto actionRow = b.removeFromTop (28);
    playButton.setBounds (actionRow.removeFromLeft (150));
    actionRow.removeFromLeft (8);
    sendButton.setBounds (actionRow.removeFromLeft (200));

    b.removeFromTop (10);
    resultBox.setBounds (b.removeFromTop (100));

    b.removeFromTop (6);
    statusBar.setBounds (b.removeFromTop (80));
}

void CreateFromScratchTab::changeListenerCallback (ChangeBroadcaster*)
{
    updateStatus ();
}

} // namespace app
