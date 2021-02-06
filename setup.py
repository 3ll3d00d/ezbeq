import os
from setuptools import setup, find_packages

with open('README.md') as f:
    readme = f.read()

if os.path.exists('ezbeq/VERSION'):
    with open('ezbeq/VERSION', 'r') as f:
        version = f.read()
else:
    version = '0.0.1-alpha.1+dirty'

setup(name='ezbeq',
      version=version,
      description='A small webapp which can send beqcatalogue filters to a DSP device',
      long_description=readme,
      long_description_content_type='text/markdown',
      classifiers=[
          'License :: OSI Approved :: MIT License',
          'Programming Language :: Python :: 3.7',
          'Programming Language :: Python :: 3.8',
          'Development Status :: 4 - Beta',
      ],
      url='http://github.com/3ll3d00d/ezbeq',
      author='Matt Khan',
      author_email='mattkhan+ezbeq@gmail.com',
      license='MIT',
      packages=find_packages(exclude=('test', 'docs')),
      python_requires='>=3.7',
      entry_points={
          'console_scripts': [
              'ezbeq = ezbeq.app:main',
          ],
      },
      install_requires=[
          'pyyaml',
          'twisted',
          'plumbum',
          'flask-restful',
          'requests',
          'python-dateutil',
          'autobahn[twisted]',
          'semver'
      ],
      include_package_data=True,
      zip_safe=False)
