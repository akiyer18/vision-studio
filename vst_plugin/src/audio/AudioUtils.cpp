#include "AudioUtils.h"

namespace app {

AudioIO::AudioIO()
{
    formatManager.registerBasicFormats();
}

DecodedAudio AudioIO::read (const File& file)
{
    DecodedAudio out;

    if (! file.existsAsFile())
    {
        out.error = "File does not exist: " + file.getFileName();
        return out;
    }

    auto reader = std::unique_ptr<AudioFormatReader> (formatManager.createReaderFor (file));
    if (reader == nullptr)
    {
        out.error = "Unsupported audio format: " + file.getFileName();
        return out;
    }

    out.buffer = AudioBuffer<float> (jmax (1, (int) reader->numChannels),
                                     jmax (1, (int) reader->lengthInSamples));
    reader->read (&out.buffer, 0, (int) reader->lengthInSamples, 0, true, true);
    out.sampleRate = reader->sampleRate;
    out.ok = true;
    return out;
}

DecodedAudio AudioIO::decode (const MemoryBlock& bytes)
{
    DecodedAudio out;

    if (bytes.isEmpty())
    {
        out.error = "No audio bytes to decode";
        return out;
    }

    std::unique_ptr<InputStream> stream (new MemoryInputStream (bytes, false));
    auto reader = std::unique_ptr<AudioFormatReader> (formatManager.createReaderFor (std::move (stream)));
    if (reader == nullptr)
    {
        out.error = "Could not decode returned audio";
        return out;
    }

    out.buffer = AudioBuffer<float> (jmax (1, (int) reader->numChannels),
                                     jmax (1, (int) reader->lengthInSamples));
    reader->read (&out.buffer, 0, (int) reader->lengthInSamples, 0, true, true);
    out.sampleRate = reader->sampleRate;
    out.ok = true;
    return out;
}

MemoryBlock AudioIO::encodeWav (const AudioBuffer<float>& buffer, double sampleRate)
{
    MemoryBlock out;

    auto* wav = formatManager.findFormatForFileExtension ("wav");
    if (wav == nullptr)
        return out;

    // Write to a temporary file, then read it back into a memory block.
    File tempFile = File::getSpecialLocation (File::tempDirectory).getChildFile ("ADE Hack encode.wav");
    tempFile.getParentDirectory().createDirectory();

    OutputStream* fos = new FileOutputStream (tempFile);
    auto writer = std::unique_ptr<AudioFormatWriter> (
        wav->createWriterFor (fos, sampleRate, (unsigned int) jmax (1, buffer.getNumChannels()), 16, {}, 0));
    if (writer == nullptr)
        return out;

    writer->writeFromAudioSampleBuffer (buffer, 0, buffer.getNumSamples());
    writer.reset();

    MemoryBlock mb;
    tempFile.loadFileAsData (mb);
    out = mb;
    tempFile.deleteFile();
    return out;
}

} // namespace app
