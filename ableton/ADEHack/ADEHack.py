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


def _to_bytes(s):
    return s if isinstance(s, bytes) else s.encode('utf-8')


class ADEHack(ControlSurface):

    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._server = None
        self._clients = []  # list of [socket, bytes_buffer]
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
                    self._send(conn, self._handle_line(line))

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
    def _handle_line(self, line):
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
                return self._cmd_load_sample(msg)
            if cmd == 'browse':
                return self._cmd_browse(msg)
            return {'ok': False, 'error': 'unknown cmd: %r' % (cmd,)}
        except Exception as e:
            self.log_message('ADEHack: error: %r' % (e,))
            return {'ok': False, 'error': '%s: %s' % (e.__class__.__name__, e)}

    def _track(self, spec):
        song = self.song()
        if spec is None or spec == 'selected':
            return song.view.selected_track
        return song.tracks[int(spec)]

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
        if slot.has_clip:
            slot.delete_clip()
        slot.create_clip(length)
        clip = slot.clip
        tup = tuple((int(n['pitch']), float(n['start']), float(n['duration']),
                     int(n.get('velocity', 100)), False) for n in notes)
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
        if msg.get('fire'):
            slot.fire()
        return {'ok': True, 'track': track.name, 'slot': int(slot_index), 'notes': len(tup)}

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

    def _cmd_load_sample(self, msg):
        path = msg['path']
        base = os.path.basename(path)
        stem = os.path.splitext(base)[0]
        app = Live.Application.get_application()
        browser = app.browser
        searched = []
        found = None
        for name, root in self._roots(browser):
            searched.append('%s:%s' % (name, getattr(root, 'name', '')))
            found = self._find_item(root, (base, stem))
            if found is not None:
                break
        if found is None:
            return {'ok': False, 'error': 'not found in Live browser: %r; searched %r. '
                    'Add the output folder via Places > "Add Folder..." in Live.' % (base, searched)}
        if msg.get('track') not in (None, 'selected'):
            self.song().view.selected_track = self._track(msg['track'])
        browser.load_item(found)
        return {'ok': True, 'item': found.name, 'uri': found.uri, 'root': searched[-1]}

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
