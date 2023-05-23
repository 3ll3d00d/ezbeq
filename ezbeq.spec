# -*- mode: python -*-
import os
import platform


def get_icon_file():
    '''
    :return: the full path to the icon file for the current platform.
    '''
    return f"icons/{'icon.icns' if platform.system() == 'Darwin' else 'icon.ico'}"


def get_data_args():
    '''
    :return: the data array for the analysis.
    '''
    return [
        ('icons/icon.ico', '.'),
        ('ezbeq/VERSION', '.'),
        ('ezbeq/ui', 'ui')
    ]

block_cipher = None
spec_root = os.path.abspath(SPECPATH)

a = Analysis(['ezbeq/main.py'],
             pathex=[spec_root],
             binaries=[],
             datas=get_data_args(),
             hiddenimports=['flask'],
             hookspath=[],
             runtime_hooks=[],
             excludes=[],
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
          console=True,
          exclude_binaries=False,
          icon=get_icon_file())

if platform.system() == 'Darwin':
    app = BUNDLE(exe,
                 name='ezbeq.app',
                 bundle_identifier='com.3ll3d00d.ezbeq',
                 icon='icons/icon.icns',
                 info_plist={
                     'NSHighResolutionCapable': 'True',
                     'LSBackgroundOnly': 'False',
                     'NSRequiresAquaSystemAppearance': 'False',
                     'LSEnvironment': {
                         'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:'
                     }
                 })
