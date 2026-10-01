"""Speech to text for caption generation. Usage: transcribe.py AUDIO.wav [model] -> JSON on stdout.
Runs locally (faster-whisper, CPU, int8). The model downloads once on first use."""
import json
import sys

from faster_whisper import WhisperModel

audio = sys.argv[1]
model = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else "small", device="cpu", compute_type="int8")
segs, info = model.transcribe(audio, vad_filter=True, beam_size=5)
print(json.dumps({
    "language": info.language,
    "segments": [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs],
}))
