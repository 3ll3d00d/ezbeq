import os
from setuptools import setup, find_packages

with open("README.md") as f:
    readme = f.read()

if os.path.exists("ezbeq/VERSION"):
    with open("ezbeq/VERSION", "r") as f:
        version = f.read()
else:
    version = "0.0.1-alpha.1+dirty"

setup(
    name="ezbeq",
    version=version,
    description="A small webapp which can send beqcatalogue filters to a DSP device",
    long_description=readme,
    long_description_content_type="text/markdown",
    classifiers=[
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Development Status :: 4 - Beta",
    ],
    url="http://github.com/3ll3d00d/ezbeq",
    author="Matt Khan",
    author_email="mattkhan+ezbeq@gmail.com",
    license="MIT",
    packages=find_packages(exclude=("test", "docs")),
    python_requires=">=3.7",
    entry_points={"console_scripts": ["ezbeq = ezbeq.main:main",],},
    install_requires=[
        "aniso8601==9.0.1; python_version >= '3.5'",
        "attrs==21.2.0",
        "autobahn[twisted]==21.3.1",
        "automat==20.2.0",
        "brotli==1.0.9",
        "certifi==2020.12.5",
        "cffi==1.14.5",
        "chardet==4.0.0; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4'",
        "click==7.1.2; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4'",
        "constantly==15.1.0",
        "cryptography==3.4.7; python_version >= '3.6'",
        "flask==1.1.4; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4'",
        "flask-compress==1.9.0",
        "flask-restx==0.4.0",
        "hyperlink==21.0.0",
        "idna==2.10; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "incremental==21.3.0",
        "itsdangerous==1.1.0; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "jinja2==2.11.3; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4'",
        "jsonschema==3.2.0",
        "markupsafe==2.0.1; python_version >= '3.6'",
        "plumbum==1.7.0",
        "pycparser==2.20; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "pyrsistent==0.17.3; python_version >= '3.5'",
        "python-dateutil==2.8.1",
        "pytz==2021.1",
        "pyyaml==5.4.1",
        "requests==2.25.1",
        "semver==2.13.0",
        "six==1.16.0; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "twisted==21.2.0",
        "txaio==21.2.1; python_version >= '3.6'",
        "urllib3==1.26.5; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4' and python_version < '4'",
        "werkzeug==1.0.1; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4'",
        "zope.interface==5.4.0",
    ],
    tests_require=["pytest", "pytest-httpserver"],
    include_package_data=True,
    zip_safe=False,
)
