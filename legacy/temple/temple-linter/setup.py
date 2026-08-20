from setuptools import find_packages, setup

setup(
    name="temple-linter",
    version="0.1.0",
    description="Linting and diagnostics for templated files. Integrates with temple and base format linters.",
    author="Chris Caldwell",
    author_email="chris@calan.co",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    install_requires=[
        "temple>=0.1.0",
        "pygls>=1.0.0",
    ],
    entry_points={
        "console_scripts": ["temple-linter-lsp = temple_linter.lsp_server:main"]
    },
    python_requires=">=3.10",
)
