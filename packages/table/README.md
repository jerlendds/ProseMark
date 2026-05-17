# @prosemark/table

Editable Markdown table widgets for ProseMark / CodeMirror.

```ts
import { markdownTableExtension } from '@prosemark/table';

new EditorView({
  extensions: [markdown({ extensions: [GFM] }), markdownTableExtension],
});
```

The extension recognizes GitHub-flavored pipe tables, renders them as editable
tables, commits cell edits back to Markdown, and shows an add-column affordance
on the right edge of the last column.
