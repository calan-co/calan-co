# Pluggable Data Format Parsers & Schema Validators

## Supported Data Formats & Parsers

The following formats are supported out-of-the-box. The system is designed to be extensible and can support any structured data format—declarative or dynamic—via pluggable adapters and registry updates.

| Format | Parser Library         | Schema Validator      | Notes                       |
|--------|-----------------------|----------------------|-----------------------------|
| JSON   | `json`, `orjson`      | `jsonschema`         | Fast, widely supported      |
| XML    | `xml.etree`, `lxml`   | `xmlschema`, `lxml`  | XSD support via `xmlschema` |
| YAML   | `PyYAML`, `ruamel.yaml` | `cerberus`, `jsonschema` | YAML → JSON Schema mapping  |
| TOML   | `toml`, `tomli`       | `pydantic`, custom   | TOML → JSON Schema mapping  |

All parsers are wrapped in a pluggable adapter interface. New formats (e.g., CSV, INI, custom runtime objects) can be added with minimal changes.

---

## Editor Integration & Autocompletion

The modular, pluggable design enables integration with language servers, providing autocompletion and real-time validation for queries and schema paths in modern editors (e.g., VS Code, PyCharm). This improves developer experience and reduces errors at author time.

---

## Integration Plan for New Formats

1. **Implement a new parser adapter class** (e.g., `CsvParser`, `IniParser`) following the base `DataFormatParser` interface.
2. **Register the new parser** in the parser registry (e.g., `PARSER_REGISTRY`).
3. **Integrate schema validation** for the format, mapping to a normalized schema model if possible.
4. **Add tests and example data** for the new format.

Minimal changes: Only the registry and one new adapter/validator required.

---

## Schema Validation Modules

| Format | Schema Validator      | Example Schema Type |
|--------|----------------------|--------------------|
| JSON   | `jsonschema`         | JSON Schema        |
| XML    | `xmlschema`          | XSD               |
| YAML   | `jsonschema`, `cerberus` | JSON Schema, Cerberus |
| TOML   | `pydantic`, custom   | Pydantic Model, JSON Schema |

Each validator is modular and can be swapped or extended.

---

## Example Input Data & Validation Results

### JSON Example

**Input:**
```json
{
  "user": {
    "name": "Alice",
    "jobs": [
      { "title": "Engineer", "company": "Acme" }
    ]
  }
}
```
**Schema:**
```json
{
  "type": "object",
  "properties": {
    "user": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "jobs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "company": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```
**Validation Result:** ✔️ Valid

---

### XML Example

**Input:**
```xml
<user>
  <name>Alice</name>
  <jobs>
    <job>
      <title>Engineer</title>
      <company>Acme</company>
    </job>
  </jobs>
</user>
```
**Schema:** (XSD)
```xml
<xs:element name="user">
  <xs:complexType>
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="jobs">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="job" maxOccurs="unbounded">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="title" type="xs:string"/>
                  <xs:element name="company" type="xs:string"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
</xs:element>
```
**Validation Result:** ✔️ Valid

---

### YAML Example

**Input:**
```yaml
user:
  name: Alice
  jobs:
    - title: Engineer
      company: Acme
```
**Schema:** (JSON Schema, reused)
**Validation Result:** ✔️ Valid

---

### TOML Example

**Input:**
```toml
[user]
name = "Alice"

[[user.jobs]]
title = "Engineer"
company = "Acme"
```
**Schema:** (Pydantic Model or mapped JSON Schema)
**Validation Result:** ✔️ Valid

---

## Modular, Pluggable Parser Design

- Each format has a dedicated parser adapter class.
- All adapters implement a common interface: `parse(data: str) -> object`, `validate(data: object, schema: object) -> bool`.
- Registry pattern allows dynamic discovery and loading of parsers/validators.
- Adding new formats requires only a new adapter and registry entry.

---

## Minimal Changes for New Formats

- New format = new adapter + registry entry.
- No changes to core logic, query engine, or template parser.
- Schema validation is optional but recommended for consistency.

---

## Example: Registry Pattern (Python Pseudocode)

```python
class DataFormatParser:
    def parse(self, data: str) -> object: ...
    def validate(self, data: object, schema: object) -> bool: ...

PARSER_REGISTRY = {
    "json": JsonParser(),
    "xml": XmlParser(),
    "yaml": YamlParser(),
    "toml": TomlParser(),
    # Add new formats here
}
```

---

## Summary

- Supported formats: JSON, XML, YAML, TOML (extensible)
- Modular, pluggable parser/validator design
- Minimal integration steps for new formats
- Schema validation for each format
- Example data and validation results provided

This approach meets all acceptance criteria and is ready for implementation or documentation in your codebase.
