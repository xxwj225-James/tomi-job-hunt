"""Release packaging — standard zip files that Windows Explorer opens natively.

Usage: python scripts/package.py   (also the last step of `npm run pack`)
Output: release/tomihunt-extension.zip (self-installing bundle: extract,
        double-click install-extension.bat)
        release/tomihunt-extension/    (the SAME bundle left extracted, for
        people who run install-extension.bat straight from release/)
        release/tomihunt-source.zip (full source for Core mode)
"""
import os
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASE = os.path.join(ROOT, 'release')
EXCLUDES = {'node_modules', '.git', 'dist', 'release'}


def make_zip(src_dir: str, dst: str) -> None:
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(src_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDES]
            for name in files:
                if name.endswith('.zip'):
                    continue
                path = os.path.join(root, name)
                rel = os.path.relpath(path, src_dir).replace(os.sep, '/')
                z.write(path, rel)
    print(f'{os.path.basename(dst)}: {os.path.getsize(dst)} bytes')


def make_extension_zip(dist_dir: str, dst: str) -> None:
    """Self-installing bundle: install-extension.bat at the zip root, the
    unpacked extension in extension/. The .bat copies extension/ to the
    fixed install dir — no zip-in-zip, works right after extracting."""
    installer = os.path.join(ROOT, 'scripts', 'install-extension.bat')
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(installer, 'install-extension.bat')
        for root, dirs, files in os.walk(dist_dir):
            for name in files:
                path = os.path.join(root, name)
                rel = os.path.relpath(path, dist_dir).replace(os.sep, '/')
                z.write(path, f'extension/{rel}')
    print(f'{os.path.basename(dst)}: {os.path.getsize(dst)} bytes')


def make_extension_dir(dist_dir: str, dst_dir: str) -> None:
    """The SAME bundle as make_extension_zip, left extracted.

    The zip and this folder are two views of one payload, and refreshing only
    the zip is exactly how a stale folder kept reinstalling an old extension
    (release/tomihunt-extension/ still held the 0.2.0 build that
    install-extension.bat copies into %LOCALAPPDATA%\\TomiHunt\\extension).
    """
    installer = os.path.join(ROOT, 'scripts', 'install-extension.bat')
    shutil.rmtree(dst_dir, ignore_errors=True)
    shutil.copytree(dist_dir, os.path.join(dst_dir, 'extension'))
    shutil.copy2(installer, os.path.join(dst_dir, 'install-extension.bat'))
    print(f'{os.path.basename(dst_dir)}/: refreshed from extension/dist')


def main() -> None:
    os.makedirs(RELEASE, exist_ok=True)
    dist = os.path.join(ROOT, 'extension', 'dist')
    make_extension_zip(dist, os.path.join(RELEASE, 'tomihunt-extension.zip'))
    make_extension_dir(dist, os.path.join(RELEASE, 'tomihunt-extension'))
    make_zip(ROOT, os.path.join(RELEASE, 'tomihunt-source.zip'))
    print('done')


if __name__ == '__main__':
    main()
