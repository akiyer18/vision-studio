#pragma once

#include <JuceHeader.h>

#include "core/PluginState.h"

namespace app {

// A titled box that holds a single child component.
class Section : public Component
{
public:
    Section (const String& title);
    void paint (Graphics& g) override;
    void resized() override;
    void setContent (Component* content);

private:
    Label titleLabel;
    Component* content = nullptr;
};

// Shows the current background job state (label, progress bar, status, error).
class StatusBar : public Component
{
public:
    StatusBar();
    void setState (const JobState& state);
    void paint (Graphics& g) override;
    void resized() override;

private:
    Label labelLabel;
    Label statusLabel;
    Label errorLabel;
    double progressValue { 0.0 };
    ProgressBar progress { progressValue };
};

// Label + password-capable text editor for an API key.
class KeyField : public Component
{
public:
    KeyField (const String& labelText, const String& initialValue = {});
    String getText() const;
    void setText (const String& text);
    void paint (Graphics& g) override;
    void resized() override;

private:
    Label labelLabel;
    TextEditor editor;
    ToggleButton revealButton;
};

// Read-only multiline result display.
class ResultBox : public Component
{
public:
    ResultBox();
    void setText (const String& text);
    void append (const String& text);
    void paint (Graphics& g) override;
    void resized() override;

private:
    TextEditor editor;
};

} // namespace app
