"""Build a Windows x64 portable release from a clean source tree and pinned runtimes."""
from __future__ import annotations
import argparse, hashlib, importlib.metadata, json, os, shutil, subprocess, sys, tarfile, zipfile
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DOWNLOADS = ROOT / '.runtime' / 'portable-downloads'
PS = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'

def log(message): print(message, flush=True)
def run(args, **kwargs): subprocess.run([str(a) for a in args], check=True, cwd=ROOT, **kwargs)
def download(url, name):
    target = DOWNLOADS / name
    if not target.exists():
        log('Download: ' + name)
        command = "Invoke-WebRequest -UseBasicParsing -Uri '" + url.replace("'", "''") + "' -OutFile '" + str(target).replace("'", "''") + "' -TimeoutSec 180 -ErrorAction Stop"
        try: run([PS, '-NoProfile', '-Command', command], stdout=subprocess.DEVNULL)
        except Exception:
            target.unlink(missing_ok=True)
            raise
    return target

def copy(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)

def clean_copy(src, dest):
    shutil.copytree(src, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo','.git','pyvenv.cfg','direct_url.json','*.log'))

def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--python-base', required=True)
    args.add_argument('--engine-site', required=True)
    args.add_argument('--node-version', required=True)
    args.add_argument('--resume', action='store_true')
    options = args.parse_args()
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    base = Path(options.python_base).resolve()
    engine = Path(options.engine_site).resolve()
    expected = dict(line.split('==',1) for line in (ROOT/'scripts/portable/requirements-lock.txt').read_text(encoding='utf-8').splitlines() if line and not line.startswith('#'))
    actual = {d.metadata['Name']:d.version for d in importlib.metadata.distributions(path=[str(engine)])}
    if actual != expected: raise RuntimeError('Installed translation environment differs from portable requirements-lock.txt')
    sys.path.insert(0, str(engine))
    from babeldoc.assets.assets import generate_all_assets_file_list
    from fontTools.ttLib import TTFont
    import pymupdf
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    name = f'Rosetta-{version}-windows-x64-portable'
    output = ROOT/'release'/name
    # Never recursively delete a computed destination. Build into a new directory.
    if output.exists() and not options.resume: raise RuntimeError('Output already exists; use --resume only for an interrupted build.')
    if output.exists() and any((output/'data'/f).exists() for f in ['settings.env','cache/pdf2zh_next/cache.v1.db']): raise RuntimeError('Refuse to overwrite a portable folder containing user settings/cache.')
    output.mkdir(parents=True,exist_ok=True)
    log('Build frontend')
    run(['npm.cmd','run','build'])
    tracked = subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','ls-files','-z'], cwd=ROOT).decode('utf-8').split('\0')
    # Include the new packaging sources before their first commit, but no private ignored files.
    untracked = subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','ls-files','--others','--exclude-standard','-z'], cwd=ROOT).decode('utf-8').split('\0')
    for relative in sorted(set(tracked+untracked)):
        if not relative: continue
        path = Path(relative)
        if relative.startswith(('.workbuddy/', 'release/', 'tmp/', '.runtime/')): continue
        if relative == '.env' or (path.suffix in ['.pdf','.log']): raise RuntimeError('Private output in source inventory')
        if (ROOT/path).is_file(): copy(ROOT/path, output/'source'/path)
    for relative in ['server.mjs','server/full-translation.mjs','server/files.mjs','scripts/pdf2zh-worker.py','.env.example','LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md']:
        copy(ROOT/relative, output/relative)
    clean_copy(ROOT/'dist', output/'dist')
    clean_copy(ROOT/'licenses', output/'licenses')
    copy(ROOT/'assets/desktop/reader.ico', output/'assets/desktop/reader.ico')
    (output/'data').mkdir(exist_ok=True)
    node_name = f'node-v{options.node_version}-win-x64.exe'
    checksums = download(f'https://nodejs.org/dist/v{options.node_version}/SHASUMS256.txt', f'node-v{options.node_version}-SHASUMS256.txt')
    checksum_line = next(line for line in checksums.read_text().splitlines() if line.endswith('win-x64/node.exe'))
    node = download(f'https://nodejs.org/dist/v{options.node_version}/win-x64/node.exe', node_name)
    if hashlib.sha256(node.read_bytes()).hexdigest() != checksum_line.split()[0]: raise RuntimeError('Node.js checksum mismatch')
    copy(node, output/'.runtime/node/node.exe')
    copy(download(f'https://raw.githubusercontent.com/nodejs/node/v{options.node_version}/LICENSE', f'node-v{options.node_version}-LICENSE'), output/'licenses/Node.js/LICENSE')
    portable_python = output/'.runtime/portable-python'
    log('Copy relocatable CPython and translation dependencies')
    clean_copy(base, portable_python)
    clean_copy(engine, portable_python/'Lib/site-packages')
    # Do not ship pip/uv or machine-specific entry points; they are build tools only.
    scripts = portable_python/'Scripts'
    if scripts.exists():
        for file in scripts.iterdir():
            if file.is_file(): file.unlink()
    copy(base/'LICENSE.txt', output/'licenses/CPython/LICENSE.txt')
    patches = [
        ('babeldoc/const.py', 'CACHE_FOLDER = Path.home() / ".cache" / "babeldoc"', 'CACHE_FOLDER = (Path(os.environ["ROSETTA_DATA_DIR"]) / "cache" / "babeldoc") if os.environ.get("ROSETTA_DATA_DIR") else Path.home() / ".cache" / "babeldoc"'),
        ('pdf2zh_next/const.py','DEFAULT_CONFIG_DIR = Path("~/.config/pdf2zh").expanduser()','DEFAULT_CONFIG_DIR = (Path(os.environ["ROSETTA_DATA_DIR"]) / "engine-config") if os.environ.get("ROSETTA_DATA_DIR") else Path("~/.config/pdf2zh").expanduser()'),
        ('pdf2zh_next/translator/cache.py','    cache_folder = Path.home() / ".cache" / "pdf2zh_next"','    cache_folder = (Path(os.environ["ROSETTA_DATA_DIR"]) / "cache" / "pdf2zh_next") if os.environ.get("ROSETTA_DATA_DIR") else Path.home() / ".cache" / "pdf2zh_next"'),
    ]
    for relative, before, after in patches:
        target = portable_python/'Lib/site-packages'/relative
        content = target.read_text(encoding='utf-8')
        if before not in content: raise RuntimeError('Upstream portable patch no longer matches: '+relative)
        content = 'import os\n'+content
        content=content.replace(before,after)
        target.write_text('# Modified for Rosetta portable data paths, 2026-10-05. See source/scripts/portable/build.py.\n'+content,encoding='utf-8')
    log('Verify and copy all model, font, CMap and tokenizer assets')
    asset_manifest = generate_all_assets_file_list()
    original_cache = Path.home()/'.cache/babeldoc'
    font_notices = []
    for folder, items in asset_manifest.items():
        for item in items:
            original = original_cache/folder/item['name']
            if not original.is_file() or hashlib.sha3_256(original.read_bytes()).hexdigest()!=item['sha3_256']:
                raise RuntimeError('Missing or invalid asset: '+folder+'/'+item['name']+'; run setup:engine warmup on build machine.')
            copy(original, output/'data/cache/babeldoc'/folder/item['name'])
            if folder=='fonts':
                with TTFont(original,lazy=True) as font:
                    font_notices.append({'file':item['name'],'copyright':font['name'].getDebugName(0),'license':font['name'].getDebugName(13),'licenseURL':font['name'].getDebugName(14)})
    (output/'licenses/font-copyrights.json').write_text(json.dumps(font_notices,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    license_urls = {
        'Fonts/OFL.txt':'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/LICENSE',
        'Fonts/LxgwWenkaiGB-OFL.txt':'https://raw.githubusercontent.com/lxgw/LxgwWenkaiGB/main/OFL.txt',
        'Fonts/LxgwWenkaiTC-OFL.txt':'https://raw.githubusercontent.com/lxgw/LxgwWenkaiTC/main/OFL.txt',
        'Fonts/Klee-OFL.txt':'https://raw.githubusercontent.com/fontworks-fonts/Klee/master/OFL.txt',
        'Fonts/SourceHanTrueType-LICENSE.txt':'https://raw.githubusercontent.com/Pal3love/Source-Han-TrueType/main/LICENSE.txt',
        'Fonts/MaruBuri-README.md':'https://raw.githubusercontent.com/fonts-archive/MaruBuri/main/README.md',
        'Fonts/BabelDOC-Assets-README.md':'https://raw.githubusercontent.com/funstory-ai/BabelDOC-Assets/main/README.md',
        'Adobe-CMap/LICENSE.md':'https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/LICENSE.md',
        'tiktoken/LICENSE':'https://raw.githubusercontent.com/openai/tiktoken/main/LICENSE',
        'DocLayout-YOLO/model-card.md':'https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/raw/main/README.md',
    }
    for relative,url in license_urls.items(): copy(download(url,relative.replace('/','-')),output/'licenses'/relative)
    copy(ROOT/'licenses/PDF.js/LICENSE',output/'licenses/DocLayout-YOLO/Apache-2.0.txt')
    packages=[]
    for dist in importlib.metadata.distributions(path=[str(engine)]):
        metadata=dist.metadata
        packages.append({'name':metadata['Name'],'version':dist.version,'license':metadata.get('License-Expression') or metadata.get('License') or 'UNKNOWN','projectURLs':metadata.get_all('Project-URL',[])})
    packages.sort(key=lambda row:row['name'].lower())
    (output/'licenses/python-packages.json').write_text(json.dumps(packages,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    # Preserve every installed distribution's original LICENSE/NOTICE/COPYING file.
    for path in engine.rglob('*'):
        if path.is_file() and any(word in path.name.upper() for word in ['LICENSE','LICENCE','COPYING','NOTICE']):
            copy(path, output/'licenses/python'/path.relative_to(engine))
    log('Download corresponding source archives for copyleft native/runtime components')
    source_packages={'pdf2zh-next','babeldoc','pymupdf','levenshtein','marisa-trie','certifi','tqdm'}
    source_records=[]
    for package in packages:
        key=package['name'].lower().replace('_','-')
        if key not in source_packages: continue
        info_path=download(f'https://pypi.org/pypi/{package["name"]}/{package["version"]}/json',f'{key}-{package["version"]}-pypi.json')
        info=json.loads(info_path.read_text(encoding='utf-8'))
        artifact=next(item for item in info['urls'] if item['packagetype']=='sdist')
        source=download(artifact['url'],artifact['filename'])
        if hashlib.sha256(source.read_bytes()).hexdigest()!=artifact['digests']['sha256']:raise RuntimeError('Source checksum mismatch')
        copy(source,output/'source/third-party'/source.name)
        source_records.append({'name':package['name'],'version':package['version'],'url':artifact['url'],'sha256':artifact['digests']['sha256']})
        if key=='pymupdf':
            # PyMuPDF's sdist bundles the complete MuPDF source archive, including third parties.
            with tarfile.open(source) as archive:
                embedded=[member.name for member in archive.getmembers() if member.name.endswith(('.tgz','.tar.gz')) and 'mupdf' in member.name.lower()]
            if embedded:
                source_records[-1]['bundledMuPDFSource']=embedded
            else:
                mupdf_version = pymupdf.VersionFitz
                mupdf_url = f'https://mupdf.com/downloads/archive/mupdf-{mupdf_version}-source.tar.gz'
                mupdf_source = download(mupdf_url, f'mupdf-{mupdf_version}-source.tar.gz')
                with tarfile.open(mupdf_source) as archive:
                    if not any('/thirdparty/' in m.name for m in archive.getmembers()):raise RuntimeError('MuPDF source archive missing thirdparty sources')
                copy(mupdf_source,output/'source/third-party'/mupdf_source.name)
                source_records.append({'name':'MuPDF','version':mupdf_version,'url':mupdf_url,'sha256':hashlib.sha256(mupdf_source.read_bytes()).hexdigest()})
    (output/'source/third-party/SOURCES.json').write_text(json.dumps(source_records,indent=2)+'\n',encoding='utf-8')
    csc=Path(os.environ['SystemRoot'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    run([csc,'/nologo','/target:winexe','/platform:x64','/optimize+',f'/out:{output / "Rosetta.exe"}',f'/win32icon:{ROOT / "assets/desktop/reader.ico"}','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',ROOT/'scripts/portable/Launcher.cs'])
    (output/'开始使用.txt').write_text('Rosetta · 译读（Windows 10/11 x64 完整便携版）\n\n1. 将整个压缩包解压到可写文件夹，双击 Rosetta.exe。\n2. 在浏览器中的设置填写自己的接口、API Key 和模型。\n3. 不需要安装 Node.js、uv、Python；模型和字体已包含。\n4. 关闭浏览器不会停止服务，在启动窗口或托盘中选择退出。\n\n配置、缓存和临时文件保存在 data；译本默认保存到用户目录的 PDF译文，可在设置中修改。\n移动整个文件夹时先退出应用，更新时保留自己的 data 文件夹；不要分享含 API Key 的 data/settings.env。\n翻译需要联网并使用你自己的模型服务，费用由服务商收取。\n\n源码、第三方源码和许可均随包提供，更多说明见 source/docs/portable-release.md。\n',encoding='utf-8-sig')
    (output/'licenses/PORTABLE-NOTICES.md').write_text('''# Portable distribution notices

Original project: GNU AGPL-3.0-only. Complete project source and build scripts are in ../source/.
Third-party software retains its original licenses. CPython and Node.js notices are included here.
Translation dependencies are distributed with all installed license files and version inventory.
Corresponding source archives for PDFMathTranslate-next, BabelDOC, PyMuPDF, MuPDF, Levenshtein, marisa-trie, certifi and tqdm are in ../source/third-party/. See SOURCES.json for provenance.
Rosetta changes only portable configuration/cache paths in three upstream Python source files; the full modified files are shipped in ../.runtime/portable-python/Lib/site-packages/ and the reproducible patch is in ../source/scripts/portable/build.py.
Fonts preserve their embedded copyright records in font-copyrights.json. Most use SIL OFL 1.1, with original reserved names retained; MaruBuri uses the Naver font terms reproduced in Fonts/MaruBuri-README.md. Fonts have not been modified.
The packaged ONNX model card declares Apache-2.0; its card and full Apache license are in DocLayout-YOLO/.
Adobe CMap notices and OpenAI tiktoken MIT license are also included. Model/tokenizer assets are unmodified and verified against BabelDOC's published SHA3-256 hashes.
No papers, translation caches, browser profiles, API keys or developer configurations are included.
''',encoding='utf-8')
    manifest={'version':version,'platform':'windows-x64','node':options.node_version,'python':sys.version.split()[0],'pdf2zh-next':'2.9.0','babeldoc':'0.6.2','assets':asset_manifest,'sources':source_records}
    (output/'portable-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    log('Portable directory ready: '+name)
    log('Before archiving, run scripts/portable/verify.mjs with this directory, then scripts/portable/archive.py.')

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
