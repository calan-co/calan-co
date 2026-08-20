from setuptools import setup, find_packages
import pathlib

here = pathlib.Path(__file__).parent
req_file = here / "temple" / "requirements.txt"
install_requires = []
if req_file.exists():
    install_requires = [
        ln.strip()
        for ln in req_file.read_text().splitlines()
        if ln.strip() and not ln.startswith("#")
    ]

setup(
    name="temple",
    version="0.0.1",
    description="Temple templating (local packaging helper for ASV)",
    packages=find_packages(where="temple/src"),
    package_dir={"": "temple/src"},
    install_requires=install_requires,
)
