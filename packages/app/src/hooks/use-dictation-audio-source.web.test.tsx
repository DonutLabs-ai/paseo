// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDictationAudioSource } from "./use-dictation-audio-source.web";

function pcm16Wav(samples: Int16Array, sampleRate = 16000): Blob {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const wav = new ArrayBuffer(44 + bytes.byteLength);
  const view = new DataView(wav);
  const header = new TextEncoder();
  new Uint8Array(wav, 0, 4).set(header.encode("RIFF"));
  view.setUint32(4, 36 + bytes.byteLength, true);
  new Uint8Array(wav, 8, 4).set(header.encode("WAVE"));
  new Uint8Array(wav, 12, 4).set(header.encode("fmt "));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  new Uint8Array(wav, 36, 4).set(header.encode("data"));
  view.setUint32(40, bytes.byteLength, true);
  new Uint8Array(wav, 44).set(bytes);
  const blob = new Blob([wav], { type: "audio/wav" });
  Object.defineProperty(blob, "arrayBuffer", {
    configurable: true,
    value: async () => wav,
  });
  return blob;
}

describe("web dictation audio source", () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalBlob = globalThis.Blob;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: originalAudioContext,
    });
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      value: originalBlob,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: originalMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("delivers PCM still queued behind the web audio callback when capture stops", async () => {
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      value: NodeBlob,
    });
    const completeRecording = new Int16Array(32000);
    completeRecording.fill(1000);
    const completeWav = pcm16Wav(completeRecording);
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const queuedSecond = new Float32Array(16000);
    queuedSecond.fill(1000 / 32768);

    let processor: ScriptProcessorNode | null = null;
    const deliverQueuedSecond = () => {
      processor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => queuedSecond },
      } as unknown as AudioProcessingEvent);
    };
    class FakeAudioContext {
      sampleRate = 16000;
      destination = {} as AudioDestinationNode;

      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
      }

      createScriptProcessor() {
        processor = {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as ScriptProcessorNode;
        return processor;
      }

      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as GainNode;
      }

      close() {
        return Promise.resolve();
      }
    }

    class FakeMediaRecorder extends EventTarget {
      state: RecordingState = "inactive";
      mimeType = "audio/wav";
      ondataavailable: ((event: BlobEvent) => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: completeWav } as BlobEvent);
          this.dispatchEvent(new Event("stop"));
        });
      }
    }

    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });

    const segments: string[] = [];
    const { result } = renderHook(() =>
      useDictationAudioSource({ onPcmSegment: (segment) => segments.push(segment) }),
    );

    await act(async () => result.current.start());
    expect(processor).not.toBeNull();

    const firstSecond = new Float32Array(16000);
    firstSecond.fill(1000 / 32768);
    act(() => {
      processor?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => firstSecond },
      } as unknown as AudioProcessingEvent);
    });

    let didStop = false;
    const stopped = result.current.stop().then(() => {
      didStop = true;
      return undefined;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(didStop).toBe(false);

    act(deliverQueuedSecond);
    await act(async () => stopped);

    const deliveredBytes = segments.reduce((total, segment) => total + atob(segment).length, 0);
    expect(deliveredBytes).toBe(completeRecording.byteLength);
  });
});
