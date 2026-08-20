# Example templates and lint results for temple

from temple.src.linter import TemplateLinter

linter = TemplateLinter()

examples = {
    "valid_markdown": """
    # Resume
    {% if user.name %}
    ## {{ user.name }}
    {% end %}
    {% for job in user.jobs %}
    ### {{ job.title }} at {{ job.company }}
    - {{ job.start }} - {{ job.end }}
    {% end %}
    """,
    "invalid_markdown": """
    # Resume
    {% if user.name %}
    ## {{ user.name }}
    {% for job in user.jobs %}
    ### {{ job.title }} at {{ job.company }}
    - {{ job.start }} - {{ job.end }}
    {% end %}
    """,  # missing end
    "valid_html": """
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
    """,
    "invalid_html": """
    <html>
      <body>
        <h1>{{ user.name }}</h1>
        <ul>
          {% for skill in user.skills %}
          <li>{{ skill }}</li>
        </ul>
      </body>
    </html>
    """,  # missing end
    "valid_json": """
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
    """,
    "invalid_json": """
    {
      "name": "{{ user.name }}",
      "jobs": [
        {% for job in user.jobs %}
        {
          "title": "{{ job.title }}",
          "company": "{{ job.company }}"
        }{% if not loop.last %},{% end %}
      ]
    }
    """,  # missing end
}

for name, template in examples.items():
    print(f"Lint results for {name}:")
    errors = linter.lint(template)
    if errors:
        for err in errors:
            print(f"  {err}")
    else:
        print("  No errors found. Template is valid.")
    print()
