#pragma once

#include <JuceHeader.h>
#include "../core/PluginState.h"

namespace app {

// The dissected MIDI tracks derived from one piece of audio.
struct DissectedTracks
{
    MidiMessageSequence drums;    // ChannelDrums
    MidiMessageSequence bass;     // ChannelBass
    MidiMessageSequence chords;   // ChannelChords
    MidiMessageSequence lead;     // ChannelLead
    double              tempoBpm  { 0.0 };
};

// Turns generated audio into MIDI tracks (pitch/onset based) that can be
// written to a .mid file and/or emitted live to the DAW.
class MidiDissector
{
public:
    DissectedTracks dissect (const GeneratedAudio& audio);

    // Write all tracks to a standard MIDI file.
    bool writeMidiFile (const DissectedTracks& tracks, const File& file);

    // Convert tracks into a single MidiBuffer (for live emission).
    MidiBuffer toBuffer (const DissectedTracks& tracks);

private:
    static void addNote (MidiMessageSequence& seq, int channel,
                         double onsetSec, double durationSec, int pitch, int velocity,
                         double bpm, int tpq);
    static int  classifyPitch (double freqHz);
    static int  quantisePitch (double midi);
};

} // namespace app
