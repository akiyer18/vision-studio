# ADEHack — Live 10 Remote Script (TCP 127.0.0.1:9004, newline-delimited JSON)

Install: `./ableton/install.sh`, restart Live, Preferences > Link/MIDI > Control Surface > "ADEHack" (In/Out: None).
Test: `printf '{"cmd":"ping"}\n' | nc 127.0.0.1 9004` (or `node ableton/client.js ping`). Log: `~/Library/Preferences/Ableton/Live 10.*/Log.txt` (grep ADEHack).

Commands: `version` -> {ok, version, cmds:[...]} (also in `ping`; ableton/VERSION holds the same string), `ping`, `set_tempo {bpm}`, `list_tracks`, `select_track {track:int|name}`, `create_midi_track {name?, index=-1}`,
`create_clip {track:"selected"|int|name, slot?, length, notes|pattern, mapping, singleNote, name?, fire?}` (an existing MIDI clip in the slot is updated in place via `select_all_notes()+replace_selected_notes()` so a playing clip
stays in sync; pass recreate:true to delete+create instead; fire is skipped if the slot is already playing; then focuses it like focus_clip unless show:false),
`load_sample {path, track?:int|name, mode:"replace"|"append"}` (selects track first; replace = hot-swap the track's existing
instrument via `browser.hotswap_target = device` so `load_item` swaps the sample instead of adding a second Simpler, falling back to `track.delete_device`; re-scans browser roots user_folders > current_project > user_library > samples
every ~0.3 s for up to ~2.4 s via schedule_message before replying not found — freshly written wavs take a moment to index; use a client timeout >= 5 s),
`focus_clip {track, slot?}` (highlight slot, detail_clip, Session + Detail/Clip views, clip.view.show_loop()),
`arrangement_record {bars?} | {scenes:[{index,bars},...]} | {stop:true}` (record_mode on; scenes form fires each scene in turn for its bars (next fire ~0.2 s early so launch quantization lands it on the bar), then stops record + transport and shows the Arranger; a new call cancels the running sequence), `clip_edit {track, slot, quantize?:{grid:0..8 (5 = 1/16), amount:0..1}, duplicate_loop?, crop?, loop_start?, loop_end?, color_index?, name?}` -> {ok, done:[ops], errors:{op:msg}, clip:{name,length,loop_start,loop_end,color_index,is_playing}},
`duplicate_clip {track, slot, to_slot}`, `duplicate_scene {index}` -> {ok,index,new_index,name}, `duplicate_track {track, name?}` -> {ok,source_index,index,name}, `rename_scene {index,name}`,
`transport_setup {metronome?, loop?, loop_start?, loop_length?, launch_quantization?:int (Live.Song.Quantization: 4 = 1 bar), swing?:0..1, tempo?, tempo_ramp?:{to, seconds}}` -> {ok, done, errors, state:{tempo,is_playing,metronome,loop,loop_start,loop_length,swing_amount,clip_trigger_quantization,can_capture_midi,tempo_ramp?}} (ramp steps every 100 ms; a new ramp cancels the old),
`capture_midi {}` (ok:false when !song.can_capture_midi), `set_track_color {track, color_index}`; list_tracks entries also carry color_index, is_grouped, group_track, fold_state.
`show_view {view:"Session"|"Arranger"|"Detail/Clip"|"Detail/DeviceChain"}`, `play`, `stop`,
`list_devices {track, params?:true}` (params: first 32 of each device with value/min/max/display),
`load_device {track, name}` (BFS over browser.audio_effects > instruments > midi_effects > drums > sounds, exact then case-insensitive;
selects the track, `load_item` appends the device; replies the new device + params), `set_device_param {track, device:int|name, param:int|name, value}` (clamped),
`delete_device {track, device}`, `set_mixer {track, volume?:0..1 (0.85 = 0 dB), pan?:-1..1, mute?, solo?, arm?}`,
`create_scene {index=-1, name?}`, `fire_scene {index}`, `list_scenes`, `stop_clip {track, slot}`, `delete_track {track}`, `rename_track {track,name}`,
`set_simpler {track, device?, mode?:classic|oneshot|slice, warp?:bool, warp_mode?:beats|tones|texture|repitch|complex|complex_pro, loop?:bool ('S Loop On' param), gain_db?, voices?:1..32, retrigger?:bool, start_marker?, end_marker? (sample frames)}` -> {ok, track, device, done:[...], errors:{...}, state}, `sample_info {track, device?}` -> {ok, track, device, sample:{playback_mode (0 classic/1 one-shot/2 slicing), voices, retrigger, file_path, length (frames), warping, warp_mode, gain, start_marker, end_marker, slices, loop}},
`set_send {track, send:'A'|'B'|int|name, level?:0..1}` -> {ok, track, sends:[{index,name,level}]},
`browse {root:instruments|sounds|drums|audio_effects|midi_effects|user_folders|..., query?, depth=2, limit=200}` -> {ok, root, items:[{name,is_folder,is_loadable,is_device,path:[...]}], truncated},
load_device matching: exact device > exact preset > alias (Ping Pong Delay/Simple Delay/Echo -> Delay, eq -> EQ Eight, glue -> Glue Compressor, ...) > case-insensitive > substring; reply has match + requested; not-found lists the real top-level names.
Live 10 Standard here has NO Echo / Ping Pong Delay / Operator / Analog / Wavetable (Suite); instruments = Drum Rack, Impulse, Instrument Rack, Simpler, External Instrument; presets live under `sounds` (Bass, Pad, Synth Lead, ...).
`browse {root?}` (legacy debug: top-level names under each browser root).
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
