
import sys
import os

for line in sys.stdin:
    path = line.strip()
    if not path: continue
    if os.path.exists(path):
        try:
            with open(path, 'r', errors='ignore') as f:
                if '<<<<<<<' not in f.read():
                    print(path)
        except Exception:
            pass
