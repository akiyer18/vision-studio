"""Train mode: templates, variations, comparison, and grounded feedback."""

from dataclasses import replace

from agent.compare import compare_midi
from agent.exercise_midi import write_midi
from agent.exercises import a_minor_pitch, load_exercises, vary
from agent.theory import _midi
from agent.train_feedback import grounded, write_feedback

_EN = "\u2013"
_PROMPTS = {
    "rhythm-drums-beginner": "Create a 4-bar drum loop at 100 BPM. Kick on beats 1 and 3, snare on beats 2 and 4, with steady eighth-note hi-hats. Keep the pattern simple and consistent.",
    "rhythm-drums-intermediate": "Create a 4-bar drum loop at 100 BPM. Use a syncopated kick pattern, snare on beats 2 and 4, and sixteenth-note hi-hats with a few open hi-hats and velocity variations. Add one simple fill at the end of bar 4.",
    "rhythm-drums-advanced": "Create a 4-bar drum loop at 100 BPM with a complex syncopated kick pattern, ghost notes around the main snare hits, varied sixteenth-note hi-hats with velocity and rhythmic variations, and a more detailed fill leading out of bar 4. Keep the groove musical rather than overly busy.",
    "rhythm-bass-beginner": "Create a 4-bar drum and bass loop at 100 BPM in A minor. Use a simple drum pattern with kick on beats 1 and 3, snare on beats 2 and 4, and steady eighth-note hi-hats. Add a simple bass line using root notes from A minor that follows the kick rhythm. Keep it repetitive and easy to identify by ear.",
    "rhythm-bass-intermediate": "Create a 4-bar drum and bass loop at 100 BPM in A minor. Use a syncopated kick pattern, snare on beats 2 and 4, and sixteenth-note hi-hats with some velocity variation. Add a bass line using notes from A minor that locks in with the kick but includes syncopation and rhythmic variation. Add a small variation in bar 4.",
    "rhythm-bass-advanced": "Create a 4-bar drum and bass loop at 100 BPM in A minor. Build a more complex groove with a syncopated kick, snare and ghost notes, and varied sixteenth-note hi-hats. Add an independent bass line in A minor using syncopation, rests, octave movement and rhythmic variation. Let the bass interact with the drums rather than simply following the kick, with a turnaround in bar 4.",
    "harmony-beginner": f"Create a 4-bar chord progression at 100 BPM in C major using the Roman numeral progression I {_EN} V {_EN} vi {_EN} IV, with one chord per bar. Use simple root-position triads with no inversions, extensions, additional melodies, bass, or drums. Keep the rhythm simple and sustained so each chord is clearly identifiable.",
    "harmony-intermediate": f"Create a 4-bar chord progression at 100 BPM in C major using I {_EN} V {_EN} vi {_EN} IV, with one chord per bar. Use chord inversions to create smooth voice leading, keeping common tones where possible and minimizing large jumps between voices. Use triads only, with no additional melodies, bass, or drums. Keep the rhythm simple so the differences in chord voicing are easy to hear and identify.",
    "harmony-advanced": f"Create a 4-bar chord progression at 100 BPM in E-flat major using vi {_EN} IV {_EN} I {_EN} V, with one chord per bar. Use inversions, smooth voice leading, and tasteful extended voicings with added color tones such as 7ths or 9ths. Keep the harmonic function of each chord clear while creating a more sophisticated progression. No additional melodies, bass, or drums.",
}
_TRIADS = {
    "C": {0, 4, 7},
    "G": {7, 11, 2},
    "Am": {9, 0, 4},
    "F": {5, 9, 0},
    "Cm": {0, 3, 7},
    "Ab": {8, 0, 3},
    "Eb": {3, 7, 10},
    "Bb": {10, 2, 5},
}
_SECTIONS = ("right", "differs", "improve", "next")


def test_templates_load_the_spec() -> None:
    templates = load_exercises()

    assert set(templates) == set(_PROMPTS)
    for name, prompt in _PROMPTS.items():
        exercise = templates[name]
        assert exercise.prompt == prompt
        assert exercise.tempo == 100
        assert exercise.bars == 4
        assert "Logic" in exercise.instructions
        assert "cannot see your Logic session" in exercise.instructions

    beginner = templates["harmony-beginner"]
    assert beginner.key == "C major"
    assert [chord.symbol for chord in beginner.chords] == ["C", "G", "Am", "F"]
    assert all(chord.inversion == 0 and chord.extensions == () and len(chord.notes) == 3 for chord in beginner.chords)
    for chord, root in zip(beginner.chords, (0, 7, 9, 5), strict=True):
        assert min(chord.notes) % 12 == root
        assert {note % 12 for note in chord.notes} == _TRIADS[chord.symbol]

    advanced = templates["harmony-advanced"]
    assert advanced.key == "Eb major"
    assert [chord.symbol for chord in advanced.chords] == ["Cm", "Ab", "Eb", "Bb"]
    assert all(chord.extensions for chord in advanced.chords)
    for chord in advanced.chords:
        assert _TRIADS[chord.symbol] <= {note % 12 for note in chord.notes}

    drums = templates["rhythm-drums-beginner"]
    assert {(hit.bar, hit.step) for hit in drums.hits if hit.drum == "kick"} == {(bar, step) for bar in range(1, 5) for step in (0, 8)}
    assert {hit.step for hit in drums.hits if hit.drum == "snare"} == {4, 12}
    assert all(hit.drum != "open_hat" for hit in drums.hits)

    intermediate = templates["rhythm-drums-intermediate"]
    kicks = [hit.step for hit in intermediate.hits if hit.bar == 1 and hit.drum == "kick"]
    assert any(step % 4 for step in kicks)


def test_randomizer_stays_inside_the_level() -> None:
    templates = load_exercises()
    harmony = templates["harmony-beginner"]
    octaves = set()
    for seed in range(8):
        rolled = vary(harmony, seed)
        assert rolled.tempo == 100 and rolled.bars == 4
        assert [chord.symbol for chord in rolled.chords] == ["C", "G", "Am", "F"]
        assert all(chord.inversion == 0 and not chord.extensions and len(chord.notes) == 3 for chord in rolled.chords)
        for chord, root in zip(rolled.chords, (0, 7, 9, 5), strict=True):
            assert min(chord.notes) % 12 == root
            assert {note % 12 for note in chord.notes} == _TRIADS[chord.symbol]
        octaves.add(rolled.chords[0].notes[0])
    assert len(octaves) > 1

    advanced = templates["harmony-advanced"]
    for seed in range(6):
        rolled = vary(advanced, seed)
        assert rolled.key == "Eb major" and rolled.tempo == 100
        assert [chord.symbol for chord in rolled.chords] == ["Cm", "Ab", "Eb", "Bb"]
        assert all(chord.extensions for chord in rolled.chords)
        for chord in rolled.chords:
            assert _TRIADS[chord.symbol] <= {note % 12 for note in chord.notes}

    patterns = set()
    for seed in range(8):
        rolled = vary(templates["rhythm-drums-intermediate"], seed)
        assert rolled.tempo == 100 and rolled.bars == 4
        for bar in range(1, 4):
            kicks = [hit.step for hit in rolled.hits if hit.bar == bar and hit.drum == "kick"]
            assert any(step % 4 for step in kicks)
            snares = sorted(hit.step for hit in rolled.hits if hit.bar == bar and hit.drum == "snare")
            assert snares == [4, 12]
            hats = {hit.step for hit in rolled.hits if hit.bar == bar and hit.drum in {"hat", "open_hat"}}
            assert hats == set(range(16))
        fill = {hit.step for hit in rolled.hits if hit.bar == 4 and hit.drum == "snare"}
        assert {12, 13, 14, 15} <= fill
        assert any(hit.drum == "open_hat" for hit in rolled.hits)
        patterns.add(tuple(sorted(hit.step for hit in rolled.hits if hit.bar == 1 and hit.drum == "kick")))
    assert len(patterns) > 1

    for seed in range(4):
        rolled = vary(templates["rhythm-drums-advanced"], seed)
        ghosts = [hit for hit in rolled.hits if hit.drum == "snare" and hit.velocity < 50]
        mains = {(hit.bar, hit.step) for hit in rolled.hits if hit.drum == "snare" and hit.velocity >= 50}
        assert ghosts
        assert any(any(ghost.bar == bar and abs(ghost.step - step) == 1 for bar, step in mains) for ghost in ghosts)
        assert any(hit.step % 4 for hit in rolled.hits if hit.bar == 1 and hit.drum == "kick")

    for seed in range(4):
        rolled = vary(templates["rhythm-bass-beginner"], seed)
        assert all(note.pitch % 12 == 9 for note in rolled.bass)
        kick_steps = {(hit.bar, hit.step) for hit in rolled.hits if hit.drum == "kick"}
        assert {(note.bar, note.start) for note in rolled.bass} == kick_steps

    for seed in range(4):
        rolled = vary(templates["rhythm-bass-intermediate"], seed)
        assert all(a_minor_pitch(note.pitch) for note in rolled.bass)
        bar1 = {note.start for note in rolled.bass if note.bar == 1}
        kicks = {hit.step for hit in rolled.hits if hit.bar == 1 and hit.drum == "kick"}
        assert bar1 & kicks
        assert bar1 - kicks
        assert bar1 != {note.start for note in rolled.bass if note.bar == 4}

    for seed in range(4):
        rolled = vary(templates["rhythm-bass-advanced"], seed)
        assert all(a_minor_pitch(note.pitch) for note in rolled.bass)
        by_class: dict[int, set[int]] = {}
        for note in rolled.bass:
            by_class.setdefault(note.pitch % 12, set()).add(note.pitch)
        assert any(max(pitches) - min(pitches) >= 12 for pitches in by_class.values())
        bar1 = {note.start for note in rolled.bass if note.bar == 1}
        kicks = {hit.step for hit in rolled.hits if hit.bar == 1 and hit.drum == "kick"}
        assert 0 not in bar1
        assert bar1 != kicks
        assert len([note for note in rolled.bass if note.bar == 4]) > len([note for note in rolled.bass if note.bar == 1])


def test_missing_kick_on_beat_3_of_bar_2() -> None:
    exercise = vary(load_exercises()["rhythm-drums-beginner"], 2)
    result = compare_midi(exercise, write_midi(exercise, skip=(2, 8, "kick")))

    assert result["source"] == "midi"
    assert result["approximate"] is False
    missing = [item for item in result["missing"] if item["what"] == "kick" and item["bar"] == 2 and item["beat"] == 3]
    assert missing
    assert missing[0]["step"] == 8
    feedback = write_feedback(result, exercise)
    assert grounded({key: str(feedback[key]) for key in _SECTIONS}, result)
    assert all(feedback[key] for key in _SECTIONS)
    assert feedback["stars"] in {1, 2, 3}


def test_harmony_progression_can_match_with_different_inversions() -> None:
    exercise = load_exercises()["harmony-beginner"]
    voiced = (
        ((64, 67, 72), 1),
        ((71, 74, 79), 1),
        ((72, 76, 81), 1),
        ((69, 72, 77), 1),
    )
    chords = tuple(
        replace(chord, notes=notes, inversion=inversion) for chord, (notes, inversion) in zip(exercise.chords, voiced, strict=True)
    )
    result = compare_midi(exercise, write_midi(replace(exercise, chords=chords)))

    assert result["progression_correct"] is True
    assert result["scores"]["progression"] == 1
    assert result["voicing_similarity"] < 1
    assert any(item["what"] == "inversion" for item in result["differences"])


def test_feedback_rejects_an_invented_bar() -> None:
    exercise = vary(load_exercises()["rhythm-drums-beginner"], 1)
    result = compare_midi(exercise, write_midi(exercise, skip=(2, 8, "kick")))
    invented = {
        "right": "The groove is close.",
        "differs": "The kick in bar 9 is missing.",
        "improve": "Listen again.",
        "next": "Stay with this exercise.",
    }

    assert grounded(invented, result) is False
    feedback = write_feedback(result, exercise, lambda _result, _exercise: invented)
    text = " ".join(str(feedback[key]) for key in _SECTIONS)
    assert "bar 9" not in text
    assert feedback["source"] == "template"
    assert feedback["stars"] in {1, 2, 3}


def test_uncertain_audio_events_are_not_stated_as_facts() -> None:
    exercise = load_exercises()["rhythm-drums-beginner"]
    result = {
        "source": "audio",
        "approximate": True,
        "matches": [],
        "differences": [],
        "missing": [],
        "uncertain": [{"bar": 2, "beat": 3, "step": 8, "what": "kick", "confidence": 0.3}],
        "scores": {"hits": 0.4},
    }

    feedback = write_feedback(result, exercise)
    text = " ".join(str(feedback[key]) for key in _SECTIONS)
    assert result["approximate"] is True
    assert "estimate" in text.lower()
    assert "bar 2" not in text
    assert "beat 3" not in text


def test_unknown_drum_pitch_asks_for_a_mapping() -> None:
    exercise = load_exercises()["rhythm-drums-beginner"]
    tempo = round(60_000_000 / 100).to_bytes(3, "big")
    data = _midi(
        [
            (0, b"\xff\x51\x03" + tempo),
            (0, bytes((0x90, 51, 100))),
            (120, bytes((0x80, 51, 0))),
        ]
    )

    assert compare_midi(exercise, data)["status"] == "needs_mapping"
    assert 51 in compare_midi(exercise, data)["notes"]
    assert compare_midi(exercise, data, {51: "kick"})["status"] == "compared"
