#pragma once

#include <JuceHeader.h>

namespace app {

struct NoteEvent
{
    double onsetSec    { 0.0 };
    double durationSec { 0.0 };
    double freqHz      { 0.0 };
    double midi        { 0.0 };   // 0 if unknown
    double velocity    { 0.0 };   // 0..1
    bool   percussive  { false };
};

struct OnsetEvent
{
    double timeSec  { 0.0 };
    double strength { 0.0 };
};

// Lightweight built-in pitch + onset detector.
//   * pitch: autocorrelation (FFT-based) per frame
//   * onset: spectral flux peak picking
// Good enough for monophonic/melodic material; polyphonic lo-fi beats are
// approximated (see README limitations).
class PitchOnsetDetector
{
public:
    PitchOnsetDetector (int fftOrder = 11 /*2048*/, int hopSize = 512);

    void analyse (const AudioBuffer<float>& buffer, double sampleRate);

    const Array<NoteEvent>&  getNotes()  const { return notes; }
    const Array<OnsetEvent>& getOnsets() const { return onsets; }
    double                   getTempoBpm() const { return tempoBpm; }

private:
    double detectPitch (const float* frame, double sampleRate);

    int fftOrder;
    int hopSize;
    int fftSize;

    Array<NoteEvent>  notes;
    Array<OnsetEvent> onsets;
    double            tempoBpm { 0.0 };
};

} // namespace app
