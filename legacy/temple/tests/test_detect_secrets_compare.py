"""Tests for detect_secrets_compare script."""

import json
import tempfile
from pathlib import Path

# Import the module
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts" / "ci"))
import detect_secrets_compare


def test_load_json_path_valid():
    """Test loading valid JSON from file."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        test_data = {"key": "value"}
        json.dump(test_data, f)
        temp_path = Path(f.name)
    
    try:
        result = detect_secrets_compare.load_json_path(temp_path)
        assert result == test_data
    finally:
        temp_path.unlink()


def test_load_json_path_nonexistent():
    """Test loading from nonexistent file returns empty dict."""
    nonexistent = Path("/tmp/nonexistent_file_xyz.json")
    result = detect_secrets_compare.load_json_path(nonexistent)
    assert result == {}


def test_build_hashes_empty():
    """Test building hashes from empty baseline."""
    baseline = {}
    result = detect_secrets_compare.build_hashes(baseline)
    assert result == {}


def test_build_hashes_with_results():
    """Test building hashes from baseline with results."""
    baseline = {
        "results": {
            "file1.txt": [
                {"hashed_secret": "hash1"},
                {"hashed_secret": "hash2"},
            ]
        }
    }
    result = detect_secrets_compare.build_hashes(baseline)
    assert "file1.txt" in result
    assert result["file1.txt"] == {"hash1", "hash2"}


def test_compare_with_no_new_secrets():
    """Test comparison when no new secrets are found."""
    baseline = {
        "results": {
            "file1.txt": [
                {"hashed_secret": "hash1", "type": "secret"},
            ]
        }
    }
    current = {
        "results": {
            "file1.txt": [
                {"hashed_secret": "hash1", "type": "secret"},
            ]
        }
    }
    
    new = detect_secrets_compare.compare(current, baseline, [])
    assert new == []


def test_compare_with_new_secrets():
    """Test comparison when new secrets are found."""
    baseline = {
        "results": {
            "file1.txt": [
                {"hashed_secret": "hash1", "type": "secret"},
            ]
        }
    }
    current = {
        "results": {
            "file1.txt": [
                {"hashed_secret": "hash1", "type": "secret"},
                {"hashed_secret": "hash2", "type": "secret", "line_number": 42},
            ]
        }
    }
    
    new = detect_secrets_compare.compare(current, baseline, [])
    assert len(new) == 1
    assert new[0]["file"] == "file1.txt"
