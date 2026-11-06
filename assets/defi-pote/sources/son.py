"""Mix reproductible : tension, extinctions, chocs des épées et révélation."""
from pathlib import Path
import json
import subprocess
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent
timeline = json.loads((ROOT / 'timeline.json').read_text())
sr = 48000
audio = np.zeros((round(timeline['duration'] * sr), 2), dtype=np.float64)
rng = np.random.default_rng(823)


def add(start, signal, pan=0):
    offset = round(start * sr)
    count = min(len(signal), len(audio) - offset)
    if count > 0:
        gains = np.sqrt([(1 - pan) / 2, (1 + pan) / 2])
        audio[offset:offset + count] += signal[:count, None] * gains


# Pulsation électronique discrète sous la sélection et le résultat.
for start in np.arange(0, timeline['duration'], .5):
    t = np.arange(round(.21 * sr)) / sr
    phase = 2 * np.pi * (46 * t + 90 * .026 * (1 - np.exp(-t / .026)))
    kick = np.sin(phase) * np.exp(-t / .055) * np.minimum(1, t / .002)
    add(start, kick * .095)

# Montée continue ; aucun ancien défilement de clics dans les cases.
t = np.arange(round(3.25 * sr)) / sr
rise = np.sin(2 * np.pi * (130 * t + 95 * t * t))
rise += .22 * np.sin(2 * np.pi * (260 * t + 190 * t * t))
env = np.sin(np.pi * t / 3.25) ** .7
add(0, rise * env * .022)

# Les deux sons d'une paire partent ensemble, avec une légère largeur stéréo.
for event in timeline['eliminations']:
    t = np.arange(round(.16 * sr)) / sr
    env = np.minimum(1, t / .002) * np.exp(-t / .042)
    for j, index in enumerate(event['indices']):
        freq = 780 + index * 55
        phase = 2 * np.pi * (freq * t - 1250 * t * t)
        off = np.sin(phase) * env * .065
        pan = (-.35 if j == 0 else .35) if len(event['indices']) == 2 else 0
        add(event['at'], off, pan)

# Les trois contacts métalliques conservent leurs instants et leur signature.
for i, start in enumerate(timeline['clashes']):
    t = np.arange(round(.55 * sr)) / sr
    metal = np.zeros_like(t)
    for frequency, amplitude in [(710, .10), (1171, .075), (1837, .053),
                                 (2876, .040), (4277, .022)]:
        frequency *= 1 + i * .045
        metal += np.sin(2 * np.pi * frequency * t) * np.exp(-t / (.07 + 110 / frequency)) * amplitude
    clang = metal * np.minimum(1, t / .0015)
    clang += rng.normal(0, 1, len(t)) * .055 * np.exp(-t / .008)
    add(start, clang)

reveal = timeline['reveal']
t = np.arange(round(.38 * sr)) / sr
noise = np.convolve(rng.normal(0, 1, len(t)), np.ones(15) / 15, mode='same')
add(reveal - .12, noise * np.sin(np.pi * t / .38) ** 2 * .16)
for j, frequency in enumerate([330, 495, 660]):
    t = np.arange(round(.85 * sr)) / sr
    chord = np.sin(2 * np.pi * frequency * t) + .15 * np.sin(4 * np.pi * frequency * t)
    add(reveal + j * .025, chord * np.minimum(1, t / .004) * np.exp(-t / .23) * .07)

audio[-round(.10 * sr):] *= np.linspace(1, 0, round(.10 * sr))[:, None]
raw = ROOT / 'son-brut.wav'
with wave.open(str(raw), 'wb') as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(sr)
    out.writeframes((np.clip(audio, -.98, .98) * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-ar', str(sr),
                str(ROOT / 'son.wav')], check=True)
raw.unlink()
print(ROOT / 'son.wav')
