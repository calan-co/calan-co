# Temple Query Language & Schema Validation Specification

## 1. Query Language Specification
### Query Language Registry
- The query language registry should include the supported model language types (e.g., JSON, XML, YAML, TOML, etc.) for validation purposes. This enables the system to select the correct query engine and validation logic based on the input data format.
### Language Server Support
- The query language should support integration with language servers to provide auto-completion and real-time validation for queries in templates. This enables better developer experience and reduces errors at author time.

### Supported Query Syntaxes
- **Dot Notation:** Simple property access, e.g., `user.name`, `job.company`.
- **JMESPath:** Advanced querying, e.g., `user.jobs[?title=='Engineer'].company`.
- **Pluggable Query Engines:** System supports additional query languages via adapters.

### Query Usage in Templates
- **Variable Insertion:** `{{ user.name }}` or `{{ user.jobs[0].title }}`
- **Conditionals:** `{% if user.active %}...{% end %}`
- **Loops:** `{% for job in user.jobs %}...{% end %}`

### Query Consistency
- Queries are designed to be format-agnostic, but actual support depends on the capabilities of the pluggable query engine and available adapters for each data format. The same syntax applies across formats only if supported by the engine and adapters.
Queries are validated at author time for correctness and schema compliance.

---

## 2. Schema Validation Integration Plan
> **Note:** Schema detection, parsing, query validation, and feedback are ideally implemented via language server features, providing real-time validation and auto-completion in editors. CLI and other tooling may also implement these steps, but language servers are recommended for best developer experience.

### Goals
- Validate queries against input data schemas (e.g., JSON Schema, XML Schema).
- Ensure queries only access valid properties/paths.
- Provide real-time feedback in CLI/editor.

### Integration Steps
1. **Object Model Structure Detection:** Detect the structure of the input data, either via explicit schema (JSON Schema, XML Schema, etc.) or by inferring from the data itself (runtime objects, dynamic languages).
2. **Schema Parsing:** Parse schema into a normalized internal representation.
3. **Query Validation:** For each query in the template, check if the path exists and is valid in the schema. For JMESPath, validate expressions against the schema structure.
4. **Feedback:** On validation failure, provide actionable error messages. On success, annotate queries as valid.


### Supported Object Model Structures
Validation can be performed against:
  - **Explicit Schemas:**
    - **JSON Schema:** Validate dot notation and JMESPath queries.
    - **XML Schema:** Validate XPath-like queries and mapped JMESPath.
    - **YAML/TOML:** Use JSON Schema or custom schema definitions.
  - **Inferred/Runtime Structures:**
    - Structures detected from actual input data at runtime (dynamic languages, runtime objects, loosely-typed data).

---

## 3. Example Queries & Validation Results

### Example 1: JSON Input
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
**Queries:**
- `user.name` → Valid
- `user.jobs[0].title` → Valid
- `user.address` → Invalid (not in schema)

**Validation Results:**
- `user.name`: ✔️ Valid
- `user.jobs[0].title`: ✔️ Valid
- `user.address`: ❌ Error: "Property 'address' not found in schema for 'user'."

---

### Example 2: XML Input
**Schema:** (XSD)
```xml
<xs:element name="user">
  <xs:complexType>
    <xs:sequence>
      <xs:element name="name" type="xs:string"/>
      <xs:element name="jobs" type="xs:string" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>
</xs:element>
```
**Queries:**
- `user.name` → Valid
- `user.jobs[0]` → Valid
- `user.email` → Invalid

**Validation Results:**
- `user.name`: ✔️ Valid
- `user.jobs[0]`: ✔️ Valid
- `user.email`: ❌ Error: "Element 'email' not defined in schema for 'user'."

---

### Example 3: JMESPath
**Query:** `user.jobs[?company=='Acme'].title`
- Valid if `company` and `title` exist in schema.

**Validation Result:**
✔️ Valid if schema includes `company` and `title` under `user.jobs`.

---

## 4. Error Handling Strategy

### At Author Time
- **Invalid Path:** Error: "Property 'X' not found in schema for 'Y'."
- **Type Mismatch:** Error: "Expected type 'array' for 'jobs', got 'string'."
- **Syntax Error:** Error: "Malformed query: missing closing bracket."
- **Unsupported Query:** Error: "Query language 'XYZ' not supported for this data format."

### Reporting
- Inline error annotations in template.
- Summary of all query errors after lint/validation pass.
- Best-effort rendering: output with error annotations if possible.

---

## 5. Readability & Consistency
- Queries use the same syntax across all output formats.
- Validation ensures queries are correct before rendering.
- Error messages are clear, actionable, and reference both the query and the schema location.

---

# Summary
- **Query Language:** Dot notation, JMESPath, pluggable engines; consistent across formats.
- **Schema Validation:** Integrated for JSON, XML, YAML, TOML; validates queries at author time.
- **Examples:** Provided for JSON and XML, with validation results.
- **Error Handling:** Inline and summary reporting, clear messages, best-effort output.
- **Consistency:** Queries and validation are format-agnostic and readable.
