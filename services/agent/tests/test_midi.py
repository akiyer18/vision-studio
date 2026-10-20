from agent.theory import VELOCITY, bass_midi, chords_midi, midi_span, note_ons, root_near, voice_chord


def test_close_voicing_sits_around_middle_c() -> None:
    assert voice_chord("C") == [60, 64, 67]
    assert voice_chord("Dm") == [62, 65, 69]
    assert voice_chord("Bb") == [58, 62, 65]
    assert voice_chord("Am") == [57, 60, 64]
    assert voice_chord("Cmaj7") == [60, 64, 67, 71]
    assert voice_chord("Fmaj7") == [65, 69, 72, 76]
    assert all(abs(sum(notes) / len(notes) - 60) <= 12 for notes in (voice_chord("C"), voice_chord("Fmaj7")))


def test_bass_roots_sit_around_c2() -> None:
    assert root_near("D") == 38
    assert root_near("Bb") == 34
    assert root_near("F") == 41
    assert root_near("C") == 36
    assert all(abs(root_near(name) - 36) <= 7 for name in ("C", "D", "F", "Bb"))


def test_midi_files_hold_one_chord_per_bar_at_the_brief_tempo() -> None:
    chords = ["Dm", "Bb", "F", "C"]
    chord_file = chords_midi(chords, bpm=76, bars=8)
    bass_file = bass_midi(chords, bpm=76, bars=8)
    assert midi_span(chord_file) == (round(60_000_000 / 76), 8 * 4 * 480)
    assert midi_span(bass_file) == (round(60_000_000 / 76), 8 * 4 * 480)

    chord_notes = note_ons(chord_file)
    assert [(pitch, velocity) for tick, pitch, velocity in chord_notes if tick == 0] == [
        (62, VELOCITY),
        (65, VELOCITY),
        (69, VELOCITY),
    ]
    assert [pitch for tick, pitch, _velocity in chord_notes if tick == 1920] == [58, 62, 65]
    assert all(80 <= velocity <= 100 for _tick, _pitch, velocity in chord_notes)

    bass_notes = note_ons(bass_file)
    assert [pitch for _tick, pitch, _velocity in bass_notes] == [38, 34, 41, 36, 38, 34, 41, 36]
    assert [tick for tick, _pitch, _velocity in bass_notes] == [index * 1920 for index in range(8)]
