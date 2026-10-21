#include "MidiDissector.h"
#include "PitchOnset.h"

namespace app {

namespace
{
    const int kTicksPerQuarter = 960;

    double secToTicks (double sec, double bpm, int tpq)
    {
        if (bpm <= 0) bpm = 120.0;
        return sec * bpm * (double) tpq / 60.0;
    }

    int strengthToDrumNote (double strength, double onsetIndex)
    {
        // Simple heuristic: strong onsets -> kick, medium -> snare, weak -> hat.
        if (strength > 0.6) return 36;  // kick
        if (strength > 0.3) return 38;  // snare
        return 42;                       // closed hat
    }
}

int MidiDissector::quantisePitch (double midi)
{
    int rounded = (int) std::round (midi);
    return jlimit (21, 108, rounded);
}

int MidiDissector::classifyPitch (double freqHz)
{
    if (freqHz <= 0) return -1;
    if (freqHz < 200.0)  return ChannelBass;
    if (freqHz < 1000.0) return ChannelChords;
    return ChannelLead;
}

void MidiDissector::addNote (MidiMessageSequence& seq, int channel,
                             double onsetSec, double durationSec, int pitch, int velocity,
                             double bpm, int tpq)
{
    if (pitch < 21 || pitch > 108)
        return;

    auto on  = MidiMessage::noteOn  (channel, pitch, (float) jlimit (0.0, 1.0, velocity / 127.0));
    auto off = MidiMessage::noteOff (channel, pitch);

    seq.addEvent (on,  secToTicks (onsetSec, bpm, tpq));
    seq.addEvent (off, secToTicks (onsetSec + jmax (0.05, durationSec), bpm, tpq));
}

DissectedTracks MidiDissector::dissect (const GeneratedAudio& audio)
{
    DissectedTracks out;

    if (audio.buffer.getNumSamples() == 0)
        return out;

    PitchOnsetDetector detector;
    detector.analyse (audio.buffer, audio.sampleRate);

    const double bpm = detector.getTempoBpm() > 0 ? detector.getTempoBpm() : 120.0;
    out.tempoBpm = bpm;

    const auto& notes  = detector.getNotes();
    const auto& onsets = detector.getOnsets();

    // Pitched material -> bass / chords / lead
    for (auto& n : notes)
    {
        int channel = classifyPitch (n.freqHz);
        int pitch   = quantisePitch (n.midi);
        int vel     = (int) jlimit (40.0, 120.0, n.velocity * 127.0);

        if (channel == ChannelBass)
            addNote (out.bass,   ChannelBass,   n.onsetSec, n.durationSec, pitch, vel, bpm, kTicksPerQuarter);
        else if (channel == ChannelChords)
            addNote (out.chords, ChannelChords, n.onsetSec, n.durationSec, pitch, vel, bpm, kTicksPerQuarter);
        else if (channel == ChannelLead)
            addNote (out.lead,   ChannelLead,   n.onsetSec, n.durationSec, pitch, vel, bpm, kTicksPerQuarter);
    }

    // Percussive onsets -> drum channel
    int idx = 0;
    for (auto& o : onsets)
    {
        int drumNote = strengthToDrumNote (o.strength, idx);
        addNote (out.drums, ChannelDrums, o.timeSec, 0.08, drumNote,
                 (int) jlimit (50.0, 120.0, o.strength * 127.0), bpm, kTicksPerQuarter);
        ++idx;
    }

    out.drums.updateMatchedPairs();
    out.bass.updateMatchedPairs();
    out.chords.updateMatchedPairs();
    out.lead.updateMatchedPairs();

    return out;
}

bool MidiDissector::writeMidiFile (const DissectedTracks& tracks, const File& file)
{
    MidiFile mf;
    mf.setTicksPerQuarterNote (kTicksPerQuarter);
    mf.addTrack (tracks.drums);
    mf.addTrack (tracks.bass);
    mf.addTrack (tracks.chords);
    mf.addTrack (tracks.lead);

    file.getParentDirectory().createDirectory();
    FileOutputStream fos (file);
    if (! fos.openedOk())
        return false;

    fos.setPosition (0);
    mf.writeTo (fos);
    return true;
}

MidiBuffer MidiDissector::toBuffer (const DissectedTracks& tracks)
{
    MidiBuffer buf;
    auto append = [&buf] (const MidiMessageSequence& seq)
    {
        for (int i = 0; i < seq.getNumEvents(); ++i)
        {
            auto* e = seq.getEventPointer (i);
            buf.addEvent (e->message, (int) e->message.getTimeStamp());
        }
    };

    append (tracks.drums);
    append (tracks.bass);
    append (tracks.chords);
    append (tracks.lead);

    return buf;
}

} // namespace app
