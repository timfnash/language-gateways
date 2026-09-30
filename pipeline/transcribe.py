import sys, wave, time
from pathlib import Path
import numpy as np
import mlx_whisper

MODEL = "mlx-community/whisper-large-v3-turbo"
folder = Path(sys.argv[1]).expanduser()
files = sorted(folder.glob("*.[wW][aA][vV]"))
only = set(sys.argv[2:])
if only: files = [f for f in files if f.stem in only]

for i, f in enumerate(files, 1):
    out = f.with_suffix(".txt")
    if out.exists():
        print(f"[{i}/{len(files)}] skip {f.name} (done)", flush=True)
        continue
    with wave.open(str(f)) as w:
        assert w.getframerate() == 16000 and w.getsampwidth() == 2, f.name
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        audio = audio.reshape(-1, w.getnchannels()).mean(axis=1).astype(np.float32) / 32768.0
    t = time.time()
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, condition_on_previous_text=False,
        word_timestamps=True, hallucination_silence_threshold=2.0, no_speech_threshold=0.5)
    lines, prev = [], None
    for s in result["segments"]:
        text = s["text"].strip()
        if not text or text == prev:
            continue
        prev = text
        m, sec = divmod(int(s["start"]), 60)
        lines.append(f"[{m:02d}:{sec:02d}] {text}")
    out.write_text(f"# {f.name} (detected language: {result.get('language')})\n\n" + "\n".join(lines) + "\n")
    print(f"[{i}/{len(files)}] {f.name} -> {out.name} ({result.get('language')}, {time.time()-t:.0f}s)", flush=True)
print("ALL DONE", flush=True)
