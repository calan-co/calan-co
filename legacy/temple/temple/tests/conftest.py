import pytest

# Skip benchmark tests if pytest-benchmark is not installed.
# This avoids failing the entire test run when benchmark deps are absent.
pytest.importorskip("pytest_benchmark")
