# ADEHack — Live 10 Remote Script (TCP 127.0.0.1:9004, newline-delimited JSON)

Install: `./ableton/install.sh`, restart Live, Preferences > Link/MIDI > Control Surface > "ADEHack" (In/Out: None).
Test: `printf '{"cmd":"ping"}\n' | nc 127.0.0.1 9004` (or `node ableton/client.js ping`). Log: `~/Library/Preferences/Ableton/Live 10.*/Log.txt` (grep ADEHack).

Commands: `ping`, `set_tempo {bpm}`, `list_tracks`, `select_track {track:int|name}`, `create_midi_track {name?, index=-1}`,
`create_clip {track:"selected"|int|name, slot?, length, notes|pattern, mapping, singleNote, name?, fire?}` (an existing MIDI clip in the slot is updated in place via `select_all_notes()+replace_selected_notes()` so a playing clip
stays in sync; pass recreate:true to delete+create instead; fire is skipped if the slot is already playing; highlights it and switches to Session view unless show:false),
`load_sample {path, track?:int|name, mode:"replace"|"append"}` (selects track first; replace = hot-swap the track's existing
instrument via `browser.hotswap_target = device` so `load_item` swaps the sample instead of adding a second Simpler, falling back to `track.delete_device`; re-scans browser roots user_folders > current_project > user_library > samples
every ~0.3 s for up to ~2.4 s via schedule_message before replying not found — freshly written wavs take a moment to index; use a client timeout >= 5 s),
`show_view {view:"Session"|"Arranger"|"Detail/Clip"|"Detail/DeviceChain"}`, `play`, `stop`,
`list_devices {track}`, `delete_track {track}`, `rename_track {track,name}`,
`browse {root?}` (debug: top-level names under each browser root).
Replies: one JSON line, `{"ok":true,...}` or `{"ok":false,"error":"..."}`.

Live API used: `ControlSurface.schedule_message(1, cb)` (100 ms tick, no threads), `self.song().tempo/tracks/view.selected_track`,
`track.has_midi_input`, `track.clip_slots[i].has_clip/delete_clip()/create_clip(len)/clip/fire()`,
`clip.set_notes(((pitch,start,dur,vel,mute),...))` (fallback `select_all_notes()+replace_selected_notes()`), `clip.name`, `clip.looping`,
`song.create_midi_track(index)`, `Live.Application.get_application().browser.{user_folders,current_project,user_library,samples}`
(walk `.children/.name/.is_loadable/.uri`) and `browser.load_item(item)`. Live's User Library index can be stale for new files, so add the
output folder as a Place (Places > Add Folder...) — `user_folders` is searched first.

Uncertainties: Live 10.1 has `browser.load_item` and `Clip.set_notes`; `Clip.add_new_notes` is Live 11 only (not used).
`set_notes` on an empty clip adds notes in 10.x; if it ever errors we fall back to `replace_selected_notes`. `load_item` targets the
selected track; browser items in User Library show names without `.wav`, so we match both the basename and its stem.
Pattern conversion: start = step*0.25 (+swing*0.5*0.25 on odd steps), duration 0.125, length = bars*4; GM map matches lib/pattern.js.

Live keeps a loaded sample in RAM: Simpler/Sample expose file_path, crop, reverse, warp_as, slices but NO reload API in 10.1, so never reuse a
filename while it is loaded (rotate numbered names). `ClipSlot.fire()` obeys the global launch quantization while playing.
