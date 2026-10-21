#include "PitchOnset.h"

namespace app {

namespace
{
    const double kMinFreq = 50.0;
    const double kMaxFreq = 1200.0;
    const double kPitchThreshold = 0.45;

    double freqToMidi (double f) { return f > 0 ? 69.0 + 12.0 * std::log2 (f / 440.0) : 0.0; }

    void applyHanning (float* data, int n)
    {
        for (int i = 0; i < n; ++i)
        {
            double w = 0.5 * (1.0 - std::cos (2.0 * MathConstants<double>::pi * i / (n - 1)));
            data[i] *= (float) w;
        }
    }
}

PitchOnsetDetector::PitchOnsetDetector (int order, int hop)
    : fftOrder (order), hopSize (hop)
{
    fftSize = 1 << fftOrder;
    if (fftSize < 512) fftSize = 512;
}

double PitchOnsetDetector::detectPitch (const float* frame, double sampleRate)
{
    juce::dsp::FFT fft (fftOrder);
    const int n = fft.getSize();
    if (n < 512)
        return 0.0;

    std::vector<float> td (n * 2, 0.0f);
    for (int i = 0; i < jmin (fftSize, n); ++i)
        td[i] = frame[i];

    applyHanning (td.data(), jmin (fftSize, n));

    fft.performRealOnlyForwardTransform (td.data());

    // Power spectrum -> autocorrelation via inverse FFT.
    for (int i = 0; i < n; i += 2)
    {
        float re = td[i], im = td[i + 1];
        td[i]     = re * re + im * im;
        td[i + 1] = 0.0f;
    }

    fft.performRealOnlyInverseTransform (td.data());

    double norm = td[0];
    if (norm <= 1e-9)
        return 0.0;

    int minLag = jmax (1, (int) (sampleRate / kMaxFreq));
    int maxLag = jmin (n / 2 - 1, (int) (sampleRate / kMinFreq));
    if (maxLag <= minLag)
        return 0.0;

    double best = -1.0;
    int bestLag = 0;
    for (int lag = minLag; lag <= maxLag; ++lag)
    {
        double v = td[lag] / norm;
        if (v > best)
        {
            best = v;
            bestLag = lag;
        }
    }

    if (best < kPitchThreshold || bestLag <= 0)
        return 0.0;

    // Parabolic interpolation for sub-sample accuracy.
    if (bestLag > 1 && bestLag < maxLag)
    {
        double s0 = td[bestLag - 1] / norm;
        double s1 = td[bestLag] / norm;
        double s2 = td[bestLag + 1] / norm;
        double denom = (2.0 * s1 - s2 - s0);
        if (std::abs (denom) > 1e-9)
        {
            double shift = (s2 - s0) / (2.0 * denom);
            return sampleRate / (bestLag + jlimit (-0.5, 0.5, shift));
        }
    }

    return sampleRate / bestLag;
}

void PitchOnsetDetector::analyse (const AudioBuffer<float>& buffer, double sampleRate)
{
    notes.clear();
    onsets.clear();
    tempoBpm = 0.0;

    const int numSamples = buffer.getNumSamples();
    if (numSamples < fftSize)
        return;

    // Mono mixdown.
    std::vector<float> mono (numSamples);
    for (int i = 0; i < numSamples; ++i)
    {
        float s = 0.0f;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            s += buffer.getSample (ch, i);
        mono[i] = s / jmax (1, buffer.getNumChannels());
    }

    const int numFrames = (numSamples - fftSize) / hopSize + 1;
    if (numFrames < 2)
        return;

    std::vector<double> pitchTrack (numFrames, 0.0);
    std::vector<double> rmsTrack (numFrames, 0.0);
    std::vector<float>  flux (numFrames, 0.0f);
    std::vector<float>  prevMag (fftSize / 2 + 1, 0.0f);

    juce::dsp::FFT fft (fftOrder);
    const int n = fft.getSize();
    std::vector<float> td (n * 2, 0.0f);

    for (int f = 0; f < numFrames; ++f)
    {
        const int start = f * hopSize;

        // RMS
        double energy = 0.0;
        for (int i = 0; i < fftSize; ++i)
            energy += (double) mono[start + i] * mono[start + i];
        rmsTrack[f] = std::sqrt (energy / fftSize);

        // Pitch
        std::vector<float> frame (fftSize);
        for (int i = 0; i < fftSize; ++i)
            frame[i] = mono[start + i];
        pitchTrack[f] = detectPitch (frame.data(), sampleRate);

        // Spectral magnitude (for flux)
        std::fill (td.begin(), td.end(), 0.0f);
        for (int i = 0; i < jmin (fftSize, n); ++i)
            td[i] = mono[start + i];
        applyHanning (td.data(), jmin (fftSize, n));
        fft.performRealOnlyForwardTransform (td.data());

        float fluxVal = 0.0f;
        for (int b = 0; b <= n / 2; ++b)
        {
            float re = td[b * 2], im = td[b * 2 + 1];
            float mag = std::sqrt (re * re + im * im);
            float diff = mag - prevMag[b];
            if (diff > 0.0f)
                fluxVal += diff;
            prevMag[b] = mag;
        }
        flux[f] = fluxVal;
    }

    // ---- Onsets ----
    const int window = 8;
    for (int i = window; i + window < numFrames; ++i)
    {
        double localMean = 0.0;
        for (int k = -window; k <= window; ++k)
            localMean += flux[i + k];
        localMean /= (2 * window + 1);

        bool peak = true;
        for (int k = -window; k <= window; ++k)
        {
            if (k == 0) continue;
            if (flux[i + k] > flux[i]) { peak = false; break; }
        }

        if (peak && flux[i] > localMean * 1.5 && flux[i] > 0.01f)
        {
            OnsetEvent e;
            e.timeSec  = (double) (i * hopSize) / sampleRate;
            e.strength = flux[i];
            onsets.add (e);
        }
    }

    // ---- Tempo estimate from onset intervals ----
    if (onsets.size() >= 4)
    {
        Array<double> intervals;
        for (int i = 1; i < onsets.size(); ++i)
        {
            double dt = onsets[i].timeSec - onsets[i - 1].timeSec;
            if (dt > 0.2 && dt < 2.0)
                intervals.add (dt);
        }
        if (! intervals.isEmpty())
        {
            intervals.sort();
            double median = intervals[intervals.size() / 2];
            double bpm = 60.0 / median;
            while (bpm < 70.0)  bpm *= 2.0;
            while (bpm > 180.0) bpm *= 0.5;
            tempoBpm = bpm;
        }
    }

    // ---- Notes: segment by onset, take the strongest pitch in each segment ----
    for (int i = 0; i < onsets.size(); ++i)
    {
        double start = onsets[i].timeSec;
        double end   = (i + 1 < onsets.size()) ? onsets[i + 1].timeSec
                                               : (double) numSamples / sampleRate;

        int fStart = (int) (start * sampleRate / hopSize);
        int fEnd   = (int) (end   * sampleRate / hopSize);
        fStart = jlimit (0, numFrames - 1, fStart);
        fEnd   = jlimit (0, numFrames - 1, jmax (fStart + 1, fEnd));

        double bestPitch = 0.0, bestEnergy = 0.0;
        double totalEnergy = 0.0;
        for (int f = fStart; f <= fEnd; ++f)
        {
            totalEnergy += rmsTrack[f];
            if (pitchTrack[f] > 0.0 && rmsTrack[f] > bestEnergy)
            {
                bestEnergy = rmsTrack[f];
                bestPitch  = pitchTrack[f];
            }
        }

        NoteEvent note;
        note.onsetSec    = start;
        note.durationSec = end - start;
        note.freqHz      = bestPitch;
        note.midi        = freqToMidi (bestPitch);
        note.velocity    = jlimit (0.0, 1.0, totalEnergy / jmax (1, fEnd - fStart + 1) * 2.0);
        note.percussive  = false;
        notes.add (note);
    }
}

} // namespace app
