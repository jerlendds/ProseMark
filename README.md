# TMark

**TMark** is a fork of [J. Simon Richard's](https://github.com/jsimonrichard) fantastic [ProseMark](https://github.com/jsimonrichard/ProseMark) library with some additions such as table support. Table support is currently a work in progress and some bugs exist in the current implemention. Consider yourself warned. I'm planning to deviate signifcantly from standard markdown for a couple of my projects hence the reason for this hard fork. Please see [the original and it's author](https://github.com/jsimonrichard/ProseMark) and give them a star for the vast majority of work found in this project. Thanks for your work Richard :) TMark is a modular toolkit for building "What You See Is What You Mean" (WYSIWYM) markdown editors, a type of editor that merges the look of rendered markdown into the editor itself rather than rendering the markdown in a separate window. Two of the most well-known editors of this type are [Obsidian](https://obsidian.md/) and [Typora](https://typora.io/).

This project is structured as a set of extensions for [CodeMirror 6](https://codemirror.net/), and is broken up into the following packages:

- **[`@tmark/core`](https://www.npmjs.com/package/@prosemark/core):** the core functionality needed for the WYSIWYM editor.
- **[`@tmark/render-html`](https://www.npmjs.com/package/@prosemark/render-html):** renders raw HTML blocks in Markdown (sanitized with DOMPurify).
- **[`@tmark/latex`](https://www.npmjs.com/package/@prosemark/latex):** renders latex math (inside `$...$` / `$$...$$`) using MathJax.
- **[`@tmark/paste-rich-text`](https://www.npmjs.com/package/@prosemark/paste-rich-text):** enables pasting formatted rich text into the editor.
- **[`@tmark/spellcheck-frontend`](https://www.npmjs.com/package/@prosemark/spellcheck-frontend):** CodeMirror UI for spellcheck (underlines, suggestion tooltips, optional custom actions). You plug in your own spell engine and issue source; see the package README and [demo](https://prosemark.com/demo/).
- **[`@tmark/table`](https://www.npmjs.com/package/@prosemark/spellcheck-frontend):** CodeMirror UI for tables. (_Currently this is the only addition jerlendds has contributed to, everything else is thanks to Richard's work_)

## Features

- Inline styling including _italics_, **bold text**, `code spans`, and ~~strike throughs~~.
- Links
- Headings (ATX and Setext)
- Ordered and unordered lists
- Task (checkbox) lists
- Images
- Block quotes
- Code fences with syntax highlighting
- Rendered HTML when you add [`@prosemark/render-html`](https://www.npmjs.com/package/@prosemark/render-html)
- Dollar-delimited math (`$...$` / `$$...$$`) when you add [`@prosemark/latex`](https://www.npmjs.com/package/@prosemark/latex) (or use the VS Code LaTeX integration below)
- Spellcheck UI when using [`@prosemark/spellcheck-frontend`](https://www.npmjs.com/package/@prosemark/spellcheck-frontend) (you supply the dictionary / engine)
- Tables - **Work in progress**
- Mermaid diagrams - **Not completed**
- Frontmatter - **Not completed**
- _And perhaps if I have the time I'll add some other additions that are brewing in the back of my mind..._

## Getting started

Please see the original... https://github.com/jsimonrichard/ProseMark

## Notice

If you run into a bug in this library please file an issue. If this bug isn't a concern for my use case I will likely not implement a fix anytime soon *if ever*. Feel free to fork and maintain your own version, that's part of the beauty of having an open source commons.
