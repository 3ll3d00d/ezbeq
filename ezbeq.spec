# -*- mode: python -*-
import os

# helper functions
block_cipher = None
spec_root = os.path.abspath(SPECPATH)

a = Analysis(['ezbeq/app.py'],
             pathex=[spec_root],
             binaries=[],
             datas=[
                 ('VERSION', '.'),
                 ('ui/build', 'ui')
             ],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=['pkg_resources'],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(pyz,
          a.scripts,
          a.binaries,
          a.zipfiles,
          a.datas,
          name='ezbeq',
          debug=False,
          strip=False,
          upx=False,
          runtime_tmpdir=None,
          console=True)
