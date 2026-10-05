#!/usr/bin/env python3
"""Synchronize TeoPad file types and CSP after editing the three-file application."""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
page = root / 'index.html'
manifest_path = root / 'manifest.json'
source = page.read_text(encoding='utf-8')
match = re.search(r'const TYPES = (.*);', source)
if not match:
    raise SystemExit('TYPES definition not found; no files modified.')
types = json.loads(match.group(1))
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['file_handlers'][0]['accept'] = types
scripts = re.findall(r'<script>([\s\S]*?)</script>', source)
if not scripts:
    raise SystemExit('Scripts not found; no files modified.')
hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode() + "'" for script in scripts]
source, count = re.subn(r"script-src [^;]+;", "script-src 'self' " + ' '.join(hashes) + ';', source, count=1)
if count != 1:
    raise SystemExit('CSP script-src directive not found; no files modified.')
page.write_text(source, encoding='utf-8')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('File types and CSP hashes synchronized.')
