"""Recrée les médias si le dossier a été transmis sous forme de sources texte."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent / 'sources'
fonts = root / 'polices'
fonts.mkdir(exist_ok=True)
for name in ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']:
    dest = fonts / name
    if not dest.exists():
        candidates = [Path('/usr/share/fonts/truetype/dejavu') / name,
                      Path('/usr/share/fonts/dejavu') / name]
        source = next((p for p in candidates if p.is_file()), None)
        if source is None:
            raise SystemExit(f'Police manquante : {name}. Installer fonts-dejavu ou reprendre les polices du dossier complet.')
        shutil.copyfile(source, dest)
if not (root / 'duel-epees.mp4').exists():
    subprocess.run([sys.executable, str(root / 'render_swords.py'), '--samples', '3',
                    '--output', str(root / 'duel-epees.mp4')], cwd=root, check=True)
if not (root / 'son.wav').exists():
    subprocess.run([sys.executable, str(root / 'son.py')], cwd=root, check=True)
print('Médias disponibles dans', root)
