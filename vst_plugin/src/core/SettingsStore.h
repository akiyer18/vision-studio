#pragma once

#include <JuceHeader.h>
#include "PluginState.h"

namespace app {

// Persists API keys and preferences to disk (outside the DAW project so keys
// are never saved into a shared .als/.flp file).
class SettingsStore
{
public:
    SettingsStore();
    ~SettingsStore();

    ApiKeys getKeys() const;
    void    setKeys (const ApiKeys& keys);

    File    getExportFolder() const;
    void    setExportFolder (const File& folder);

private:
    File getSettingsFile() const;
    std::unique_ptr<PropertiesFile> props;
};

} // namespace app
