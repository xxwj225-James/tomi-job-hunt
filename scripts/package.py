"""Release packaging — standard zip files that Windows Explorer opens natively.

Usage: python scripts/package.py
Output: release/tomihunt-extension.zip (self-installing bundle: extract,
        double-click install-extension.bat)
        release/tomihunt-source.zip (full source for Core mode)
"""
import os
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


def main() -> None:
    os.makedirs(RELEASE, exist_ok=True)
    make_extension_zip(
        os.path.join(ROOT, 'extension', 'dist'),
        os.path.join(RELEASE, 'tomihunt-extension.zip'),
    )
    make_zip(ROOT, os.path.join(RELEASE, 'tomihunt-source.zip'))
    print('done')


if __name__ == '__main__':
    main()
