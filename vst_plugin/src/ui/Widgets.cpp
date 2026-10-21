#include "Widgets.h"

namespace app {

Section::Section (const String& title)
{
    titleLabel.setText (title, dontSendNotification);
    titleLabel.setFont (    Font (16.0f, Font::bold));
    titleLabel.setJustificationType (Justification::left);
    addAndMakeVisible (titleLabel);
    setSize (400, 200);
}

void Section::paint (Graphics& g)
{
    g.setColour (Colours::white.withAlpha (0.08f));
    g.fillRoundedRectangle (getLocalBounds().toFloat(), 6.0f);
    g.setColour (Colours::white.withAlpha (0.2f));
    g.drawRoundedRectangle (getLocalBounds().toFloat(), 6.0f, 1.0f);
}

void Section::resized()
{
    auto b = getLocalBounds().reduced (12);
    titleLabel.setBounds (b.removeFromTop (24));
    if (content != nullptr)
        content->setBounds (b);
}

void Section::setContent (Component* c)
{
    if (content != nullptr)
        removeChildComponent (content);
    content = c;
    if (content != nullptr)
    {
        addAndMakeVisible (content);
        resized();
    }
}

//==============================================================================
StatusBar::StatusBar()
{
    labelLabel.setFont (Font (13.0f, Font::bold));
    labelLabel.setJustificationType (Justification::left);
    addAndMakeVisible (labelLabel);

    statusLabel.setFont (Font (12.0f));
    statusLabel.setJustificationType (Justification::left);
    addAndMakeVisible (statusLabel);

    errorLabel.setFont (Font (12.0f));
    errorLabel.setJustificationType (Justification::left);
    errorLabel.setColour (Label::textColourId, Colours::red);
    addAndMakeVisible (errorLabel);

    addAndMakeVisible (progress);

    setSize (400, 110);
}

void StatusBar::setState (const JobState& s)
{
    labelLabel.setText (s.label.isEmpty() ? "Idle" : s.label, dontSendNotification);
    statusLabel.setText (s.statusText, dontSendNotification);
    errorLabel.setText (s.errorText, dontSendNotification);
    errorLabel.setVisible (s.errorText.isNotEmpty());

    if (s.running)
    {
        progress.setVisible (true);
        progressValue = (s.progress >= 0.0f) ? s.progress * 100.0 : 0.0;
    }
    else
    {
        progress.setVisible (false);
        progressValue = 0.0;
    }
    resized();
}

void StatusBar::paint (Graphics&)
{
}

void StatusBar::resized()
{
    auto b = getLocalBounds().reduced (8);
    labelLabel.setBounds (b.removeFromTop (16));
    progress.setBounds (b.removeFromTop (14));
    statusLabel.setBounds (b.removeFromTop (14));
    errorLabel.setBounds (b.removeFromTop (14));
}

//==============================================================================
KeyField::KeyField (const String& labelText, const String& initialValue)
{
    labelLabel.setText (labelText, dontSendNotification);
    labelLabel.setJustificationType (Justification::left);
    addAndMakeVisible (labelLabel);

    editor.setText (initialValue, dontSendNotification);
    editor.setPasswordCharacter ('*');
    editor.setReadOnly (false);
    editor.setMultiLine (false);
    editor.setReturnKeyStartsNewLine (false);
    editor.setColour (TextEditor::textColourId, Colours::white);
    addAndMakeVisible (editor);

    revealButton.setButtonText ("show");
    revealButton.setClickingTogglesState (true);
    revealButton.onClick = [this] { editor.setPasswordCharacter (revealButton.getToggleState() ? 0 : '*'); };
    addAndMakeVisible (revealButton);

    setSize (400, 44);
}

String KeyField::getText() const { return editor.getText(); }

void KeyField::setText (const String& text) { editor.setText (text, dontSendNotification); }

void KeyField::paint (Graphics&)
{
}

void KeyField::resized()
{
    auto b = getLocalBounds().reduced (6);
    labelLabel.setBounds (b.removeFromTop (14));
    auto row = b.removeFromTop (20);
    editor.setBounds (row.removeFromLeft (row.getWidth() - 48));
    revealButton.setBounds (row.removeFromRight (40));
}

//==============================================================================
ResultBox::ResultBox()
{
    editor.setReadOnly (true);
    editor.setMultiLine (true);
    editor.setReturnKeyStartsNewLine (true);
    editor.setScrollbarsShown (true);
    editor.setCaretVisible (false);
    editor.setColour (TextEditor::backgroundColourId, Colours::black.withAlpha (0.35f));
    editor.setColour (TextEditor::textColourId, Colours::lightgrey);
    editor.setFont (Font (12.0f));
    addAndMakeVisible (editor);
    setSize (400, 300);
}

void ResultBox::setText (const String& text)
{
    editor.setText (text, dontSendNotification);
}

void ResultBox::append (const String& text)
{
    editor.insertTextAtCaret (text);
}

void ResultBox::paint (Graphics& g)
{
    g.setColour (Colours::white.withAlpha (0.1f));
    g.drawRect (getLocalBounds(), 1.0f);
}

void ResultBox::resized()
{
    editor.setBounds (getLocalBounds().reduced (6));
}

} // namespace app
