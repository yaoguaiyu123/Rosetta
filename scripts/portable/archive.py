"""Archive an already verified portable directory with SHA-256 inventory."""
from pathlib import Path
import hashlib,json,sys,zipfile,os
root=Path(sys.argv[1]).resolve()
assert root.name.startswith('Rosetta-') and (root/'Rosetta.exe').is_file()
# No personal keys, output PDFs, caches or bytecode may be published.
project=Path(__file__).resolve().parents[2]
env=(project/'.env').read_text(encoding='utf-8') if (project/'.env').exists() else ''
import re
match=re.search(r'^API_KEY\s*=\s*(.*?)\s*$',env,re.M)
key=(match.group(1).strip().strip('\"\'') if match else '').encode()
user=os.environ.get('USERNAME','').encode('utf-8')
files=sorted(p for p in root.rglob('*') if p.is_file())
for file in files:
    relative=file.relative_to(root).as_posix()
    assert file.name not in ['.env','settings.env','cache.v1.db','server-ready.json'],relative
    assert file.suffix not in ['.pdf','.pyc','.pyo','.log'],relative
    content=file.read_bytes()
    assert not key or key not in content, 'Configured key in package'
    assert not user or user not in content, 'Developer name in package: '+relative
archive=root.parent/(root.name+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
    for file in files:z.write(file,root.name+'/'+file.relative_to(root).as_posix())
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
(root.parent/'SHA256SUMS.txt').write_text(checksum+'  '+archive.name+'\n',encoding='ascii')
print(json.dumps({'archive':archive.name,'bytes':archive.stat().st_size,'sha256':checksum,'files':len(files)}))
