# ADEHack - Ableton Live 10 MIDI Remote Script (Python 2.7 syntax, py3-neutral).
# Listens on TCP 127.0.0.1:9004 for newline-delimited JSON commands. No threads:
# everything runs on Live's main thread via the ControlSurface timer.
from __future__ import print_function, absolute_import
import errno
import json
import os
import socket

import Live
from _Framework.ControlSurface import ControlSurface

HOST = '127.0.0.1'
PORT = 9004
GM_DRUM_NOTES = {'kick': 36, 'snare': 38, 'clap': 39, 'rim': 37, 'hat_closed': 42,
                 'hat_open': 46, 'tom_low': 45, 'tom_high': 50, 'ride': 51,
                 'crash': 49, 'perc': 54}
WOULD_BLOCK = (errno.EAGAIN, errno.EWOULDBLOCK, errno.EINPROGRESS)
PENDING = object()  # returned by a command that will reply later via schedule_message
LOAD_RETRY_TICKS = 3   # ~0.3 s between browser re-scans
LOAD_RETRY_MAX = 8     # ~2.4 s total before replying not found


def _to_bytes(s):
    return s if isinstance(s, bytes) else s.encode('utf-8')


class ADEHack(ControlSurface):

    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._server = None
        self._clients = []  # list of [socket, bytes_buffer]
        self._ramp = None
        self._ramp_id = 0
        with self.component_guard():
            try:
                self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                self._server.bind((HOST, PORT))
                self._server.listen(5)
                self._server.setblocking(0)
                self.log_message('ADEHack: listening on %s:%d' % (HOST, PORT))
            except Exception as e:
                self.log_message('ADEHack: could not open socket: %r' % (e,))
                self._server = None
            # Primary polling: schedule_message ticks are ~100 ms and are driven
            # by Live's update_display (also ~100 ms). Fallback would be to
            # override update_display() and call self._tick() there; we keep
            # schedule_message as the single driver so commands are not run twice.
            self.schedule_message(1, self._poll)

    # ------------------------------------------------------------------ polling
    def _poll(self):
        try:
            self._tick()
        except Exception as e:
            self.log_message('ADEHack: poll error: %r' % (e,))
        finally:
            try:
                self.schedule_message(1, self._poll)
            except Exception as e:
                self.log_message('ADEHack: reschedule failed: %r' % (e,))

    def _tick(self):
        if self._server is None:
            return
        while True:  # accept all pending connections
            try:
                conn, addr = self._server.accept()
            except socket.error as e:
                if e.args and e.args[0] in WOULD_BLOCK:
                    break
                raise
            conn.setblocking(0)
            self._clients.append([conn, b''])
            self.log_message('ADEHack: client connected %r' % (addr,))
        for client in list(self._clients):
            conn = client[0]
            try:
                data = conn.recv(65536)
            except socket.error as e:
                if e.args and e.args[0] in WOULD_BLOCK:
                    continue
                self._drop(client, 'recv error %r' % (e,))
                continue
            if not data:
                self._drop(client, 'closed by peer')
                continue
            client[1] += data
            while b'\n' in client[1]:
                line, client[1] = client[1].split(b'\n', 1)
                line = line.strip()
                if line:
                    reply = self._handle_line(line, conn)
                    if reply is not PENDING:
                        self._send(conn, reply)

    def _drop(self, client, why):
        self.log_message('ADEHack: dropping client (%s)' % why)
        try:
            client[0].close()
        except Exception:
            pass
        if client in self._clients:
            self._clients.remove(client)

    def _send(self, conn, reply):
        try:
            conn.sendall(_to_bytes(json.dumps(reply) + '\n'))
        except Exception as e:
            self.log_message('ADEHack: send failed: %r' % (e,))

    # ----------------------------------------------------------------- commands
    def _handle_line(self, line, conn=None):
        try:
            text = line.decode('utf-8') if isinstance(line, bytes) else line
            msg = json.loads(text)
            cmd = msg.get('cmd')
            self.log_message('ADEHack: cmd %r' % (text[:300],))
            if cmd == 'ping':
                return self._cmd_ping(msg)
            if cmd == 'set_tempo':
                self.song().tempo = float(msg['bpm'])
                return {'ok': True, 'tempo': self.song().tempo}
            if cmd == 'create_clip':
                return self._cmd_create_clip(msg)
            if cmd == 'load_sample':
                return self._cmd_load_sample(msg, conn)
            if cmd == 'show_view':
                name = msg.get('view', 'Session')
                ok = self._show_view(name)
                return {'ok': ok, 'view': name} if ok else {'ok': False, 'error': 'show_view(%r) failed' % (name,)}
            if cmd == 'focus_clip':
                return self._cmd_focus_clip(msg)
            if cmd == 'arrangement_record':
                return self._cmd_arrangement_record(msg)
            if cmd == 'play':
                self.song().start_playing()
                return {'ok': True, 'playing': True}
            if cmd == 'stop':
                self.song().stop_playing()
                return {'ok': True, 'playing': False}
            if cmd == 'list_devices':
                return self._cmd_list_devices(msg)
            if cmd == 'load_device':
                return self._cmd_load_device(msg)
            if cmd == 'set_device_param':
                return self._cmd_set_device_param(msg)
            if cmd == 'delete_device':
                track = self._track(msg.get('track', 'selected'))
                index, dev = self._device(track, msg.get('device'))
                name = dev.name
                track.delete_device(index)
                return {'ok': True, 'track': track.name, 'index': index, 'name': name,
                        'devices': self._devices(track)}
            if cmd == 'set_mixer':
                return self._cmd_set_mixer(msg)
            if cmd == 'create_scene':
                song = self.song()
                index = int(msg.get('index', -1))
                song.create_scene(index)
                scenes = list(song.scenes)
                scene = scenes[index] if 0 <= index < len(scenes) else scenes[-1]
                if msg.get('name'):
                    scene.name = u'%s' % (msg['name'],)
                return {'ok': True, 'index': scenes.index(scene), 'name': scene.name}
            if cmd == 'fire_scene':
                scenes = list(self.song().scenes)
                scene = scenes[int(msg.get('index', 0))]
                scene.fire()
                return {'ok': True, 'index': scenes.index(scene), 'name': scene.name}
            if cmd == 'list_scenes':
                return {'ok': True, 'scenes': [{'index': i, 'name': sc.name}
                                               for i, sc in enumerate(self.song().scenes)]}
            if cmd == 'stop_clip':
                track = self._track(msg.get('track', 'selected'))
                slot_index = int(msg.get('slot', 0))
                track.clip_slots[slot_index].stop()
                return {'ok': True, 'track': track.name, 'slot': slot_index}
            if cmd == 'delete_track':
                track = self._track(msg.get('track', 'selected'))
                index = self._index_of(track)
                name = track.name
                self.song().delete_track(index)
                return {'ok': True, 'index': index, 'name': name}
            if cmd == 'rename_track':
                track = self._track(msg.get('track', 'selected'))
                track.name = u'%s' % (msg['name'],)
                return {'ok': True, 'index': self._index_of(track), 'name': track.name}
            if cmd == 'list_tracks':
                return self._cmd_list_tracks(msg)
            if cmd == 'clip_edit':
                return self._cmd_clip_edit(msg)
            if cmd == 'duplicate_clip':
                track = self._track(msg.get('track', 'selected'))
                src, dst = int(msg['slot']), int(msg['to_slot'])
                if not track.clip_slots[src].has_clip:
                    return {'ok': False, 'error': 'no clip in %s slot %d' % (track.name, src)}
                track.clip_slots[src].duplicate_clip_to(track.clip_slots[dst])
                return {'ok': True, 'track': track.name, 'slot': src, 'to_slot': dst}
            if cmd == 'duplicate_scene':
                song = self.song()
                index = int(msg.get('index', 0))
                song.duplicate_scene(index)
                scenes = list(song.scenes)
                new_index = min(index + 1, len(scenes) - 1)
                return {'ok': True, 'index': index, 'new_index': new_index, 'name': scenes[new_index].name}
            if cmd == 'duplicate_track':
                song = self.song()
                track = self._track(msg.get('track', 'selected'))
                index = self._index_of(track)
                song.duplicate_track(index)
                tracks = list(song.tracks)
                new_index = min(index + 1, len(tracks) - 1)
                new = tracks[new_index]
                if msg.get('name'):
                    new.name = u'%s' % (msg['name'],)
                return {'ok': True, 'source_index': index, 'index': new_index, 'name': new.name}
            if cmd == 'rename_scene':
                scenes = list(self.song().scenes)
                scene = scenes[int(msg['index'])]
                scene.name = u'%s' % (msg['name'],)
                return {'ok': True, 'index': scenes.index(scene), 'name': scene.name}
            if cmd == 'transport_setup':
                return self._cmd_transport_setup(msg)
            if cmd == 'capture_midi':
                song = self.song()
                if not getattr(song, 'can_capture_midi', False):
                    return {'ok': False, 'error': 'nothing to capture (Live has no recent MIDI input; play something on a MIDI track first)'}
                song.capture_midi()
                return {'ok': True, 'track': song.view.selected_track.name}
            if cmd == 'set_track_color':
                track = self._track(msg.get('track', 'selected'))
                track.color_index = int(msg['color_index'])
                return {'ok': True, 'index': self._index_of(track), 'name': track.name,
                        'color_index': int(track.color_index)}
            if cmd == 'create_midi_track':
                return self._cmd_create_midi_track(msg)
            if cmd == 'select_track':
                track = self._track(msg.get('track', 'selected'))
                self.song().view.selected_track = track
                return {'ok': True, 'index': self._index_of(track), 'name': track.name}
            if cmd == 'browse':
                return self._cmd_browse(msg)
            return {'ok': False, 'error': 'unknown cmd: %r' % (cmd,)}
        except Exception as e:
            self.log_message('ADEHack: error: %r' % (e,))
            return {'ok': False, 'error': '%s: %s' % (e.__class__.__name__, e)}

    def _track(self, spec):
        song = self.song()
        if spec is None or spec == 'selected' or spec == '':
            return song.view.selected_track
        tracks = list(song.tracks)
        if isinstance(spec, bool):
            raise ValueError('bad track spec %r' % (spec,))
        if isinstance(spec, (int, float)):
            return tracks[int(spec)]
        text = u'%s' % (spec,)
        if text.lstrip('-').isdigit():
            return tracks[int(text)]
        for t in tracks:  # exact name, then case-insensitive
            if t.name == text:
                return t
        for t in tracks:
            if t.name.lower() == text.lower():
                return t
        raise ValueError('no track named %r; tracks: %r' % (text, [t.name for t in tracks]))

    def _index_of(self, track):
        for i, t in enumerate(self.song().tracks):
            if t == track:
                return i
        return -1

    INSTRUMENT_CLASSES = ('OriginalSimpler', 'Simpler', 'MultiSampler', 'DrumGroupDevice',
                          'InstrumentImpulse', 'Operator', 'UltraAnalog', 'Collision',
                          'InstrumentVector', 'StringStudio', 'LoungeLizard', 'Tension')

    def _devices(self, track):
        out = []
        for i, d in enumerate(track.devices):
            out.append({'index': i, 'name': d.name, 'class_name': getattr(d, 'class_name', ''),
                        'type': int(getattr(d, 'type', 0) or 0)})
        return out

    def _instrument_device(self, track):
        # DeviceType.instrument == 1 in the Live API; class_name as a fallback.
        for i, d in enumerate(track.devices):
            cls = getattr(d, 'class_name', '')
            if int(getattr(d, 'type', 0) or 0) == 1 or cls in self.INSTRUMENT_CLASSES:
                return i, d
        return -1, None

    def _cmd_list_devices(self, msg):
        track = self._track(msg.get('track', 'selected'))
        devices = self._devices(track)
        if msg.get('params'):
            for info, dev in zip(devices, track.devices):
                info['params'] = self._params(dev)
        return {'ok': True, 'track': track.name, 'devices': devices}

    # ----------------------------------------------------------- devices (v4)
    def _device(self, track, spec):
        devices = list(track.devices)
        if spec is None or spec == '' or spec == 'last':
            if not devices:
                raise ValueError('track %r has no devices' % (track.name,))
            return len(devices) - 1, devices[-1]
        if isinstance(spec, (int, float)) and not isinstance(spec, bool):
            return int(spec), devices[int(spec)]
        text = u'%s' % (spec,)
        if text.lstrip('-').isdigit():
            i = int(text)
            return i, devices[i]
        for i, d in enumerate(devices):
            if d.name == text or getattr(d, 'class_name', '') == text:
                return i, d
        for i, d in enumerate(devices):
            if d.name.lower() == text.lower() or getattr(d, 'class_name', '').lower() == text.lower():
                return i, d
        raise ValueError('no device %r on %r; devices: %r' % (text, track.name, [d.name for d in devices]))

    def _params(self, dev, limit=32):
        out = []
        for i, p in enumerate(dev.parameters):
            if i >= limit:
                break
            info = {'index': i, 'name': p.name, 'value': float(p.value),
                    'min': float(p.min), 'max': float(p.max)}
            try:
                info['quantized'] = bool(p.is_quantized)
                info['display'] = p.str_for_value(p.value)
            except Exception:
                pass
            out.append(info)
        return out

    def _param(self, dev, spec):
        params = list(dev.parameters)
        if isinstance(spec, (int, float)) and not isinstance(spec, bool):
            return int(spec), params[int(spec)]
        text = u'%s' % (spec,)
        if text.isdigit():
            return int(text), params[int(text)]
        for i, p in enumerate(params):
            if p.name == text or getattr(p, 'original_name', '') == text:
                return i, p
        for i, p in enumerate(params):
            if p.name.lower() == text.lower() or getattr(p, 'original_name', '').lower() == text.lower():
                return i, p
        raise ValueError('no param %r on %r; params: %r' % (text, dev.name, [p.name for p in params][:32]))

    DEVICE_ROOTS = ('audio_effects', 'instruments', 'midi_effects', 'drums', 'sounds')

    def _find_device_item(self, browser, name, max_items=5000, max_depth=6):
        """Breadth-first so 'Reverb' hits the device itself before a preset named Reverb."""
        text = u'%s' % (name,)
        low = text.lower()
        ci_hit = None
        searched = []
        for root_name in self.DEVICE_ROOTS:
            try:
                root = getattr(browser, root_name)
            except Exception:
                continue
            searched.append(root_name)
            queue = [(root, 0)]
            seen = 0
            while queue and seen < max_items:
                item, depth = queue.pop(0)
                seen += 1
                try:
                    loadable = item.is_loadable
                    iname = item.name
                except Exception:
                    continue
                if loadable and iname == text:
                    return item, root_name, searched
                if loadable and ci_hit is None and iname.lower() == low:
                    ci_hit = (item, root_name)
                if depth < max_depth:
                    try:
                        for child in item.children:
                            queue.append((child, depth + 1))
                    except Exception:
                        pass
            if ci_hit is not None:
                return ci_hit[0], ci_hit[1], searched
        return None, None, searched

    def _cmd_load_device(self, msg):
        track = self._track(msg.get('track', 'selected'))
        name = msg['name']
        browser = Live.Application.get_application().browser
        item, root_name, searched = self._find_device_item(browser, name)
        if item is None:
            return {'ok': False, 'error': 'device %r not found in browser roots %r' % (name, searched)}
        self.song().view.selected_track = track
        before = len(list(track.devices))
        browser.load_item(item)  # appends at the end of the selected track's chain
        devices = list(track.devices)
        if len(devices) <= before:
            return {'ok': False, 'error': 'load_item(%r) did not add a device to %r' % (item.name, track.name),
                    'devices': self._devices(track)}
        dev = devices[-1]
        return {'ok': True, 'track': track.name, 'item': item.name, 'uri': item.uri, 'root': root_name,
                'device': {'index': len(devices) - 1, 'name': dev.name,
                           'class_name': getattr(dev, 'class_name', '')},
                'params': self._params(dev)}

    def _cmd_set_device_param(self, msg):
        track = self._track(msg.get('track', 'selected'))
        dindex, dev = self._device(track, msg.get('device'))
        pindex, param = self._param(dev, msg.get('param'))
        value = float(msg['value'])
        lo, hi = float(param.min), float(param.max)
        value = max(lo, min(hi, value))
        param.value = value
        info = {'index': pindex, 'name': param.name, 'value': float(param.value), 'min': lo, 'max': hi}
        try:
            info['display'] = param.str_for_value(param.value)
        except Exception:
            pass
        return {'ok': True, 'track': track.name, 'device': {'index': dindex, 'name': dev.name}, 'param': info}

    def _mixer_state(self, track):
        mixer = track.mixer_device
        state = {'volume': float(mixer.volume.value), 'pan': float(mixer.panning.value),
                 'mute': bool(track.mute), 'solo': bool(track.solo)}
        try:
            state['arm'] = bool(track.arm) if track.can_be_armed else None
        except Exception:
            state['arm'] = None
        return state

    def _cmd_set_mixer(self, msg):
        track = self._track(msg.get('track', 'selected'))
        mixer = track.mixer_device
        if msg.get('volume') is not None:
            v = mixer.volume
            v.value = max(float(v.min), min(float(v.max), float(msg['volume'])))
        if msg.get('pan') is not None:
            p = mixer.panning
            p.value = max(float(p.min), min(float(p.max), float(msg['pan'])))
        if msg.get('mute') is not None:
            track.mute = bool(msg['mute'])
        if msg.get('solo') is not None:
            track.solo = bool(msg['solo'])
        if msg.get('arm') is not None:
            if getattr(track, 'can_be_armed', False):
                track.arm = bool(msg['arm'])
            else:
                return {'ok': False, 'error': 'track %r cannot be armed' % (track.name,),
                        'mixer': self._mixer_state(track)}
        return {'ok': True, 'track': track.name, 'mixer': self._mixer_state(track)}

    def _replace_target(self, browser, track):
        """Prepare a MIDI track so load_item REPLACES its sampler instead of appending.
        1) hot-swap: browser.hotswap_target = device (what Push does) -> load_item swaps the sample
        2) fallback: delete the instrument device, load_item then creates a fresh Simpler.
        Returns (how, device_name, hotswapped)."""
        index, dev = self._instrument_device(track)
        if dev is None:
            return 'none', None, False
        name = dev.name
        try:
            self.song().view.select_device(dev)
        except Exception as e:
            self.log_message('ADEHack: select_device failed: %r' % (e,))
        try:
            browser.hotswap_target = dev
            if browser.hotswap_target is not None:
                return 'hotswap', name, True
        except Exception as e:
            self.log_message('ADEHack: hotswap_target failed: %r' % (e,))
        try:
            track.delete_device(index)
            return 'deleted', name, False
        except Exception as e:
            self.log_message('ADEHack: delete_device failed: %r' % (e,))
        return 'none', name, False

    def _cmd_list_tracks(self, msg):
        song = self.song()
        sel = song.view.selected_track
        out = []
        for i, t in enumerate(song.tracks):
            info = {'index': i, 'name': t.name, 'is_midi': bool(t.has_midi_input),
                    'selected': t == sel}
            try:
                info['color_index'] = int(t.color_index)
                info['is_grouped'] = bool(t.is_grouped)
                info['group_track'] = t.group_track.name if t.is_grouped and t.group_track else None
                info['fold_state'] = int(t.fold_state) if getattr(t, 'is_foldable', False) else None
            except Exception as e:
                info['meta_error'] = '%r' % (e,)
            out.append(info)
        return {'ok': True, 'tracks': out}

    def _cmd_create_midi_track(self, msg):
        song = self.song()
        index = int(msg.get('index', -1))
        before = len(list(song.tracks))
        song.create_midi_track(index)
        tracks = list(song.tracks)
        if len(tracks) != before + 1:
            return {'ok': False, 'error': 'create_midi_track did not add a track'}
        track = tracks[index] if 0 <= index < len(tracks) else tracks[-1]
        if msg.get('name'):
            track.name = u'%s' % (msg['name'],)
        song.view.selected_track = track
        return {'ok': True, 'index': self._index_of(track), 'name': track.name}

    def _cmd_ping(self, msg):
        song = self.song()
        return {'ok': True, 'tempo': song.tempo,
                'tracks': [t.name for t in song.tracks],
                'selected_track': song.view.selected_track.name}

    def _pattern_notes(self, pattern, mapping, single_note):
        steps_per_bar = int(pattern.get('stepsPerBar', 16) or 16)
        step_len = 4.0 / steps_per_bar
        swing = float(pattern.get('swing', 0) or 0)
        notes = []
        for lane in pattern.get('lanes', []):
            if mapping == 'single':
                pitch = int(single_note)
            else:
                pitch = GM_DRUM_NOTES.get(lane.get('instrument'), 36)
            for hit in lane.get('steps', []):
                step = int(hit['step'])
                start = step * step_len + (swing * 0.5 * step_len if step % 2 else 0.0)
                notes.append({'pitch': pitch, 'start': start, 'duration': 0.125,
                              'velocity': int(hit.get('velocity', 100))})
        length = float(pattern.get('bars', 1) or 1) * 4.0
        return notes, length

    def _cmd_create_clip(self, msg):
        track = self._track(msg.get('track', 'selected'))
        if not track.has_midi_input:
            return {'ok': False, 'error': 'track %r is not a MIDI track' % (track.name,)}
        notes = msg.get('notes')
        length = float(msg.get('length', 4.0))
        if notes is None and msg.get('pattern'):
            notes, length = self._pattern_notes(msg['pattern'], msg.get('mapping', 'gm'),
                                                msg.get('singleNote', 60))
            length = float(msg.get('length', length))
        notes = notes or []
        slot_index = msg.get('slot')
        if slot_index is None:
            slot_index = 0
            for i, s in enumerate(track.clip_slots):
                if not s.has_clip:
                    slot_index = i
                    break
        slot = track.clip_slots[int(slot_index)]
        tup = tuple((int(n['pitch']), float(n['start']), float(n['duration']),
                     int(n.get('velocity', 100)), False) for n in notes)
        mode = 'created'
        in_place = slot.has_clip and not msg.get('recreate') and getattr(slot.clip, 'is_midi_clip', True)
        if in_place:
            # Swap notes inside the existing clip: a playing clip keeps playing in sync,
            # instead of delete_clip (stops it) + fire (waits for the next launch quantum).
            clip = slot.clip
            clip.select_all_notes()
            clip.replace_selected_notes(tup)
            self._set_clip_length(clip, length)
            mode = 'replaced_in_place'
        else:
            if slot.has_clip:
                slot.delete_clip()
            slot.create_clip(length)
            clip = slot.clip
            if tup:
                try:
                    clip.set_notes(tup)
                except Exception as e:  # Live 10 alt path, same semantics on an empty clip
                    self.log_message('ADEHack: set_notes failed (%r), trying replace_selected_notes' % (e,))
                    clip.select_all_notes()
                    clip.replace_selected_notes(tup)
        if msg.get('name'):
            clip.name = str(msg['name'])
        clip.looping = True
        # ClipSlot.fire() obeys the global launch quantization while the transport runs,
        # so a new clip lands on the next bar in sync. Don't re-fire a slot that is
        # already playing (it would retrigger from 0 at the next quantum).
        if msg.get('fire') and not getattr(slot, 'is_playing', False):
            slot.fire()
        if msg.get('show', True):
            self._focus_clip(slot, clip)
        return {'ok': True, 'track': track.name, 'slot': int(slot_index), 'notes': len(tup),
                'mode': mode, 'playing': bool(getattr(slot, 'is_playing', False))}

    def _set_clip_length(self, clip, length):
        # Grow: move end markers out before the loop end; shrink: the reverse. Try both orders.
        for order in (('end_marker', 'loop_end', 'loop_start', 'start_marker'),
                      ('loop_end', 'end_marker', 'loop_start', 'start_marker')):
            try:
                for attr in order:
                    setattr(clip, attr, length if attr in ('end_marker', 'loop_end') else 0.0)
                return
            except Exception as e:
                self.log_message('ADEHack: clip length order %r failed: %r' % (order, e))

    def _focus_clip(self, slot, clip):
        """Bring a clip on screen: Session view with its slot highlighted, the clip
        editor (Detail/Clip) showing it, scrolled to its loop so the notes are visible."""
        done = []
        for label, fn in (
                ('highlighted_clip_slot', lambda: setattr(self.song().view, 'highlighted_clip_slot', slot)),
                ('detail_clip', lambda: setattr(self.song().view, 'detail_clip', clip)),
                ('Session', lambda: self._show_view('Session') or None),
                ('Detail/Clip', lambda: self._show_view('Detail/Clip') or None),
                ('show_loop', lambda: clip.view.show_loop())):
            try:
                fn()
                done.append(label)
            except Exception as e:
                self.log_message('ADEHack: focus %s failed: %r' % (label, e))
        return done

    def _cmd_focus_clip(self, msg):
        track = self._track(msg.get('track', 'selected'))
        slot_index = msg.get('slot')
        if slot_index is None:  # first slot holding a clip
            slot_index = 0
            for i, s in enumerate(track.clip_slots):
                if s.has_clip:
                    slot_index = i
                    break
        slot = track.clip_slots[int(slot_index)]
        if not slot.has_clip:
            return {'ok': False, 'error': 'no clip in %s slot %d' % (track.name, int(slot_index))}
        return {'ok': True, 'track': track.name, 'slot': int(slot_index),
                'focused': self._focus_clip(slot, slot.clip)}

    def _cmd_arrangement_record(self, msg):
        song = self.song()
        bars = msg.get('bars')
        if msg.get('stop'):
            song.record_mode = False
            song.stop_playing()
            return {'ok': True, 'recording': False}
        song.record_mode = True
        song.start_playing()
        reply = {'ok': True, 'recording': True, 'tempo': song.tempo}
        if bars:
            seconds = float(bars) * 4.0 * 60.0 / float(song.tempo)
            ticks = max(1, int(round(seconds * 10.0)))  # ~100 ms per tick
            self.schedule_message(ticks, self._stop_recording)
            reply['stops_in_seconds'] = seconds
        return reply

    def _stop_recording(self):
        try:
            self.song().record_mode = False
            self.song().stop_playing()
            self.log_message('ADEHack: arrangement recording stopped')
        except Exception as e:
            self.log_message('ADEHack: stop recording failed: %r' % (e,))

    # --------------------------------------------------------------- v5: clips
    def _live_enum(self, enum_name, value):
        """Live's enums are Boost.Python enums: convert an int to Live.Song.<Enum>.values[int]."""
        try:
            enum = getattr(Live.Song, enum_name)
            return enum.values[int(value)]
        except Exception:
            return value

    def _cmd_clip_edit(self, msg):
        track = self._track(msg.get('track', 'selected'))
        slot_index = int(msg.get('slot', 0))
        slot = track.clip_slots[slot_index]
        if not slot.has_clip:
            return {'ok': False, 'error': 'no clip in %s slot %d' % (track.name, slot_index)}
        clip = slot.clip
        done, errors = [], {}

        def op(label, fn):
            try:
                fn()
                done.append(label)
            except Exception as e:
                errors[label] = '%s: %s' % (e.__class__.__name__, e)
                self.log_message('ADEHack: clip_edit %s failed: %r' % (label, e))

        if msg.get('quantize'):
            q = msg['quantize']
            grid = self._live_enum('RecordingQuantization', q.get('grid', 5))  # 5 = 1/16
            amount = max(0.0, min(1.0, float(q.get('amount', 1.0))))
            op('quantize', lambda: clip.quantize(grid, amount))
        if msg.get('duplicate_loop'):
            op('duplicate_loop', clip.duplicate_loop)
        if msg.get('crop'):
            op('crop', clip.crop)
        if msg.get('loop_start') is not None or msg.get('loop_end') is not None:
            def set_loop():
                start = float(msg.get('loop_start', clip.loop_start))
                end = float(msg.get('loop_end', clip.loop_end))
                for order in (('end_marker', 'loop_end', 'loop_start', 'start_marker'),
                              ('loop_start', 'start_marker', 'loop_end', 'end_marker')):
                    try:
                        for attr in order:
                            setattr(clip, attr, end if attr in ('end_marker', 'loop_end') else start)
                        return
                    except Exception:
                        continue
                raise ValueError('could not set loop %r..%r' % (start, end))
            op('loop', set_loop)
        if msg.get('color_index') is not None:
            op('color_index', lambda: setattr(clip, 'color_index', int(msg['color_index'])))
        if msg.get('name'):
            op('name', lambda: setattr(clip, 'name', u'%s' % (msg['name'],)))
        state = {}
        for attr in ('name', 'length', 'loop_start', 'loop_end', 'color_index', 'is_playing'):
            try:
                v = getattr(clip, attr)
                state[attr] = v if isinstance(v, (int, float, bool)) else u'%s' % (v,)
            except Exception:
                pass
        return {'ok': not errors or bool(done), 'track': track.name, 'slot': slot_index,
                'done': done, 'errors': errors, 'clip': state}

    # ----------------------------------------------------------- v5: transport
    def _transport_state(self):
        song = self.song()
        state = {'tempo': float(song.tempo), 'is_playing': bool(song.is_playing)}
        for attr in ('metronome', 'loop', 'loop_start', 'loop_length', 'swing_amount',
                     'clip_trigger_quantization', 'can_capture_midi'):
            try:
                v = getattr(song, attr)
                state[attr] = v if isinstance(v, (bool, float)) else int(v)
            except Exception:
                pass
        if self._ramp is not None:
            state['tempo_ramp'] = {'to': self._ramp['to'], 'remaining_ticks': self._ramp['ticks']}
        return state

    def _cmd_transport_setup(self, msg):
        song = self.song()
        done, errors = [], {}

        def op(label, fn):
            try:
                fn()
                done.append(label)
            except Exception as e:
                errors[label] = '%s: %s' % (e.__class__.__name__, e)
                self.log_message('ADEHack: transport_setup %s failed: %r' % (label, e))

        if msg.get('metronome') is not None:
            op('metronome', lambda: setattr(song, 'metronome', bool(msg['metronome'])))
        if msg.get('loop_start') is not None:
            op('loop_start', lambda: setattr(song, 'loop_start', float(msg['loop_start'])))
        if msg.get('loop_length') is not None:
            op('loop_length', lambda: setattr(song, 'loop_length', float(msg['loop_length'])))
        if msg.get('loop') is not None:
            op('loop', lambda: setattr(song, 'loop', bool(msg['loop'])))
        if msg.get('launch_quantization') is not None:
            op('launch_quantization', lambda: setattr(
                song, 'clip_trigger_quantization',
                self._live_enum('Quantization', int(msg['launch_quantization']))))
        if msg.get('swing') is not None:
            op('swing', lambda: setattr(song, 'swing_amount', max(0.0, min(1.0, float(msg['swing'])))))
        if msg.get('tempo') is not None and not msg.get('tempo_ramp'):
            op('tempo', lambda: setattr(song, 'tempo', float(msg['tempo'])))
        if msg.get('tempo_ramp'):
            op('tempo_ramp', lambda: self._start_ramp(msg['tempo_ramp']))
        return {'ok': not errors or bool(done), 'done': done, 'errors': errors,
                'state': self._transport_state()}

    def _start_ramp(self, spec):
        song = self.song()
        to = float(spec['to'])
        seconds = max(0.1, float(spec.get('seconds', 4.0)))
        ticks = max(1, int(round(seconds * 10.0)))
        self._ramp_id += 1  # invalidates any running ramp's scheduled callbacks
        self._ramp = {'id': self._ramp_id, 'to': to, 'ticks': ticks,
                      'step': (to - float(song.tempo)) / float(ticks)}
        self.schedule_message(1, lambda: self._ramp_tick(self._ramp_id))

    def _ramp_tick(self, ramp_id):
        ramp = self._ramp
        if ramp is None or ramp['id'] != ramp_id:
            return  # cancelled / replaced
        try:
            song = self.song()
            ramp['ticks'] -= 1
            if ramp['ticks'] <= 0:
                song.tempo = ramp['to']
                self._ramp = None
                self.log_message('ADEHack: tempo ramp done at %.2f' % ramp['to'])
                return
            song.tempo = float(song.tempo) + ramp['step']
            self.schedule_message(1, lambda: self._ramp_tick(ramp_id))
        except Exception as e:
            self.log_message('ADEHack: tempo ramp error: %r' % (e,))
            self._ramp = None

    def _show_view(self, name):
        try:
            Live.Application.get_application().view.show_view(name)
            return True
        except Exception as e:
            self.log_message('ADEHack: show_view(%r) failed: %r' % (name, e))
            return False

    # Roots searched for load_sample, in order. user_folders = "Places" the
    # user added via "Add Folder..."; Live's User Library index can be stale.
    ROOT_ORDER = ('user_folders', 'current_project', 'user_library', 'samples')

    def _roots(self, browser, which=None):
        out = []
        for name in (which,) if which else self.ROOT_ORDER:
            try:
                val = getattr(browser, name)
            except Exception as e:
                self.log_message('ADEHack: browser.%s unavailable: %r' % (name, e))
                continue
            if name == 'user_folders':
                try:
                    out.extend([(name, f) for f in val])
                except Exception:
                    pass
            else:
                out.append((name, val))
        return out

    def _cmd_browse(self, msg):
        app = Live.Application.get_application()
        browser = app.browser
        result = []
        for name, root in self._roots(browser, msg.get('root')):
            try:
                kids = [c.name for c in root.children][:200]
            except Exception as e:
                kids = ['<error %r>' % (e,)]
            result.append({'root': name, 'name': getattr(root, 'name', ''), 'uri': getattr(root, 'uri', ''), 'children': kids})
        return {'ok': True, 'roots': result}

    def _cmd_load_sample(self, msg, conn=None):
        # Select the target track up front so the user sees where it lands.
        if msg.get('track') not in (None, 'selected', ''):
            self.song().view.selected_track = self._track(msg['track'])
        job = {'msg': msg, 'conn': conn, 'attempt': 0}
        return self._try_load(job)

    def _try_load(self, job):
        msg = job['msg']
        path = msg['path']
        base = os.path.basename(path)
        stem = os.path.splitext(base)[0]
        browser = Live.Application.get_application().browser
        searched = []
        found = None
        for name, root in self._roots(browser):
            searched.append('%s:%s' % (name, getattr(root, 'name', '')))
            found = self._find_item(root, (base, stem))
            if found is not None:
                break
        if found is not None:
            track = self.song().view.selected_track
            how, dev_name, hotswapped = 'none', None, False
            if msg.get('mode', 'replace') == 'replace' and track.has_midi_input:
                how, dev_name, hotswapped = self._replace_target(browser, track)
            try:
                browser.load_item(found)
            finally:
                if hotswapped:
                    try:
                        browser.hotswap_target = None
                    except Exception as e:
                        self.log_message('ADEHack: leaving hotswap failed: %r' % (e,))
            return {'ok': True, 'item': found.name, 'uri': found.uri, 'root': searched[-1],
                    'attempts': job['attempt'] + 1, 'track': track.name,
                    'replaced': how, 'replaced_device': dev_name,
                    'devices': self._devices(track)}
        job['attempt'] += 1
        if job['attempt'] < LOAD_RETRY_MAX and job['conn'] is not None:
            # Not indexed yet (fresh wav). Re-scan on a later tick without blocking Live.
            self.log_message('ADEHack: %r not found yet, retry %d' % (base, job['attempt']))
            self.schedule_message(LOAD_RETRY_TICKS, lambda: self._retry_load(job))
            return PENDING
        return {'ok': False, 'error': 'not found in Live browser after %d tries: %r; searched %r. '
                'Add the output folder via Places > "Add Folder..." in Live.'
                % (job['attempt'], base, searched)}

    def _retry_load(self, job):
        try:
            reply = self._try_load(job)
        except Exception as e:
            self.log_message('ADEHack: load retry error: %r' % (e,))
            reply = {'ok': False, 'error': '%s: %s' % (e.__class__.__name__, e)}
        if reply is not PENDING:
            self._send(job['conn'], reply)

    def _find_item(self, root, names, max_depth=6, max_items=5000):
        # Bounded iterative DFS so the UI never freezes on a huge library.
        stack = [(root, 0)]
        seen = 0
        while stack and seen < max_items:
            item, depth = stack.pop()
            seen += 1
            try:
                if item.is_loadable and item.name in names:
                    return item
            except Exception:
                pass
            if depth < max_depth:
                try:
                    for child in item.children:
                        stack.append((child, depth + 1))
                except Exception:
                    pass
        return None

    # --------------------------------------------------------------- lifecycle
    def disconnect(self):
        for client in list(self._clients):
            try:
                client[0].close()
            except Exception:
                pass
        self._clients = []
        if self._server is not None:
            try:
                self._server.close()
            except Exception:
                pass
            self._server = None
        self.log_message('ADEHack: disconnected')
        ControlSurface.disconnect(self)
