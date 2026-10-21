# ADEHack — Live 10 Remote Script (TCP 127.0.0.1:9004, newline-delimited JSON)

Install: `./ableton/install.sh`, restart Live, Preferences > Link/MIDI > Control Surface > "ADEHack" (In/Out: None).
Test: `printf '{"cmd":"ping"}\n' | nc 127.0.0.1 9004` (or `node ableton/client.js ping`). Log: `~/Library/Preferences/Ableton/Live 10.*/Log.txt` (grep ADEHack).

Commands: `ping`, `set_tempo {bpm}`, `create_clip {track:"selected"|int, slot?, length, notes|pattern, mapping, singleNote, name?, fire?}`, `load_sample {path, track?}`.
Replies: one JSON line, `{"ok":true,...}` or `{"ok":false,"error":"..."}`.

Live API used: `ControlSurface.schedule_message(1, cb)` (100 ms tick, no threads), `self.song().tempo/tracks/view.selected_track`,
`track.has_midi_input`, `track.clip_slots[i].has_clip/delete_clip()/create_clip(len)/clip/fire()`,
`clip.set_notes(((pitch,start,dur,vel,mute),...))` (fallback `select_all_notes()+replace_selected_notes()`), `clip.name`, `clip.looping`,
`Live.Application.get_application().browser.user_library` (walk `.children/.name/.is_loadable/.uri`) and `browser.load_item(item)`.

Uncertainties: Live 10.1 has `browser.load_item` and `Clip.set_notes`; `Clip.add_new_notes` is Live 11 only (not used).
`set_notes` on an empty clip adds notes in 10.x; if it ever errors we fall back to `replace_selected_notes`. `load_item` targets the
selected track; browser items in User Library show names without `.wav`, so we match both the basename and its stem.
Pattern conversion: start = step*0.25 (+swing*0.5*0.25 on odd steps), duration 0.125, length = bars*4; GM map matches lib/pattern.js.
