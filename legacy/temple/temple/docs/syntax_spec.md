# Temple DSL Syntax Specification

## 1. Syntax Overview

The Temple DSL overlays logic primitives directly onto the target output format (Markdown, HTML, JSON, etc.) using a consistent, minimal syntax. Logic tokens are designed to be ignorable by format linters, ensuring templates remain valid in their base format.

### Logic Token Format
- By default, all logic blocks use `{% ... %}` for statements and `{{ ... }}` for expressions.
- Whitespace inside tokens is ignored.
- Example: `{% if user.name %}Hello, {{ user.name }}!{% end %}`

### User-Specified Tokens
Users may configure custom delimiters for logic blocks and statements to avoid conflicts with the target format or to match personal/team preferences.

**Configuration Example:**
```yaml
temple:
  statement_start: "::"
  statement_end: "::"
  expression_start: "<<"
  expression_end: ">>"
```

**Usage Example:**
```markdown
:: if user.name ::
Hello, << user.name >>!
:: end ::
```

The temple system should allow these tokens to be set via configuration (YAML, JSON, CLI flags, etc.), and all logic parsing will respect the chosen delimiters.

## 2. Supported Logic Primitives
- **Variable Insertion:** `{{ variable }}`
-- **Conditionals:** `{% if condition %}...{% else if condition %}...{% else %}...{% end %}`
- **Loops:** `{% for item in collection %}...{% end %}`
- **Includes:** `{% include "filename.md" %}`
- **User-Defined Functions:** `{% function name(args) %}...{% end %}`
- **Comments:** `{# This is a comment #}`

All primitives support custom tokens. For example, with the configuration above:
- **Variable Insertion:** `<< variable >>`
-- **Conditionals:** `[[ if condition ]]...[[ else if condition ]]...[[ else ]]...[[ end ]]`
- **Loops:** `[[ for item in collection ]]...[[ end ]]`
- **Includes:** `[[ include "filename.md" ]]`
- **User-Defined Functions:** `[[ function name(args) ]]...[[ end ]]`
- **Comments:** `[## This is a comment ##]` (if comment tokens are also configurable)

## 3. Example Templates

### Markdown
```markdown
# Resume

{% if user.name %}
## {{ user.name }}
{% end %}

{% for job in user.jobs %}
### {{ job.title }} at {{ job.company }}
- {{ job.start }} - {{ job.end }}
{% end %}
```

### HTML
```html
<html>
  <body>
    <h1>{{ user.name }}</h1>
    <ul>
      {% for skill in user.skills %}
      <li>{{ skill }}</li>
      {% end %}
    </ul>
  </body>
</html>
```

### JSON
```json
{
  "name": "{{ user.name }}",
  "jobs": [
    {% for job in user.jobs %}
    {
      "title": "{{ job.title }}",
      "company": "{{ job.company }}"
    }{% if not loop.last %},{% end %}
    {% end %}
  ]
}
```

## 4. Token Model and Position Tracking

### Token Structure

All template tokens use a unified model across temple and temple-linter projects:

```python
class TemplateToken:
    type: str              # 'base', 'statement', 'expression', 'comment'
    value: str             # Token content (stripped of delimiters)
    start: Tuple[int, int] # (line, col) - start position
    end: Tuple[int, int]   # (line, col) - end position
```

### Position Semantics

**Convention: 0-indexed for both line and column**

- `line`: Line number starting from 0 (first line is 0)
- `col`: Column number within line starting from 0 (first character is 0)
- Both `start` and `end` positions are inclusive
- Positions advance character-by-character, with newlines resetting column to 0

### Position Calculation Examples

**Example 1: Single-line token**
```
Text: "Hello {{ user.name }} world"
       0123456789...
```
- Token `{{ user.name }}` 
- `start`: (0, 6) - starts at column 6 of line 0
- `end`: (0, 21) - ends at column 21 of line 0

**Example 2: Multi-line token**
```
Line 0: "Hello {% if user.name %}"
Line 1: "  Welcome!"
Line 2: "{% end %}"
```
- Token `{% if user.name %}`
- `start`: (0, 6) - starts at column 6 of line 0
- `end`: (0, 25) - ends at column 25 of line 0

- Token (base text) `"  Welcome!\n"`
- `start`: (1, 0) - starts at column 0 of line 1
- `end`: (2, 0) - ends at start of line 2 (after newline)

**Example 3: Multi-line statement block**
```
Line 0: "{% for item in items %}"
Line 1: "  {{ item }}"
Line 2: "{% end %}"
```
- Statement token: `start`: (0, 0), `end`: (0, 24)
- Expression token: `start`: (1, 2), `end`: (1, 13)
- Statement token: `start`: (2, 0), `end`: (2, 13)

### Usage in Error Reporting

Position tuples enable precise error messages:

```python
# Example: Undefined variable error
token = TemplateToken('expression', 'user.missing_field', start=(5, 10), end=(5, 32))
error = f"Undefined variable 'user.missing_field' at line {token.start[0] + 1}, column {token.start[1] + 1}"
# Output: "Undefined variable 'user.missing_field' at line 6, column 11"
# Note: +1 converts 0-indexed positions to 1-indexed for human-readable output
```

### Diagnostic Mapping

The (line, col) tuple model is essential for mapping diagnostics between:
1. **Original template** - Contains DSL tokens
2. **Preprocessed template** - DSL tokens stripped for base format linting
3. **Error positions** - Must map back to original template positions

See `temple-linter/src/temple_linter/diagnostics.py` for implementation details.

## 5. User-Defined Functions

### Definition
```markdown
{% function format_date(date) %}
{{ date | date("YYYY-MM-DD") }}
{% end %}
```

### Usage
```markdown
- Start Date: {{ format_date(job.start) }}
```

## 5. Acceptance Criteria Mapping
- **Readability:** DSL overlays do not break format linting; logic tokens are ignorable.
- **Consistency:** Primitives and syntax are identical across formats.
- **User Functions:** Supported via `{% function ... %}` blocks.
- **Linting:** Example templates pass format linters when logic is ignored.
