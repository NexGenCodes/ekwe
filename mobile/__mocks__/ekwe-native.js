// __mocks__/ekwe-native.js

export const extract_audio_and_waveform = jest.fn(async (uri) => {
  return {
    waveform: new Array(60).fill(0.01), // Dummy waveform
    pcmData: new Float32Array(1024).fill(0), // Dummy PCM data
    durationMs: 1000,
  };
});

export const encodePcmToFlacJNI = jest.fn(async (pcmData, outUri) => {
  return true;
});

export default {
  extract_audio_and_waveform,
  encodePcmToFlacJNI,
};
