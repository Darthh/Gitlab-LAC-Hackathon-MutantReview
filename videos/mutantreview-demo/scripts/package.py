"""Archive the versioned editable project without raw recordings or render caches."""
from pathlib import Path
import json
import subprocess
import sys
import zipfile

project = Path(__file__).resolve().parents[1]
repo = project.parents[1]
destination = Path(sys.argv[1]).resolve()
files = subprocess.check_output(
    ["git", "ls-files", "-z", "--", "videos/mutantreview-demo"],
    cwd=repo,
).decode().split("\0")
extra = ["assets/working-recording.mp4", "assets/aruarian-demo.wav", "assets/aruarian-original.mp3"]
cut = project / "working-cut.json"
if cut.exists():
    extra.extend({clip["source"] for clip in json.loads(cut.read_text())["clips"]})
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in filter(None, files):
        source = repo / name
        archive.write(source, Path("mutantreview-demo") / source.relative_to(project))
    for name in extra:
        source = project / name
        if source.is_file():
            archive.write(source, Path("mutantreview-demo") / name)
with zipfile.ZipFile(destination) as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"Archive integrity failure: {bad}")
    print(f"Verified {len(archive.infolist())} project files: {destination}")
