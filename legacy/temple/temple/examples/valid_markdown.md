# Resume
{% if user.name %}
## {{ user.name }}
{% end %}
{% for job in user.jobs %}
### {{ job.title }} at {{ job.company }}
- {{ job.start }} - {{ job.end }}
{% end %}
