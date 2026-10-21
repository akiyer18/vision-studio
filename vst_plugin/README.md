# ADE Hack VST — AI producing assistant plugin

A JUCE-based audio plugin (VST3 + AU) that brings the Stability AI + Gemini music-production
workflow.

Built with C++17 + JUCE 8.0.15.

## Tabs

| Tab | What it does |
|-----|--------------|
| **Settings** | Enter your Stability AI API key, Gemini API key, Gemini model, optional Hugging Face token (Flamingo) and optional Soundcharts API key. Choose the export folder where "send to DAW" writes `.wav` + `.mid` files. |
| **Create from scratch** | Generate a sound from a text prompt **or** from a prompt + optional reference sound (text + sound simultaneously). Record mic for 7s to initiate a sound with ambiente + high 0.95 strength, using a basic prompt with BPM and melodic/rhythmic choice. Play back the result. |
| **Analyse track** | Load a track (path) or capture audio from the DAW input. Dropdown: advanced tech breakdown? (yes → Flamingo). Analyse with Gemini ("genre, tempo, and key … instruments, production style, mood"). Suggest improvements with Gemini. |
| **Generate alternatives** | Generate 3 Stable Audio variations of the analysed track. For each alternative: play button + "Compare with original" using the Gemini "music production explainer" prompt. |
| **Find references** | Genre history + suggested artists to listen to (Soundcharts API). References ranked by popularity, with geolocation (where the genre is strongest) and recent trends. Separate "Find references" button. |
| **Tweak sample** | Load a sample, apply a tweak prompt + strength via Stable Audio audio-to-audio. For each generated track: "Send to DAW" exports `.wav` + dissected `.mid` (drums/bass/chords/lead on MIDI channels 10/2/3/4) and plays the MIDI out so the DAW can record it. |
| **Carry on** | Generates how the selected track can develop further (production advice only — no audio artifacts rebuilt). |

## Build

Requirements: CMake 3.22+, a C++17 compiler (gcc/clang), and the JUCE dependencies. On Linux the GUI build needs X11, FreeType, Fontconfig, GL and ALSA development files.

From `vst_plugin/`:

```bash
# 1-point configure (JUCE is fetched automatically from GitHub)
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_PREFIX_PATH=/path/to/conda \
      -DCMAKE_INCLUDE_PATH=/path/to/conda/include \
      -DCMAKE_LIBRARY_PATH=/path/to/conda/lib

# Build (use -j2 on RAM-constrained machines)
cmake --build build -j2
```

Output:
- `build/ADEHack_artefacts/Release/VST3/ADE Hack.vst3`
- `build/ADEHack_artefacts/Release/AU/ADE Hack.component` (macOS only)
- `build/ADEHack_artefacts/Release/Standalone/ADE Hack`

### Linux dependency notes (this environment)

The build here used conda-forge to supply the headers/libs JUCE needs on Linux:

```bash
conda install -c conda-forge pkg-config libx11 libxext libxrender libxrandr \
              libxinerama libxcursor libxi libxfixes libxcomposite libxdamage \
              libxxf86vm libglvnd freetype fontconfig alsa-lib
```

and the build was invoked with:

```bash
export CPLUS_INCLUDE_PATH="$HOME/miniconda3/include:$HOME/miniconda3/include/freetype2"
export LIBRARY_PATH="$HOME/miniconda3/lib"
export PKG_CONFIG_PATH="$HOME/miniconda3/lib/pkgconfig"
export LD_LIBRARY_PATH="$HOME/miniconda3/lib"
```

## Installing in a DAW

- **Ableton Live / FL Studio**: copy `ADE Hack.vst3` into your VST3 plug-ins folder and rescan.
  - Windows: `%USERPROFILE%\AppData\Roaming\Ableton\VST3` or Image-Line/VST3
  - macOS: `~/Library/Audio/Plug-Ins/VST3/`
- **Logic Pro**: Logic only loads Audio Units. On macOS, the `ADE Hack.component` (AU) build is what Logic will see — copy it to `~/Library/Audio/Plug-Ins/Components/`.

> Note: VST3 is supported by Ableton Live and FL Studio. Logic Pro does **not** support VST/VST3; it requires AU. Both formats are produced from the same C++ source (set `FORMATS VST3 AU Standalone` in `CMakeLists.txt` — already the default here).

## "Send to DAW"

The plugin cannot directly insert clips into a DAW arrangement (VST3/AU have no such API). Instead, "send to DAW":
1. Dissects the generated audio into pitched (bass/chords/lead) and percussive (drums) MIDI using a built-in pitch/onset detector.
2. Writes `<name>_<n>.wav` and `<name>_<n>.mid` to the export folder set in Settings (default: `~/ADE Hack`).
3. Emits the dissected MIDI from the plugin's MIDI output so the DAW can record it onto a track (record-arm a MIDI track receiving the plugin's MIDI output).

The `.mid` uses MIDI channels 10 (drums), 2 (bass), 3 (chords), 4 (lead) so the DAW can split them into separate tracks.

## API keys

The plugin never embeds keys. Enter them in the **Settings** tab; they are stored locally (outside any DAW project file) and never saved into a shared `.als`/`.flp`.

- Stability AI: `sk-...` key from https://platform.stability.ai (used for Stable Audio 3.0 text/audio-to-audio).
- Gemini: key from https://aistudio.google.com (used for track analysis, improvements, variation comparison, genre references).
- Hugging Face (optional): token for Music Flamingo advanced breakdown.
- Soundcharts (optional): key for artist/reference lookup.

## Limitations & notes

- The built-in pitch/onset → MIDI dissection works best for melodic/monophonic material; full polyphonic lo-fi beats are approximated.
- Stable Audio 3.0 is asynchronous: generations return an id and are polled until complete (each costs 8 credits).
- Audio-to-audio requires the input to be 6–380 seconds.
- `createPluginFilter()` is the plugin entry point; the plugin identifies as an instrument (`isSynth`) so it can emit MIDI to the DAW.
- This is a headless Linux build of the VST3; the AU binary is produced on macOS hosts.

## Credits

Mirrors the prompts and API clients from the ADE Hack web app (`lib/stability.js`, `lib/ears.js`, `lib/analyse.js`, `lib/tweak.js`). Built with JUCE 8.0.15.