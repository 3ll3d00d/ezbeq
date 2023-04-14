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
        "attrs==22.2.0; python_version >= '3.6'",
        "autobahn[twisted]==23.1.2",
        "automat==22.10.0",
        "brotli==1.0.9",
        "certifi==2022.12.7; python_version >= '3.6'",
        "cffi==1.15.1",
        "charset-normalizer==3.1.0; python_version >= '3.7'",
        "click==8.1.3; python_version >= '3.7'",
        "constantly==15.1.0",
        "cryptography==40.0.2; python_version >= '3.6'",
        "flask==2.2.3; python_version >= '3.7'",
        "flask-compress==1.13",
        "flask-restx==1.1.0",
        "hyperlink==21.0.0",
        "idna==3.4; python_version >= '3.5'",
        "importlib-metadata==6.3.0; python_version < '3.10'",
        "importlib-resources==5.12.0",
        "incremental==22.10.0",
        "itsdangerous==2.1.2; python_version >= '3.7'",
        "jinja2==3.1.2; python_version >= '3.7'",
        "jsonschema==4.17.3; python_version >= '3.7'",
        "markupsafe==2.1.2; python_version >= '3.7'",
        "plumbum==1.8.1",
        "pycparser==2.21; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "pyrsistent==0.19.3; python_version >= '3.7'",
        "python-dateutil==2.8.2",
        "pytz==2023.3",
        "pyyaml==6.0",
        "requests==2.28.2",
        "semver==3.0.0",
        "setuptools==67.6.1; python_version >= '3.7'",
        "six==1.16.0; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3'",
        "twisted==22.10.0",
        "txaio==23.1.1; python_version >= '3.7'",
        "typing-extensions==4.5.0; python_version >= '3.7'",
        "urllib3==1.26.15; python_version >= '2.7' and python_version not in '3.0, 3.1, 3.2, 3.3, 3.4, 3.5'",
        "werkzeug==2.2.3; python_version >= '3.7'",
        "zipp==3.15.0; python_version < '3.10'",
        "zope.interface==6.0; python_version >= '3.7'"
    ],
    tests_require=["pytest", "pytest-httpserver"],
    include_package_data=True,
    zip_safe=False,
)
