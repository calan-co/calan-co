# Mechanizing Ceremony Log Capture

This guide describes best practices and tooling for capturing ceremony logs consistently and efficiently.

## Automation Goals

1. **Session ID generation** - Unique, timestamped identifiers
2. **Template instantiation** - Pre-populated with metadata
3. **Work item linking** - Auto-discover related items from git commits and use `[[wikilink]]`-style references
4. **Test evidence collection** - Capture test framework output and metrics
5. **Frontmatter validation** - Ensure required fields are present

## Implementation Approaches

### Option A: Shell Script (Lightweight)

```bash
#!/bin/bash
# scripts/capture-session.sh - Create a new ceremony log entry

SESSION_ID="session-$(date +%Y%m%d-%H%M%S)"
TEMPLATE="temple/docs/ceremony-log/TEMPLATE.md"
OUTPUT="temple/docs/ceremony-log/${SESSION_ID}.md"

# Populate from environment or git
cp "$TEMPLATE" "$OUTPUT"
sed -i.bak "s/YYYY-MM-DD/$(date +%Y-%m-%d)/g" "$OUTPUT"
sed -i.bak "s/descriptive-id-timestamp/${SESSION_ID}/g" "$OUTPUT"

# Extract related work items from recent commits
WORK_ITEMS=$(git log --oneline HEAD~10..HEAD | grep -oE '#[0-9]+' | sort -u)
sed -i.bak "s/\[#XX, #XX\]/[$WORK_ITEMS]/g" "$OUTPUT"

echo "Ceremony log created: $OUTPUT"
editor "$OUTPUT"  # Open for editing
```

### Option B: Python Tool (More Intelligent)

```python
# scripts/session_capture.py
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
import yaml

def extract_work_items_from_commits(num_commits=15):
    """Parse git log to find referenced work items."""
    result = subprocess.run(
        f'git log --oneline HEAD~{num_commits}..HEAD',
        shell=True, capture_output=True, text=True
    )
    import re
    items = set(re.findall(r'#(\d+)', result.stdout))
    return sorted(items)

def get_test_results():
    """Capture recent test run evidence."""
    result = subprocess.run(
        'pytest --co -q 2>/dev/null | tail -1',
        shell=True, capture_output=True, text=True
    )
    return result.stdout.strip()

def create_ceremony_log_entry(title, work_items, adr_refs=None):
    """Generate a pre-populated ceremony log entry."""
    session_id = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    frontmatter = {
        'date': datetime.now().strftime('%Y-%m-%d'),
        'session_id': session_id,
        'type': 'postmortem',
        'related_work_items': work_items,
        'related_adr': adr_refs or []
    }
    
    output_path = Path('temple/docs/ceremony-log') / f'{session_id}.md'
    
    with open(output_path, 'w') as f:
        f.write('---\n')
        yaml.dump(frontmatter, f)
        f.write('---\n\n')
        f.write(f'# {title}\n\n')
        f.write(Path('temple/docs/ceremony-log/TEMPLATE.md').read_text()[100:])
    
    return str(output_path)
```

### Option C: Git Hooks (Automatic)

Add to `.git/hooks/post-commit`:

```bash
#!/bin/bash
# Auto-suggest ceremony log entry for certain commit patterns

if git log -1 --oneline | grep -qE '(chore: finalize|docs: add.*summary)'; then
    echo "💡 Consider capturing a session post-mortem:"
    echo "   ./scripts/capture-session.sh"
fi
```

## Integration with CI/CD

Add to `.github/workflows/`:

```yaml
- name: Archive Session Summary (if available)
  if: always()
  run: |
    if [ -f "IMPLEMENTATION_SUMMARY.md" ]; then
      SESSION_ID=$(date +%Y%m%d-%H%M%S)
      mv IMPLEMENTATION_SUMMARY.md "temple/docs/ceremony-log/session-${SESSION_ID}.md"
      git add "temple/docs/ceremony-log/session-${SESSION_ID}.md"
    fi
```

## Recommended Workflow

1. **During Session**: Agent/developer notes work items, decisions, and blockers
2. **Session End**: Run `capture-session.sh` to create timestamped entry
3. **Edit**: Fill in narrative, insights, and follow-ups
4. **Commit**: `git add temple/docs/ceremony-log/*.md && git commit -m "docs(ceremony): session-YYYYMMDD-HHmmSS"`
5. **Reference**: Link from related work items' notes field

## Validation Script

```bash
#!/bin/bash
# scripts/validate-ceremony-logs.sh

for log in temple/docs/ceremony-log/session-*.md; do
  echo "Validating $log..."
  
  # Check frontmatter
  grep -q "^date:" "$log" || echo "  ❌ Missing 'date' field"
  grep -q "^session_id:" "$log" || echo "  ❌ Missing 'session_id' field"
  grep -q "^type:" "$log" || echo "  ❌ Missing 'type' field"
  grep -q "^related_work_items:" "$log" || echo "  ⚠️  No work items referenced"
  
  # Check markdown structure
  grep -q "^# " "$log" || echo "  ❌ Missing title"
  grep -q "^## Context" "$log" || echo "  ⚠️  Missing 'Context' section"
done
```

## When to Capture

- ✅ After completing 2+ related work items
- ✅ When resolving architectural issues
- ✅ After major design decisions
- ✅ Following hard-learned lessons
- ❌ Every single commit (too noisy)
- ❌ Trivial changes (missing opportunities for learning)

## Discoverability

Link ceremony logs from:

1. Related work item `notes` field
2. ADR implementation notes
3. CHANGELOG strategic sections
4. Project milestones

Example in backlog item:

```yaml
notes: |
  See session ceremony log: [[session-YYYYMMDD-HHMMSS.md]]
```

---

**Status**: Recommended for implementation  
**Estimated Setup**: 2-3 hours for Option B (Python tool)  
**Maintenance**: Script runs on-demand or via git hooks
