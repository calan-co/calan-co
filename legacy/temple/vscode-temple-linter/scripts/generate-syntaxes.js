const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SYNTAX_DIR = path.join(ROOT, "syntaxes");
const SCHEMA_URL =
  "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json";

const INJECTION_SELECTOR =
  "L:text.html.markdown, L:source.json, L:source.yaml, L:text.html.basic, L:text.xml, L:source.toml";

const sharedRepository = {
  templeComment: {
    name: "comment.block.temple",
    begin: "\\{#",
    beginCaptures: {
      0: {
        name: "punctuation.definition.comment.begin.temple",
      },
    },
    end: "#\\}",
    endCaptures: {
      0: {
        name: "punctuation.definition.comment.end.temple",
      },
    },
  },
  templeStatement: {
    name: "meta.statement.temple",
    begin: "\\{%",
    beginCaptures: {
      0: {
        name: "punctuation.section.embedded.begin.temple",
      },
    },
    end: "%\\}",
    endCaptures: {
      0: {
        name: "punctuation.section.embedded.end.temple",
      },
    },
    patterns: [
      {
        match: "\\b(if|elif|else|for|in|include|set|end|not|and|or)\\b",
        name: "keyword.control.temple",
      },
      {
        include: "#number",
      },
      {
        include: "#string",
      },
      {
        match: "\\b[A-Za-z_][A-Za-z0-9_]*\\b",
        name: "variable.other.temple",
      },
      {
        match: "[\\[\\]\\(\\)\\.,:|]",
        name: "punctuation.separator.temple",
      },
    ],
  },
  templeExpression: {
    name: "meta.expression.temple",
    begin: "\\{\\{",
    beginCaptures: {
      0: {
        name: "punctuation.section.embedded.begin.temple",
      },
    },
    end: "\\}\\}",
    endCaptures: {
      0: {
        name: "punctuation.section.embedded.end.temple",
      },
    },
    patterns: [
      {
        include: "#number",
      },
      {
        include: "#string",
      },
      {
        match: "\\b(true|false|null)\\b",
        name: "constant.language.temple",
      },
      {
        match: "\\b[A-Za-z_][A-Za-z0-9_]*\\b",
        name: "variable.other.temple",
      },
      {
        match: "[\\[\\]\\(\\)\\.,:|]",
        name: "punctuation.separator.temple",
      },
    ],
  },
  number: {
    match: "\\b-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?\\b",
    name: "constant.numeric.temple",
  },
  string: {
    patterns: [
      {
        name: "string.quoted.double.temple",
        begin: "\"",
        end: "\"",
        patterns: [
          {
            match: "\\\\.",
            name: "constant.character.escape.temple",
          },
        ],
      },
      {
        name: "string.quoted.single.temple",
        begin: "'",
        end: "'",
        patterns: [
          {
            match: "\\\\.",
            name: "constant.character.escape.temple",
          },
        ],
      },
    ],
  },
};

const templeOnlyPatterns = [
  { include: "#templeComment" },
  { include: "#templeStatement" },
  { include: "#templeExpression" },
];

function buildGrammar({ name, scopeName, injectionSelector, baseScopeInclude }) {
  const patterns = baseScopeInclude
    ? [{ include: baseScopeInclude }, ...templeOnlyPatterns]
    : templeOnlyPatterns;
  const grammar = {
    $schema: SCHEMA_URL,
    name,
    scopeName,
    patterns,
    repository: sharedRepository,
  };

  if (injectionSelector) {
    grammar.injectionSelector = injectionSelector;
  }

  return grammar;
}

function writeSyntaxFile(fileName, grammar) {
  const targetPath = path.join(SYNTAX_DIR, fileName);
  const serialized = `${JSON.stringify(grammar, null, 2)}\n`;
  fs.writeFileSync(targetPath, serialized, "utf8");
}

function main() {
  fs.mkdirSync(SYNTAX_DIR, { recursive: true });

  writeSyntaxFile(
    "templ-any.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated File",
      scopeName: "source.templ-any",
    })
  );

  writeSyntaxFile(
    "templ-markdown.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated Markdown",
      scopeName: "source.templ-markdown",
      baseScopeInclude: "text.html.markdown",
    })
  );
  writeSyntaxFile(
    "templ-json.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated JSON",
      scopeName: "source.templ-json",
      baseScopeInclude: "source.json",
    })
  );
  writeSyntaxFile(
    "templ-yaml.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated YAML",
      scopeName: "source.templ-yaml",
      baseScopeInclude: "source.yaml",
    })
  );
  writeSyntaxFile(
    "templ-html.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated HTML",
      scopeName: "source.templ-html",
      baseScopeInclude: "text.html.basic",
    })
  );
  writeSyntaxFile(
    "templ-xml.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated XML",
      scopeName: "source.templ-xml",
      baseScopeInclude: "text.xml",
    })
  );
  writeSyntaxFile(
    "templ-toml.tmLanguage.json",
    buildGrammar({
      name: "Temple Templated TOML",
      scopeName: "source.templ-toml",
      baseScopeInclude: "source.toml",
    })
  );

  writeSyntaxFile(
    "temple.injection.tmLanguage.json",
    buildGrammar({
      name: "Temple Injection",
      scopeName: "temple.injection",
      injectionSelector: INJECTION_SELECTOR,
    })
  );
}

main();
