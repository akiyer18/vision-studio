# ADEHack - Ableton Live 10 MIDI Remote Script (Python 2.7 syntax, py3-neutral).
# Listens on TCP 127.0.0.1:9004 for newline-delimited JSON commands. No threads:
# everything runs on Live's main thread via the ControlSurface timer.
from __future__ import print_function, absolute_import
import errno
import math
import json
import os
import socket

import Live
from _Framework.ControlSurface import ControlSurface

VERSION = '5.6'
HOST = '127.0.0.1'
PORT = 9004
GM_DRUM_NOTES = {'kick': 36, 'snare': 38, 'clap': 39, 'rim': 37, 'hat_closed': 42,
                 'hat_open': 46, 'tom_low': 45, 'tom_high': 50, 'ride': 51,
                 'crash': 49, 'perc': 54}
WOULD_BLOCK = (errno.EAGAIN, errno.EWOULDBLOCK, errno.EINPROGRESS)
PENDING = object()  # returned by a command that will reply later via schedule_message
COMMANDS = ['arrangement_info', 'arrangement_record', 'browse', 'capture_midi', 'clip_edit', 'create_clip', 'create_midi_track', 'create_scene', 'delete_device', 'delete_track', 'describe_set', 'duplicate_clip', 'duplicate_scene', 'duplicate_track', 'fire_scene', 'focus_clip', 'get_clip_notes', 'list_devices', 'list_scenes', 'list_tracks', 'load_device', 'load_sample', 'load_to_pad', 'pad_info', 'ping', 'play', 'play_for', 'play_scene_for', 'rename_scene', 'rename_track', 'sample_info', 'select_track', 'set_device_param', 'set_mixer', 'set_send', 'set_simpler', 'set_tempo', 'set_track_color', 'show_view', 'stop', 'stop_clip', 'transport_setup', 'version']
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
        self._seq_id = 0
        self._play_id = 0
        self._record_start = 0.0
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
            if cmd == 'version':
                return {'ok': True, 'version': VERSION, 'cmds': COMMANDS}
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
            if cmd == 'set_send':
                return self._cmd_set_send(msg)
            if cmd == 'load_to_pad':
                return self._cmd_load_to_pad(msg)
            if cmd == 'pad_info':
                return self._cmd_pad_info(msg)
            if cmd == 'arrangement_info':
                return dict(self._arrangement_info(), ok=True)
            if cmd == 'describe_set':
                return self._cmd_describe_set(msg)
            if cmd == 'get_clip_notes':
                return self._cmd_get_clip_notes(msg)
            if cmd == 'play_for':
                return self._cmd_play_for(msg, False)
            if cmd == 'play_scene_for':
                return self._cmd_play_for(msg, True)
            if cmd == 'set_simpler':
                return self._cmd_set_simpler(msg)
            if cmd == 'sample_info':
                track = self._track(msg.get('track', 'selected'))
                index, dev = self._simpler(track)
                return {'ok': True, 'track': track.name, 'device': {'index': index, 'name': dev.name},
                        'sample': self._simpler_state(dev)}
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

    # Live 10 Standard has no Echo / Ping Pong Delay / Simple Delay (10.1 merged the delays
    # into "Delay"; Echo, Operator, Analog, Wavetable... are Suite-only).
    DEVICE_ALIASES = {
        'ping pong delay': 'Delay', 'ping pong': 'Delay', 'simple delay': 'Delay', 'echo': 'Delay',
        'delay': 'Delay', 'eq': 'EQ Eight', 'eq8': 'EQ Eight', 'eq 8': 'EQ Eight', 'comp': 'Compressor',
        'glue': 'Glue Compressor', 'filter': 'Auto Filter', 'autofilter': 'Auto Filter',
        'distortion': 'Overdrive', 'bitcrusher': 'Redux', 'sampler': 'Simpler', 'drumrack': 'Drum Rack',
    }

    def _find_device_item(self, browser, name, max_items=5000, max_depth=6):
        """Returns (item, root_name, searched, how). Preference order:
        exact name & is_device > exact name (shallowest) > alias > case-insensitive > substring
        (device first, then shallowest). Devices beat same-named presets."""
        text = u'%s' % (name,)
        low = text.lower().strip()
        alias = self.DEVICE_ALIASES.get(low)
        wants = [(text, 'exact')]
        if alias and alias.lower() != low:
            wants.append((alias, 'alias'))
        exact = {}      # (want, is_device) -> (item, root, depth)
        ci = {}
        fuzzy = {}
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
                    is_dev = bool(getattr(item, 'is_device', False))
                except Exception:
                    continue
                if loadable:
                    il = iname.lower()
                    stem = il.rsplit('.', 1)[0] if il.endswith(('.adg', '.adv', '.alp', '.wav', '.aif', '.aiff')) else il
                    for want, how in wants:
                        key = (how, is_dev)
                        if iname == want and key not in exact:
                            exact[key] = (item, root_name, depth)
                        elif want.lower() in (il, stem) and key not in ci:
                            ci[key] = (item, root_name, depth)
                        elif low and low in il and key not in fuzzy:
                            fuzzy[key] = (item, root_name, depth)
                if depth < max_depth:
                    try:
                        for child in item.children:
                            queue.append((child, depth + 1))
                    except Exception:
                        pass
        for table, how_base in ((exact, 'exact'), (ci, 'ci'), (fuzzy, 'fuzzy')):
            for want, how in wants:
                for is_dev in (True, False):
                    hit = table.get((how, is_dev))
                    if hit is not None:
                        label = how if how == 'alias' else how_base
                        return hit[0], hit[1], searched, label
        return None, None, searched, None

    def _top_names(self, browser, root_name, limit=60):
        try:
            return [c.name for c in getattr(browser, root_name).children][:limit]
        except Exception:
            return []

    def _cmd_load_device(self, msg):
        track = self._track(msg.get('track', 'selected'))
        name = msg['name']
        browser = Live.Application.get_application().browser
        item, root_name, searched, how = self._find_device_item(browser, name)
        if item is None:
            return {'ok': False, 'error': 'device %r not found in browser roots %r' % (name, searched),
                    'audio_effects': self._top_names(browser, 'audio_effects'),
                    'instruments': self._top_names(browser, 'instruments'),
                    'midi_effects': self._top_names(browser, 'midi_effects')}
        self.song().view.selected_track = track
        before = len(list(track.devices))
        browser.load_item(item)  # appends at the end of the selected track's chain
        devices = list(track.devices)
        if len(devices) <= before:
            return {'ok': False, 'error': 'load_item(%r) did not add a device to %r' % (item.name, track.name),
                    'devices': self._devices(track)}
        dev = devices[-1]
        applied = []
        if how == 'alias' and 'ping pong' in (u'%s' % (name,)).lower() and item.name == 'Delay':
            try:  # Live 10.1 Delay: switch on the Ping Pong mode so the alias sounds as asked
                i, p = self._param(dev, 'Ping Pong')
                p.value = float(p.max)
                applied.append('Ping Pong on')
            except Exception as e:
                self.log_message('ADEHack: ping pong switch failed: %r' % (e,))
        return {'ok': True, 'track': track.name, 'item': item.name, 'uri': item.uri, 'root': root_name,
                'match': how, 'requested': name, 'applied': applied,
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
        return {'ok': True, 'version': VERSION, 'tempo': song.tempo,
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
        self._seq_id += 1          # cancels any running sequence / scheduled stop
        seq_id = self._seq_id
        if msg.get('stop'):
            self._finish_recording('stopped by request')
            return {'ok': True, 'recording': False}
        at_beats, from_bar = self._position_for_record(msg.get('at'))
        self._record_start = at_beats
        try:
            song.loop = False   # a loop brace would wrap the recording back over itself
        except Exception as e:
            self.log_message('ADEHack: loop off failed: %r' % (e,))
        scenes = msg.get('scenes')
        if scenes:
            all_scenes = list(song.scenes)
            steps = []
            for st in scenes:
                index = int(st.get('index', 0))
                bars = float(st.get('bars', 8))
                if index < 0 or index >= len(all_scenes):
                    return {'ok': False, 'error': 'scene index %d out of range (0..%d)' % (index, len(all_scenes) - 1)}
                if bars <= 0:
                    return {'ok': False, 'error': 'bars must be > 0'}
                steps.append({'index': index, 'bars': bars})
            total = sum(st['bars'] for st in steps)
            song.record_mode = True
            self._run_sequence(seq_id, steps, 0, 0.0)
            return {'ok': True, 'recording': True, 'mode': 'scenes', 'tempo': float(song.tempo),
                    'at_beats': at_beats, 'from_bar': from_bar,
                    'total_bars': total, 'steps_scheduled': len(steps),
                    'sequence': [dict(st, at_seconds=self._bars_seconds(sum(x['bars'] for x in steps[:i])))
                                 for i, st in enumerate(steps)],
                    'stops_in_seconds': self._bars_seconds(total)}
        bars = msg.get('bars')
        song.record_mode = True
        song.start_playing()
        reply = {'ok': True, 'recording': True, 'mode': 'bars', 'tempo': float(song.tempo),
                 'at_beats': at_beats, 'from_bar': from_bar}
        if bars:
            seconds = self._bars_seconds(float(bars))
            self.schedule_message(max(1, int(round(seconds * 10.0))), lambda: self._seq_stop(seq_id))
            reply['stops_in_seconds'] = seconds
        return reply

    def _beats_per_bar(self):
        song = self.song()
        try:
            return 4.0 * float(song.signature_numerator) / float(song.signature_denominator)
        except Exception:
            return 4.0

    def _arrangement_info(self):
        song = self.song()
        bpb = self._beats_per_bar()
        info = {'beats_per_bar': bpb}
        try:
            last = float(song.last_event_time)
        except Exception:
            last = 0.0
        info['last_event_time'] = last
        info['bars'] = int(math.ceil(last / bpb - 1e-9)) if last > 0 else 0
        try:
            info['current_song_time'] = float(song.current_song_time)
        except Exception:
            pass
        try:
            info['loop'] = {'on': bool(song.loop), 'start': float(song.loop_start), 'length': float(song.loop_length)}
        except Exception:
            pass
        info['is_playing'] = bool(song.is_playing)
        return info

    def _position_for_record(self, at):
        """'end' = next bar boundary after the last arrangement event (0 if empty),
        'start' = 0, number = beats, None = leave the playhead where it is."""
        song = self.song()
        bpb = self._beats_per_bar()
        if at is None or at == '' or at == 'current':
            try:
                beats = float(song.current_song_time)
            except Exception:
                beats = 0.0
        elif at == 'start':
            beats = 0.0
        elif at == 'end':
            last = float(getattr(song, 'last_event_time', 0.0) or 0.0)
            beats = 0.0 if last <= 0 else math.ceil(last / bpb - 1e-9) * bpb
        else:
            beats = max(0.0, float(at))
        if at is not None and at != '' and at != 'current':
            song.current_song_time = beats
        return beats, int(beats // bpb) + 1

    def _bars_seconds(self, bars):
        return float(bars) * 4.0 * 60.0 / float(self.song().tempo)

    def _run_sequence(self, seq_id, steps, i, elapsed_bars):
        """Fire steps[i] now, schedule the next fire slightly EARLY so Live's launch
        quantization snaps it onto the bar, and the final stop slightly late."""
        if seq_id != self._seq_id:
            return  # replaced by a newer call
        try:
            song = self.song()
            st = steps[i]
            list(song.scenes)[st['index']].fire()
            self.log_message('ADEHack: sequence step %d -> scene %d for %s bars' % (i, st['index'], st['bars']))
            ticks = max(1, int(round(self._bars_seconds(st['bars']) * 10.0)))
            if i + 1 < len(steps):
                self.schedule_message(max(1, ticks - 2),
                                      lambda: self._run_sequence(seq_id, steps, i + 1, elapsed_bars + st['bars']))
            else:
                self.schedule_message(ticks + 1, lambda: self._seq_stop(seq_id))
        except Exception as e:
            self.log_message('ADEHack: sequence error: %r' % (e,))
            self._finish_recording('sequence error %r' % (e,))

    def _seq_stop(self, seq_id):
        if seq_id != self._seq_id:
            return
        self._finish_recording('done')

    def _finish_recording(self, why):
        try:
            song = self.song()
            song.record_mode = False
            song.stop_playing()
            # leave the playhead parked at the end of what was just recorded, Arranger visible
            try:
                last = float(getattr(song, 'last_event_time', 0.0) or 0.0)
                if last > 0:
                    bpb = self._beats_per_bar()
                    song.current_song_time = math.ceil(last / bpb - 1e-9) * bpb
            except Exception as e:
                self.log_message('ADEHack: park playhead failed: %r' % (e,))
            self._show_view('Arranger')
            self.log_message('ADEHack: arrangement recording finished (%s)' % (why,))
        except Exception as e:
            self.log_message('ADEHack: stop recording failed: %r' % (e,))

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

    BROWSE_ROOTS = ('instruments', 'sounds', 'drums', 'audio_effects', 'midi_effects',
                    'user_folders', 'current_project', 'user_library', 'samples', 'packs', 'clips')

    def _cmd_browse(self, msg):
        app = Live.Application.get_application()
        browser = app.browser
        root_name = msg.get('root')
        if root_name and (msg.get('query') is not None or msg.get('depth') is not None
                          or root_name not in self.ROOT_ORDER):
            return self._browse_items(browser, root_name, msg)   # new shape; errors on unknown roots
        result = []
        for name, root in self._roots(browser, msg.get('root')):
            try:
                kids = [c.name for c in root.children][:200]
            except Exception as e:
                kids = ['<error %r>' % (e,)]
            result.append({'root': name, 'name': getattr(root, 'name', ''), 'uri': getattr(root, 'uri', ''), 'children': kids})
        return {'ok': True, 'roots': result}

    def _browse_items(self, browser, root_name, msg):
        """{"cmd":"browse","root":"sounds","query":"bass","depth":2,"limit":200}
        -> {ok, root, items:[{name, is_folder, is_loadable, is_device, path:[...]}]}"""
        if root_name not in self.BROWSE_ROOTS:
            return {'ok': False, 'error': 'unknown root %r; roots: %r' % (root_name, list(self.BROWSE_ROOTS))}
        try:
            roots = self._roots(browser, root_name)
        except Exception as e:
            return {'ok': False, 'error': 'browser.%s unavailable: %r' % (root_name, e)}
        query = (u'%s' % (msg.get('query') or '',)).lower()
        max_depth = max(1, min(6, int(msg.get('depth', 2) or 2)))
        limit = max(1, min(200, int(msg.get('limit', 200) or 200)))
        items, seen, truncated = [], 0, False
        queue = [(root, 1, []) for _, root in roots]
        while queue:
            item, depth, path = queue.pop(0)
            try:
                kids = list(item.children)
            except Exception:
                kids = []
            for child in kids:
                seen += 1
                if seen > 20000:
                    truncated = True
                    break
                try:
                    name = child.name
                    info = {'name': name, 'is_folder': bool(getattr(child, 'is_folder', False)),
                            'is_loadable': bool(getattr(child, 'is_loadable', False)),
                            'is_device': bool(getattr(child, 'is_device', False)), 'path': path}
                except Exception:
                    continue
                if not query or query in name.lower():
                    if len(items) >= limit:
                        truncated = True
                        break
                    items.append(info)
                if depth < max_depth and (info['is_folder'] or not info['is_loadable'] or query):
                    queue.append((child, depth + 1, path + [name]))
            if truncated:
                break
        return {'ok': True, 'root': root_name, 'query': query or None, 'depth': max_depth,
                'count': len(items), 'truncated': truncated, 'items': items}

    # ------------------------------------------------------------ v5.3: Simpler
    SIMPLER_CLASSES = ('OriginalSimpler', 'MultiSampler')
    PLAYBACK_MODES = {'classic': 0, 'oneshot': 1, 'one_shot': 1, 'slice': 2, 'slicing': 2}
    WARP_MODES = {'beats': 0, 'tones': 1, 'texture': 2, 'repitch': 3, 'complex': 4, 'complex_pro': 6}

    def _simpler(self, track, spec=None):
        if spec is not None:
            return self._device(track, spec)
        for i, d in enumerate(track.devices):
            if getattr(d, 'class_name', '') in self.SIMPLER_CLASSES:
                return i, d
        raise ValueError('no Simpler on %r; devices: %r' % (track.name, [d.name for d in track.devices]))

    def _enum_value(self, enum_cls, table, value):
        """Accept 'classic' / 'oneshot' / int; return the Boost enum member when available."""
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            key = (u'%s' % (value,)).lower().replace('-', '_').replace(' ', '_')
            if key not in table:
                raise ValueError('unknown value %r; use one of %r' % (value, sorted(table.keys())))
            value = table[key]
        value = int(value)
        try:
            return enum_cls.values[value]
        except Exception:
            return value

    def _simpler_state(self, dev):
        state = {}
        for attr in ('playback_mode', 'voices', 'retrigger'):
            try:
                v = getattr(dev, attr)
                try:
                    state[attr] = v if isinstance(v, bool) else int(v)
                except Exception:
                    state[attr] = u'%s' % (v,)
            except Exception:
                pass
        try:
            sample = dev.sample
            if sample is None:
                state['sample'] = None
                return state
            for attr in ('file_path', 'length', 'warping', 'warp_mode', 'gain', 'start_marker', 'end_marker',
                         'slicing_style', 'slicing_sensitivity'):
                try:
                    v = getattr(sample, attr)
                    if isinstance(v, (bool, float)) or attr == 'file_path':
                        state[attr] = v if isinstance(v, (bool, float)) else u'%s' % (v,)
                    else:
                        try:
                            state[attr] = int(v)
                        except Exception:
                            state[attr] = u'%s' % (v,)
                except Exception:
                    pass
            try:
                state['slices'] = len(list(sample.slices))
            except Exception:
                pass
        except Exception as e:
            state['sample_error'] = '%r' % (e,)
        try:
            i, p = self._param(dev, 'S Loop On')
            state['loop'] = bool(p.value)
        except Exception:
            pass
        return state

    def _cmd_set_simpler(self, msg):
        track = self._track(msg.get('track', 'selected'))
        index, dev = self._simpler(track, msg.get('device'))
        done, errors = [], {}

        def op(label, fn):
            try:
                fn()
                done.append(label)
            except Exception as e:
                errors[label] = '%s: %s' % (e.__class__.__name__, e)
                self.log_message('ADEHack: set_simpler %s failed: %r' % (label, e))

        if msg.get('mode') is not None:
            op('mode', lambda: setattr(dev, 'playback_mode', self._enum_value(
                Live.SimplerDevice.PlaybackMode, self.PLAYBACK_MODES, msg['mode'])))
        if msg.get('warp') is not None:
            op('warp', lambda: setattr(dev.sample, 'warping', bool(msg['warp'])))
        if msg.get('warp_mode') is not None:
            op('warp_mode', lambda: setattr(dev.sample, 'warp_mode', self._enum_value(
                Live.Clip.WarpMode, self.WARP_MODES, msg['warp_mode'])))
        if msg.get('loop') is not None:
            def set_loop():
                i, p = self._param(dev, 'S Loop On')
                p.value = float(p.max) if msg['loop'] else float(p.min)
            op('loop', set_loop)
        if msg.get('gain_db') is not None:
            op('gain_db', lambda: setattr(dev.sample, 'gain', float(msg['gain_db'])))
        if msg.get('voices') is not None:
            op('voices', lambda: setattr(dev, 'voices', max(1, min(32, int(msg['voices'])))))
        if msg.get('retrigger') is not None:
            op('retrigger', lambda: setattr(dev, 'retrigger', bool(msg['retrigger'])))
        if msg.get('start_marker') is not None or msg.get('end_marker') is not None:
            def set_markers():
                sample = dev.sample
                start = int(msg.get('start_marker', sample.start_marker))
                end = int(msg.get('end_marker', sample.end_marker))
                for order in (('end_marker', 'start_marker'), ('start_marker', 'end_marker')):
                    try:
                        for attr in order:
                            setattr(sample, attr, end if attr == 'end_marker' else start)
                        return
                    except Exception:
                        continue
                raise ValueError('could not set markers %r..%r' % (start, end))
            op('markers', set_markers)
        unknown = [k for k in msg.keys() if k not in ('cmd', 'track', 'device', 'mode', 'warp', 'warp_mode', 'loop',
                                                      'gain_db', 'voices', 'retrigger', 'start_marker', 'end_marker')]
        if unknown:
            errors['unknown_fields'] = '%r' % (unknown,)
        return {'ok': not errors or bool(done), 'track': track.name,
                'device': {'index': index, 'name': dev.name, 'class_name': getattr(dev, 'class_name', '')},
                'done': done, 'errors': errors, 'state': self._simpler_state(dev)}

    # ------------------------------------------------------- v5.6: Drum Rack pads
    def _drum_rack(self, track, spec=None):
        if spec is not None:
            return self._device(track, spec)
        for i, d in enumerate(track.devices):
            if getattr(d, 'class_name', '') == 'DrumGroupDevice' or getattr(d, 'can_have_drum_pads', False):
                return i, d
        return -1, None

    def _ensure_drum_rack(self, track, browser):
        index, rack = self._drum_rack(track)
        if rack is not None:
            return index, rack, False
        item, root_name, searched, how = self._find_device_item(browser, 'Drum Rack')
        if item is None:
            raise ValueError('no Drum Rack in browser roots %r' % (searched,))
        self.song().view.selected_track = track
        before = len(list(track.devices))
        browser.load_item(item)
        devices = list(track.devices)
        if len(devices) <= before:
            raise ValueError('loading Drum Rack onto %r added no device' % (track.name,))
        return len(devices) - 1, devices[-1], True

    def _pad_state(self, pad):
        info = {'note': int(pad.note), 'name': u'%s' % (pad.name,), 'has_chain': False, 'sample': None}
        try:
            info['mute'] = bool(pad.mute)
            info['solo'] = bool(pad.solo)
        except Exception:
            pass
        try:
            chains = list(pad.chains)
        except Exception:
            chains = []
        if chains:
            info['has_chain'] = True
            chain = chains[0]
            info['chain_name'] = u'%s' % (chain.name,)
            try:
                devs = list(chain.devices)
                info['chain_devices'] = [getattr(d, 'class_name', '') or d.name for d in devs]
                for d in devs:
                    if getattr(d, 'class_name', '') in self.SIMPLER_CLASSES:
                        info['sample'] = u'%s' % (d.sample.file_path,) if d.sample is not None else None
                        break
            except Exception as e:
                info['chain_error'] = '%r' % (e,)
        return info

    def _cmd_pad_info(self, msg):
        track = self._track(msg.get('track', 'selected'))
        index, rack = self._drum_rack(track, msg.get('device'))
        if rack is None:
            return {'ok': False, 'error': 'no Drum Rack on %r; devices: %r' % (track.name, [d.name for d in track.devices])}
        pads = []
        for pad in rack.drum_pads:
            try:
                st = self._pad_state(pad)
            except Exception:
                continue
            if st['has_chain'] or msg.get('all'):
                pads.append(st)
        return {'ok': True, 'track': track.name, 'device_index': index, 'device': rack.name,
                'pad_count': len(pads), 'pads': pads}

    def _cmd_load_to_pad(self, msg):
        """Load a sample into one Drum Rack pad. Route (what Push does in its PadHotswapping
        mode): select the rack and the pad, set browser.hotswap_target = pad, load_item(sample).
        Live then creates a Simpler chain in that pad (or replaces the pad's sample)."""
        track = self._track(msg.get('track', 'selected'))
        note = int(msg['note'])
        if note < 0 or note > 127:
            return {'ok': False, 'error': 'note %d out of range 0..127' % (note,)}
        path = msg['path']
        base = os.path.basename(path)
        stem = os.path.splitext(base)[0]
        browser = Live.Application.get_application().browser
        # the sample item first, so a not-indexed file fails before we touch the set
        item, searched = None, []
        for root_name, root in self._roots(browser):
            searched.append('%s:%s' % (root_name, getattr(root, 'name', '')))
            item = self._find_item(root, (base, stem))
            if item is not None:
                break
        if item is None:
            return {'ok': False, 'error': 'not found in Live browser: %r; searched %r. '
                    'Add the output folder via Places > "Add Folder..." in Live.' % (base, searched)}
        song = self.song()
        song.view.selected_track = track
        rack_index, rack, created = self._ensure_drum_rack(track, browser)
        pads = list(rack.drum_pads)
        if note >= len(pads):
            return {'ok': False, 'error': 'rack exposes %d pads, note %d not addressable' % (len(pads), note)}
        pad = pads[note]
        before = self._pad_state(pad)
        observed = []
        try:
            song.view.select_device(rack)
            observed.append('select_device ok')
        except Exception as e:
            observed.append('select_device failed: %r' % (e,))
        try:
            rack.view.selected_drum_pad = pad
            observed.append('selected_drum_pad ok')
        except Exception as e:
            observed.append('selected_drum_pad failed: %r' % (e,))
        route = None
        hot = False
        try:
            browser.hotswap_target = pad
            hot = browser.hotswap_target is not None
            observed.append('hotswap_target=pad %s' % ('accepted' if hot else 'ignored'))
        except Exception as e:
            observed.append('hotswap_target=pad failed: %r' % (e,))
        if not hot and before['has_chain']:
            # fallback: hot-swap the pad's existing Simpler
            try:
                simpler = None
                for d in pad.chains[0].devices:
                    if getattr(d, 'class_name', '') in self.SIMPLER_CLASSES:
                        simpler = d
                        break
                if simpler is not None:
                    browser.hotswap_target = simpler
                    hot = browser.hotswap_target is not None
                    observed.append('hotswap_target=pad simpler %s' % ('accepted' if hot else 'ignored'))
            except Exception as e:
                observed.append('hotswap_target=simpler failed: %r' % (e,))
        route = 'pad_hotswap' if hot else 'plain_load_item'
        devices_before = len(list(track.devices))
        try:
            browser.load_item(item)
            observed.append('load_item ok')
        finally:
            if hot:
                try:
                    browser.hotswap_target = None
                except Exception as e:
                    observed.append('leave hotswap failed: %r' % (e,))
        after = self._pad_state(pad)
        appended = len(list(track.devices)) - devices_before
        if msg.get('name') and after['has_chain']:
            try:
                pad.chains[0].name = u'%s' % (msg['name'],)
                after = self._pad_state(pad)
            except Exception as e:
                observed.append('chain rename failed: %r' % (e,))
        landed = after['has_chain'] and (after.get('sample') or '').lower().endswith(stem.lower() + os.path.splitext(base)[1].lower()) \
            or (after['has_chain'] and after.get('sample') != before.get('sample'))
        reply = {'ok': bool(landed), 'track': track.name, 'note': note, 'route': route,
                'device_index': rack_index, 'rack_created': created, 'pad': after,
                'devices_appended_to_track': appended, 'observed': observed, 'item': item.name}
        if not landed:
            reply['error'] = ('sample did not land in pad %d (route %s); pad before=%r after=%r; '
                              '%d device(s) appended to the track instead' % (note, route, before, after, appended))
        return reply

    # ------------------------------------------------------- v5.4: read the set
    NOTE_PREVIEW = 16
    NOTE_CAP = 2000
    CLIP_SLOT_CAP = 16

    def _clip_notes(self, clip, cap):
        """Live 10: Clip.get_notes(from_time, from_pitch, time_span, pitch_span) ->
        ((pitch, time, duration, velocity, muted), ...)."""
        try:
            length = float(clip.length)
        except Exception:
            length = 0.0
        span = max(length, float(getattr(clip, 'loop_end', 0) or 0), 1.0) + 1.0
        try:
            raw = clip.get_notes(0.0, 0, span, 128)
        except Exception as e:
            self.log_message('ADEHack: get_notes failed: %r' % (e,))
            return [], 0, length
        notes = []
        for n in raw:
            if len(notes) >= cap:
                break
            try:
                notes.append({'pitch': int(n[0]), 'start': round(float(n[1]), 4), 'duration': round(float(n[2]), 4),
                              'velocity': int(n[3]), 'mute': bool(n[4]) if len(n) > 4 else False})
            except Exception:
                continue
        notes.sort(key=lambda x: (x['start'], x['pitch']))
        return notes, len(raw), length

    def _describe_clip(self, slot_index, slot):
        clip = slot.clip
        info = {'slot': slot_index}
        for attr, key in (('name', 'name'), ('length', 'length'), ('is_playing', 'is_playing'),
                          ('is_triggered', 'is_triggered'), ('looping', 'looping'), ('color_index', 'color_index')):
            try:
                v = getattr(clip, attr)
                info[key] = v if isinstance(v, (bool, float)) else (u'%s' % (v,) if key == 'name' else int(v))
            except Exception:
                pass
        is_midi = bool(getattr(clip, 'is_midi_clip', True))
        info['is_audio'] = not is_midi
        if is_midi:
            notes, total, _ = self._clip_notes(clip, self.NOTE_PREVIEW)
            info['note_count'] = total
            info['notes_preview'] = notes
        else:
            try:
                info['file_path'] = u'%s' % (clip.file_path,)
            except Exception:
                info['file_path'] = None
            for attr in ('warping', 'gain'):
                try:
                    info[attr] = getattr(clip, attr)
                except Exception:
                    pass
        return info

    def _describe_track(self, i, t, sel):
        info = {'index': i, 'name': t.name, 'is_midi': bool(t.has_midi_input), 'selected': t == sel}
        try:
            info['color_index'] = int(t.color_index)
        except Exception:
            pass
        try:
            info['is_group'] = bool(getattr(t, 'is_foldable', False))
            info['group_track'] = t.group_track.name if getattr(t, 'is_grouped', False) and t.group_track else None
        except Exception:
            pass
        try:
            mixer = self._mixer_state(t)
            try:
                mixer['sends'] = [{'index': k, 'name': sp.name, 'level': float(sp.value)}
                                  for k, sp in enumerate(t.mixer_device.sends)]
            except Exception:
                mixer['sends'] = []
            info['mixer'] = mixer
        except Exception as e:
            info['mixer_error'] = '%r' % (e,)
        devices = []
        try:
            for k, d in enumerate(t.devices):
                dev = {'index': k, 'name': d.name, 'class_name': getattr(d, 'class_name', ''),
                       'type': int(getattr(d, 'type', 0) or 0)}
                try:
                    dev['is_active'] = bool(d.is_active)
                except Exception:
                    pass
                if dev['class_name'] in self.SIMPLER_CLASSES:
                    try:
                        dev['sample'] = u'%s' % (d.sample.file_path,) if d.sample is not None else None
                    except Exception:
                        pass
                devices.append(dev)
        except Exception as e:
            info['devices_error'] = '%r' % (e,)
        info['devices'] = devices
        info['has_sound'] = any(d['type'] == 1 or d['class_name'] in self.SIMPLER_CLASSES
                                or d['class_name'] in self.INSTRUMENT_CLASSES for d in devices) or not info['is_midi']
        clips = []
        try:
            for k, slot in enumerate(t.clip_slots):
                if slot.has_clip:
                    clips.append(self._describe_clip(k, slot))
                    if len(clips) >= self.CLIP_SLOT_CAP:
                        break
        except Exception as e:
            info['clips_error'] = '%r' % (e,)
        info['clips'] = clips
        return info

    def _cmd_describe_set(self, msg):
        song = self.song()
        sel = song.view.selected_track
        out = {'ok': True, 'version': VERSION, 'tempo': float(song.tempo), 'is_playing': bool(song.is_playing)}
        try:
            out['loop'] = {'on': bool(song.loop), 'start': float(song.loop_start), 'length': float(song.loop_length)}
        except Exception:
            pass
        try:
            out['signature'] = '%d/%d' % (int(song.signature_numerator), int(song.signature_denominator))
        except Exception:
            pass
        try:
            out['current_song_time'] = float(song.current_song_time)
        except Exception:
            pass
        scenes = list(song.scenes)
        out['scenes'] = [{'index': k, 'name': sc.name} for k, sc in enumerate(scenes)]
        try:
            ss = song.view.selected_scene
            out['selected_scene'] = {'index': scenes.index(ss), 'name': ss.name}
        except Exception:
            out['selected_scene'] = None
        out['selected_track'] = {'index': self._index_of(sel), 'name': sel.name}
        tracks = []
        for i, t in enumerate(song.tracks):
            try:
                tracks.append(self._describe_track(i, t, sel))
            except Exception as e:
                tracks.append({'index': i, 'name': getattr(t, 'name', '?'), 'error': '%r' % (e,)})
        out['tracks'] = tracks
        try:
            out['returns'] = [{'index': k, 'name': r.name, 'volume': float(r.mixer_device.volume.value)}
                              for k, r in enumerate(song.return_tracks)]
        except Exception:
            out['returns'] = []
        try:
            out['master'] = {'volume': float(song.master_track.mixer_device.volume.value)}
        except Exception:
            out['master'] = None
        try:
            out['transport'] = self._transport_state()
        except Exception:
            pass
        return out

    def _cmd_get_clip_notes(self, msg):
        track = self._track(msg.get('track', 'selected'))
        slot_index = int(msg.get('slot', 0))
        slot = track.clip_slots[slot_index]
        if not slot.has_clip:
            return {'ok': False, 'error': 'no clip in %s slot %d' % (track.name, slot_index)}
        clip = slot.clip
        if not getattr(clip, 'is_midi_clip', True):
            return {'ok': False, 'error': 'slot %d on %s holds an audio clip' % (slot_index, track.name)}
        notes, total, length = self._clip_notes(clip, self.NOTE_CAP)
        return {'ok': True, 'track': track.name, 'slot': slot_index, 'name': u'%s' % (clip.name,),
                'length': length, 'note_count': total, 'truncated': total > len(notes), 'notes': notes}

    def _cmd_play_for(self, msg, scene):
        song = self.song()
        seconds = max(0.1, float(msg.get('seconds', 8)))
        self._play_id += 1          # cancels any pending timed stop
        play_id = self._play_id
        reply = {'ok': True, 'stops_in_seconds': seconds}
        if scene:
            scenes = list(song.scenes)
            index = int(msg.get('index', 0))
            if index < 0 or index >= len(scenes):
                return {'ok': False, 'error': 'scene index %d out of range (0..%d)' % (index, len(scenes) - 1)}
            scenes[index].fire()
            reply['scene'] = {'index': index, 'name': scenes[index].name}
        else:
            song.start_playing()
        self.schedule_message(max(1, int(round(seconds * 10.0))), lambda: self._timed_stop(play_id))
        return reply

    def _timed_stop(self, play_id):
        if play_id != self._play_id:
            return
        try:
            self.song().stop_playing()
            self.log_message('ADEHack: timed playback stopped')
        except Exception as e:
            self.log_message('ADEHack: timed stop failed: %r' % (e,))

    def _cmd_set_send(self, msg):
        track = self._track(msg.get('track', 'selected'))
        sends = list(track.mixer_device.sends)
        spec = msg.get('send', 'A')
        index = None
        if isinstance(spec, (int, float)) and not isinstance(spec, bool):
            index = int(spec)
        else:
            text = u'%s' % (spec,)
            if text.isdigit():
                index = int(text)
            elif len(text) == 1 and text.isalpha():
                index = ord(text.upper()) - ord('A')
            else:
                for i, p in enumerate(sends):
                    if p.name.lower() == text.lower() or p.name.lower().endswith(' ' + text.lower()):
                        index = i
                        break
        if index is None or index < 0 or index >= len(sends):
            return {'ok': False, 'error': 'no send %r on %r (has %d sends: %r)'
                    % (spec, track.name, len(sends), [p.name for p in sends])}
        p = sends[index]
        if msg.get('level') is not None:
            p.value = max(float(p.min), min(float(p.max), float(msg['level'])))
        return {'ok': True, 'track': track.name,
                'sends': [{'index': i, 'name': sp.name, 'level': float(sp.value)} for i, sp in enumerate(sends)]}

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
