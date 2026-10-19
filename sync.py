# Copy findings into the site, rewrite absolute image paths to site-relative ones, copy referenced images.
import json, os, shutil, sys
SRC = "/mnt/project-files/yougame-feedback/"
SITE = sys.argv[1]
used = set()
def fix(v):
    if isinstance(v, str):
        rel = v[len(SRC):] if v.startswith(SRC) else v
        if rel.startswith("screenshots/") and os.path.isfile(SRC + rel):
            used.add(rel)
        return rel
    if isinstance(v, list): return [fix(x) for x in v]
    if isinstance(v, dict): return {k: fix(x) for k, x in v.items()}
    return v
for name in ("bugs.json", "ux.json", "proposals.json", "improvements.json"):
    if os.path.exists(SRC + name):
        data = fix(json.load(open(SRC + name)))
        json.dump(data, open(f"{SITE}/data/{name}", "w"), indent=1, ensure_ascii=False)
for rel in used:
    os.makedirs(os.path.dirname(f"{SITE}/{rel}"), exist_ok=True)
    shutil.copy2(SRC + rel, f"{SITE}/{rel}")
files = {f"data/{n}": f"{SITE}/data/{n}" for n in ("bugs.json", "ux.json", "proposals.json", "improvements.json") if os.path.exists(f"{SITE}/data/{n}")}
files.update({rel: f"{SITE}/{rel}" for rel in sorted(used)})
print(json.dumps(files))
