#include "SettingsStore.h"

namespace app {

namespace
{
    const char* const kStabilityKey  = "stabilityApiKey";
    const char* const kGeminiKey     = "geminiApiKey";
    const char* const kGeminiModel   = "geminiModel";
    const char* const kHuggingFace   = "huggingFaceToken";
    const char* const kSoundcharts   = "soundchartsApiKey";
    const char* const kExportFolder  = "exportFolder";

    File defaultExportFolder()
    {
        // Matches the ADE Hack web app: a folder the user can add as a DAW "Place".
        #if JUCE_WINDOWS
        auto music = File::getSpecialLocation (File::userDocumentsDirectory).getChildFile ("ADE Hack");
        #elif JUCE_MAC
        auto music = File::getSpecialLocation (File::userMusicDirectory).getChildFile ("ADE Hack");
        #else
        auto music = File::getSpecialLocation (File::userHomeDirectory).getChildFile ("ADE Hack");
        #endif
        return music;
    }
}

SettingsStore::SettingsStore()
{
    PropertiesFile::Options opts;
    opts.applicationName  = "ADE Hack";
    opts.filenameSuffix   = ".settings";
    opts.folderName       = "ADE Hack";
    opts.osxLibrarySubFolder = "Application Support";
    props = std::make_unique<PropertiesFile> (getSettingsFile(), opts);
}

SettingsStore::~SettingsStore() = default;

File SettingsStore::getSettingsFile() const
{
    auto dir = File::getSpecialLocation (File::userApplicationDataDirectory).getChildFile ("ADE Hack");
    dir.createDirectory();
    return dir.getChildFile ("ADEHack.settings");
}

ApiKeys SettingsStore::getKeys() const
{
    ApiKeys k;
    k.stability   = props->getValue (kStabilityKey).trim();
    k.gemini      = props->getValue (kGeminiKey).trim();
    k.geminiModel = props->getValue (kGeminiModel, "gemini-2.5-flash");
    k.huggingFace = props->getValue (kHuggingFace).trim();
    k.soundcharts = props->getValue (kSoundcharts).trim();
    return k;
}

void SettingsStore::setKeys (const ApiKeys& keys)
{
    props->setValue (kStabilityKey, keys.stability.trim());
    props->setValue (kGeminiKey,    keys.gemini.trim());
    props->setValue (kGeminiModel,  keys.geminiModel);
    props->setValue (kHuggingFace,  keys.huggingFace.trim());
    props->setValue (kSoundcharts,  keys.soundcharts.trim());
    props->saveIfNeeded();
}

File SettingsStore::getExportFolder() const
{
    auto stored = props->getValue (kExportFolder);
    if (stored.isNotEmpty() && File (stored).isDirectory())
        return File (stored);
    return defaultExportFolder();
}

void SettingsStore::setExportFolder (const File& folder)
{
    props->setValue (kExportFolder, folder.getFullPathName());
    props->saveIfNeeded();
}

} // namespace app
