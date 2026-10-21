# ADE Hack VST — AI producing assistant plugin (VST3 + AU + Standalone)
#
# Build (from vst_plugin/):
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release -j
#
# Output:
#   VST3  -> build/ADEHack_artefacts/Release/VST3/ADEHack.vst3
#   AU    -> build/ADEHack_artefacts/Release/AU/ADEHack.component   (macOS only)
#   Standalone -> build/ADEHack_artefacts/Release/Standalone/ADEHack
#
# VST3 loads in Ableton Live + FL Studio; AU (macOS only) loads in Logic Pro.
# Both are built from the same C++ source.

cmake_minimum_required(VERSION 3.22)
project(ADEHackVST VERSION 1.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ---------------------------------------------------------------------------
# JUCE (fetched from source so the plugin builds anywhere)
# ---------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.15
  GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(JUCE)

# ---------------------------------------------------------------------------
# Plugin target
# ---------------------------------------------------------------------------
juce_add_plugin(ADEHack
  COMPANY_NAME             "ADE Hack"
  COMPANY_COPYRIGHT        "(c) 2026 ADE Hack"
  PLUGIN_MANUFACTURER_CODE Adeh
  PLUGIN_CODE              Adh1
  FORMATS                  VST3 AU Standalone
  PRODUCT_NAME             "ADE Hack"
  DESCRIPTION              "AI producing assistant: Stability audio + Gemini/Flamingo analysis"
  NEEDS_CURL               TRUE
  IS_SYNTH                 TRUE          # instrument: can emit MIDI to the DAW
  IS_MIDI_EFFECT           FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD  FALSE
)

juce_generate_juce_header(ADEHack)

target_sources(ADEHack PRIVATE
  src/PluginProcessor.cpp
  src/PluginEditor.cpp
  src/core/SettingsStore.cpp
  src/api/StabilityClient.cpp
  src/api/GeminiClient.cpp
  src/api/FlamingoClient.cpp
  src/api/SoundchartsClient.cpp
  src/audio/AudioUtils.cpp
  src/audio/PitchOnset.cpp
  src/audio/MidiDissector.cpp
  src/ui/Widgets.cpp
  src/ui/SettingsTab.cpp
  src/ui/CreateFromScratchTab.cpp
  src/ui/AnalyseTrackTab.cpp
  src/ui/GenerateAlternativesTab.cpp
  src/ui/FindReferencesTab.cpp
  src/ui/TweakSampleTab.cpp
  src/ui/CarryOnTab.cpp
)

target_include_directories(ADEHack PRIVATE src)

target_compile_definitions(ADEHack PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=1
  JUCE_VST3_CAN_REPLACE_VST2=0
  JUCE_DISPLAY_SPLASH_SCREEN=0
  JUCE_REPORT_APP_USAGE=0
  JUCE_DISABLE_JUCE_VERSION_PRAGMAS=1
)

target_link_libraries(ADEHack PRIVATE
  juce::juce_audio_utils
  juce::juce_audio_processors
  juce::juce_dsp
  juce::juce_gui_extra
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags
)

if(UNIX AND NOT APPLE)
    target_link_libraries(ADEHack PRIVATE asound)
endif()
