import {
  type ChangeSpec,
  type EditorState,
  type Extension,
  StateField,
  Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';

type TableAlignment = 'left' | 'center' | 'right' | null;

interface ParsedTable {
  from: number;
  to: number;
  source: string;
  columns: number;
  alignments: TableAlignment[];
  rows: string[][];
  delimiter: ParsedLine;
  rowLines: ParsedLine[];
}

interface ParsedLine {
  from: number;
  to: number;
  text: string;
  cells: string[];
}

interface CellPosition {
  rowIndex: number;
  columnIndex: number;
  appendRow: boolean;
}

interface TableCompletionChange {
  from: number;
  to: number;
  insert: string;
}

interface TableCompletionFocus {
  tableFrom: number;
  rowIndex: number;
  columnIndex: number;
}

interface TableCompletionResult {
  changes: TableCompletionChange[];
  focus: TableCompletionFocus | null;
}

interface CellCoordinate {
  rowIndex: number;
  columnIndex: number;
}

interface CellSelection {
  rowFrom: number;
  rowTo: number;
  columnFrom: number;
  columnTo: number;
}

const TABLE_WIDGET_CLASS = 'cm-markdown-table';
const TABLE_CELL_CLASS = 'cm-markdown-table__cell';
const TABLE_SELECTED_CELL_CLASS = 'cm-markdown-table__cell--selected';
const TABLE_LAST_CELL_CLASS = 'cm-markdown-table__cell--last';
const TABLE_INPUT_CLASS = 'cm-markdown-table__input';
const ADD_COLUMN_CLASS = 'cm-markdown-table__add-column';

const hasUnescapedPipe = (line: string): boolean => {
  let escaped = false;
  for (const char of line) {
    if (char === '|' && !escaped) return true;
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }
  return false;
};

const splitTableLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of line) {
    if (char === '|' && !escaped) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }

  cells.push(current);

  if (cells.length > 1 && cells[0]?.trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1]?.trim() === '') cells.pop();

  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'));
};

const parseAlignment = (cell: string): TableAlignment | undefined => {
  const value = cell.trim();
  if (!/^:?-{3,}:?$/.test(value)) return undefined;
  const starts = value.startsWith(':');
  const ends = value.endsWith(':');
  if (starts && ends) return 'center';
  if (starts) return 'left';
  if (ends) return 'right';
  return null;
};

const isDelimiterLine = (
  line: string,
): { cells: string[]; alignments: TableAlignment[] } | null => {
  if (!hasUnescapedPipe(line)) return null;

  const cells = splitTableLine(line);
  if (cells.length === 0) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    const alignment = parseAlignment(cell);
    if (alignment === undefined) return null;
    alignments.push(alignment);
  }

  return { cells, alignments };
};

const normalizeCells = <T>(
  cells: readonly T[],
  columns: number,
  fill: T,
): T[] => {
  const normalized = cells.slice(0, columns);
  while (normalized.length < columns) normalized.push(fill);
  return normalized;
};

const parseLine = (state: EditorState, lineNumber: number): ParsedLine => {
  const line = state.doc.line(lineNumber);
  return {
    from: line.from,
    to: line.to,
    text: line.text,
    cells: splitTableLine(line.text),
  };
};

const startsFence = (line: string): string | null => {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[1]?.[0] ?? null;
};

const findMarkdownTables = (state: EditorState): ParsedTable[] => {
  const tables: ParsedTable[] = [];
  let fenceMarker: string | null = null;
  let lineNumber = 1;

  while (lineNumber <= state.doc.lines) {
    const line = state.doc.line(lineNumber);
    const fence = startsFence(line.text);
    if (fence) {
      if (fenceMarker === fence) {
        fenceMarker = null;
      } else {
        fenceMarker ??= fence;
      }
      lineNumber += 1;
      continue;
    }

    if (
      fenceMarker ||
      lineNumber >= state.doc.lines ||
      /^ {4}/.test(line.text) ||
      !hasUnescapedPipe(line.text)
    ) {
      lineNumber += 1;
      continue;
    }

    const delimiterLine = state.doc.line(lineNumber + 1);
    const delimiter = isDelimiterLine(delimiterLine.text);
    if (!delimiter) {
      lineNumber += 1;
      continue;
    }

    const header = parseLine(state, lineNumber);
    if (header.cells.length === 0) {
      lineNumber += 1;
      continue;
    }

    const body: ParsedLine[] = [];
    let endLineNumber = lineNumber + 1;
    while (endLineNumber + 1 <= state.doc.lines) {
      const candidate = state.doc.line(endLineNumber + 1);
      if (!hasUnescapedPipe(candidate.text) || /^ {4}/.test(candidate.text)) {
        break;
      }
      body.push(parseLine(state, endLineNumber + 1));
      endLineNumber += 1;
    }

    const columns = Math.max(
      header.cells.length,
      delimiter.cells.length,
      ...body.map((row) => row.cells.length),
    );
    const alignments = normalizeCells(delimiter.alignments, columns, null).map(
      (alignment) => alignment ?? null,
    );
    const rows = [
      normalizeCells(header.cells, columns, ''),
      ...body.map((row) => normalizeCells(row.cells, columns, '')),
    ];
    const to = state.doc.line(endLineNumber).to;

    tables.push({
      from: header.from,
      to,
      source: state.doc.sliceString(header.from, to),
      columns,
      alignments,
      rows,
      delimiter: {
        from: delimiterLine.from,
        to: delimiterLine.to,
        text: delimiterLine.text,
        cells: delimiter.cells,
      },
      rowLines: [header, ...body],
    });

    lineNumber = endLineNumber + 1;
  }

  return tables;
};

const escapeCell = (value: string): string =>
  value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

const serializeDelimiter = (alignment: TableAlignment): string => {
  switch (alignment) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
};

const serializeRow = (cells: readonly string[]): string =>
  `| ${cells.map(escapeCell).join(' | ')} |`;

const serializeDelimiterRow = (alignments: readonly TableAlignment[]): string =>
  `| ${alignments.map(serializeDelimiter).join(' | ')} |`;

const serializeTable = (table: ParsedTable): string => {
  const header =
    table.rows[0] ?? Array.from({ length: table.columns }, () => '');
  const body = table.rows.slice(1);
  return [
    serializeRow(header),
    serializeDelimiterRow(table.alignments),
    ...body.map(serializeRow),
  ].join('\n');
};

const buildTableCompletionChanges = (
  state: EditorState,
): TableCompletionResult => {
  const changes: TableCompletionChange[] = [];
  let focus: TableCompletionFocus | null = null;

  for (const table of findMarkdownTables(state)) {
    const needsDelimiterCompletion =
      table.delimiter.cells.length < table.columns;
    const needsInitialBodyRow = table.rowLines.length === 1;
    const initialBodyRow = serializeRow(
      Array.from({ length: table.columns }, () => ''),
    );

    if (needsInitialBodyRow && !focus) {
      focus = {
        tableFrom: table.from,
        rowIndex: 1,
        columnIndex: 0,
      };
    }

    table.rowLines.forEach((line, rowIndex) => {
      if (line.cells.length >= table.columns) return;
      if (!line.text.trimEnd().endsWith('|')) return;
      if (!line.cells.some((cell) => cell.length > 0)) return;

      changes.push({
        from: line.from,
        to: line.to,
        insert: serializeRow(table.rows[rowIndex] ?? []),
      });
    });

    if (needsDelimiterCompletion) {
      changes.push({
        from: table.delimiter.from,
        to: table.delimiter.to,
        insert: `${serializeDelimiterRow(table.alignments)}${
          needsInitialBodyRow ? `\n${initialBodyRow}` : ''
        }`,
      });
    } else if (needsInitialBodyRow) {
      changes.push({
        from: table.delimiter.to,
        to: table.delimiter.to,
        insert: `\n${initialBodyRow}`,
      });
    }
  }

  return { changes: changes.sort((a, b) => a.from - b.from), focus };
};

const tableCompletionPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      if (!update.docChanged) return;

      requestAnimationFrame(() => {
        const { changes, focus } = buildTableCompletionChanges(
          update.view.state,
        );
        if (changes.length === 0) return;

        update.view.dispatch({
          changes,
          annotations: [Transaction.userEvent.of('table.complete')],
        });

        if (focus) {
          focusTableCell(
            update.view,
            focus.tableFrom,
            focus.rowIndex,
            focus.columnIndex,
          );
        }
      });
    }
  },
);

const updateTable = (
  view: EditorView,
  table: ParsedTable,
  mutate: (next: ParsedTable) => void,
): boolean => {
  if (view.state.doc.sliceString(table.from, table.to) !== table.source) {
    return false;
  }

  const next: ParsedTable = {
    ...table,
    alignments: [...table.alignments],
    rows: table.rows.map((row) => [...row]),
  };
  mutate(next);

  const changes: ChangeSpec = {
    from: table.from,
    to: table.to,
    insert: serializeTable(next),
  };
  view.dispatch({ changes });
  return true;
};

const addColumnToRight = (view: EditorView, table: ParsedTable): void => {
  updateTable(view, table, (next) => {
    next.columns += 1;
    next.alignments.push(null);
    for (const row of next.rows) row.push('');
  });
};

const commitCell = (
  view: EditorView,
  table: ParsedTable,
  rowIndex: number,
  columnIndex: number,
  value: string,
): void => {
  updateTable(view, table, (next) => {
    const row = next.rows[rowIndex];
    if (!row) return;
    row[columnIndex] = value;
  });
};

const getNextCellPosition = (
  table: ParsedTable,
  rowIndex: number,
  columnIndex: number,
): CellPosition => {
  if (columnIndex + 1 < table.columns) {
    return { rowIndex, columnIndex: columnIndex + 1, appendRow: false };
  }

  if (rowIndex + 1 < table.rows.length) {
    return { rowIndex: rowIndex + 1, columnIndex: 0, appendRow: false };
  }

  return {
    rowIndex: table.rows.length,
    columnIndex: 0,
    appendRow: true,
  };
};

const focusTableCell = (
  view: EditorView,
  tableFrom: number,
  rowIndex: number,
  columnIndex: number,
  attempts = 8,
): void => {
  requestAnimationFrame(() => {
    const root = view.dom.querySelector<HTMLElement>(
      `.${TABLE_WIDGET_CLASS}[data-table-from="${String(tableFrom)}"]`,
    );
    const cell = root?.querySelector<HTMLElement>(
      `[data-row-index="${String(rowIndex)}"][data-column-index="${String(
        columnIndex,
      )}"]`,
    );
    if (cell) {
      cell.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      return;
    }

    if (attempts > 1) {
      focusTableCell(view, tableFrom, rowIndex, columnIndex, attempts - 1);
    }
  });
};

const moveToNextCell = (
  view: EditorView,
  table: ParsedTable,
  rowIndex: number,
  columnIndex: number,
  value: string,
): boolean => {
  const nextCell = getNextCellPosition(table, rowIndex, columnIndex);
  const currentValue = table.rows[rowIndex]?.[columnIndex] ?? '';
  const needsDocUpdate = nextCell.appendRow || value !== currentValue;

  if (!needsDocUpdate) {
    focusTableCell(view, table.from, nextCell.rowIndex, nextCell.columnIndex);
    return false;
  }

  const updated = updateTable(view, table, (next) => {
    const row = next.rows[rowIndex];
    if (row) row[columnIndex] = value;
    if (nextCell.appendRow) {
      next.rows.push(Array.from({ length: next.columns }, () => ''));
    }
  });

  if (updated) {
    focusTableCell(view, table.from, nextCell.rowIndex, nextCell.columnIndex);
  }

  return updated;
};

const renderCellText = (cell: HTMLElement, value: string): void => {
  cell.textContent = value.length > 0 ? value : '\u00a0';
};

const isSelectAllKey = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === 'a' &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey;

const inputMeasureElement = (): HTMLElement => {
  let measure = document.querySelector<HTMLElement>(
    `.${TABLE_INPUT_CLASS}-measure`,
  );
  if (!measure) {
    measure = document.createElement('span');
    measure.className = `${TABLE_INPUT_CLASS}-measure`;
    document.body.appendChild(measure);
  }
  return measure;
};

const resizeInputToContent = (input: HTMLInputElement): void => {
  const measure = inputMeasureElement();
  const style = getComputedStyle(input);
  measure.style.font = style.font;
  measure.style.letterSpacing = style.letterSpacing;
  measure.textContent = input.value.length > 0 ? input.value : ' ';
  input.style.width = `${String(Math.ceil(measure.getBoundingClientRect().width) + 2)}px`;
};

const cellCoordinate = (cell: HTMLElement): CellCoordinate | null => {
  const rowIndex = Number(cell.dataset['rowIndex']);
  const columnIndex = Number(cell.dataset['columnIndex']);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
    return null;
  }

  return { rowIndex, columnIndex };
};

const cellSelection = (
  start: CellCoordinate,
  end: CellCoordinate,
): CellSelection => ({
  rowFrom: Math.min(start.rowIndex, end.rowIndex),
  rowTo: Math.max(start.rowIndex, end.rowIndex),
  columnFrom: Math.min(start.columnIndex, end.columnIndex),
  columnTo: Math.max(start.columnIndex, end.columnIndex),
});

const clearSelectedCells = (root: HTMLElement): void => {
  root.querySelectorAll(`.${TABLE_SELECTED_CELL_CLASS}`).forEach((cell) => {
    cell.classList.remove(TABLE_SELECTED_CELL_CLASS);
  });
};

const selectCellRectangle = (
  root: HTMLElement,
  start: CellCoordinate,
  end: CellCoordinate,
): void => {
  const selection = cellSelection(start, end);
  clearSelectedCells(root);

  root.querySelectorAll<HTMLElement>(`.${TABLE_CELL_CLASS}`).forEach((cell) => {
    const coordinate = cellCoordinate(cell);
    if (!coordinate) return;

    if (
      coordinate.rowIndex >= selection.rowFrom &&
      coordinate.rowIndex <= selection.rowTo &&
      coordinate.columnIndex >= selection.columnFrom &&
      coordinate.columnIndex <= selection.columnTo
    ) {
      cell.classList.add(TABLE_SELECTED_CELL_CLASS);
    }
  });
};

const selectedCellSelection = (root: HTMLElement): CellSelection | null => {
  const coordinates = [
    ...root.querySelectorAll<HTMLElement>(`.${TABLE_SELECTED_CELL_CLASS}`),
  ]
    .map(cellCoordinate)
    .filter((coordinate): coordinate is CellCoordinate => !!coordinate);

  if (coordinates.length === 0) return null;

  return {
    rowFrom: Math.min(...coordinates.map((coordinate) => coordinate.rowIndex)),
    rowTo: Math.max(...coordinates.map((coordinate) => coordinate.rowIndex)),
    columnFrom: Math.min(
      ...coordinates.map((coordinate) => coordinate.columnIndex),
    ),
    columnTo: Math.max(
      ...coordinates.map((coordinate) => coordinate.columnIndex),
    ),
  };
};

const currentTableForRoot = (
  state: EditorState,
  root: HTMLElement,
): ParsedTable | null => {
  const tableFrom = Number(root.dataset['tableFrom']);
  if (!Number.isFinite(tableFrom)) return null;
  return (
    findMarkdownTables(state).find((table) => table.from === tableFrom) ?? null
  );
};

const deleteSelectedCells = (view: EditorView, root: HTMLElement): boolean => {
  const selection = selectedCellSelection(root);
  const table = currentTableForRoot(view.state, root);
  if (!selection || !table) return false;

  const updated = updateTable(view, table, (next) => {
    for (
      let rowIndex = selection.rowFrom;
      rowIndex <= selection.rowTo;
      rowIndex += 1
    ) {
      const row = next.rows[rowIndex];
      if (!row) continue;

      for (
        let columnIndex = selection.columnFrom;
        columnIndex <= selection.columnTo;
        columnIndex += 1
      ) {
        row[columnIndex] = '';
      }
    }
  });

  if (updated) clearSelectedCells(root);
  return updated;
};

const startEditingCell = (
  cell: HTMLElement,
  view: EditorView,
  table: ParsedTable,
  rowIndex: number,
  columnIndex: number,
): void => {
  if (cell.querySelector(`.${TABLE_INPUT_CLASS}`)) return;

  const originalValue = table.rows[rowIndex]?.[columnIndex] ?? '';
  const input = document.createElement('input');
  input.className = TABLE_INPUT_CLASS;
  input.value = originalValue;
  input.setAttribute(
    'aria-label',
    `Edit table cell ${String(rowIndex + 1)}, ${String(columnIndex + 1)}`,
  );

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    commitCell(view, table, rowIndex, columnIndex, input.value);
  };
  const cancel = () => {
    committed = true;
    renderCellText(cell, originalValue);
  };

  input.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  input.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  input.addEventListener('input', () => {
    resizeInputToContent(input);
  });
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (isSelectAllKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      input.select();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      view.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      view.focus();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      committed = true;
      const updated = moveToNextCell(
        view,
        table,
        rowIndex,
        columnIndex,
        input.value,
      );
      if (!updated) renderCellText(cell, input.value);
    }
  });

  cell.replaceChildren(input);
  resizeInputToContent(input);
  input.focus();
  input.select();
};

class MarkdownTableWidget extends WidgetType {
  constructor(private readonly table: ParsedTable) {
    super();
  }

  eq(other: MarkdownTableWidget): boolean {
    return this.table.source === other.table.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div');
    root.className = TABLE_WIDGET_CLASS;
    root.dataset['tableFrom'] = String(this.table.from);
    root.tabIndex = 0;

    let dragStart: CellCoordinate | null = null;
    let dragged = false;

    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!selectedCellSelection(root)) return;

      event.preventDefault();
      event.stopPropagation();
      deleteSelectedCells(view, root);
    });

    const tableElement = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    this.table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const section = rowIndex === 0 ? thead : tbody;

      row.forEach((value, columnIndex) => {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
        cell.className = TABLE_CELL_CLASS;
        cell.dataset['rowIndex'] = String(rowIndex);
        cell.dataset['columnIndex'] = String(columnIndex);
        cell.setAttribute('tabindex', '0');
        if (columnIndex === this.table.columns - 1) {
          cell.classList.add(TABLE_LAST_CELL_CLASS);
          const addButton = document.createElement('button');
          addButton.className = ADD_COLUMN_CLASS;
          addButton.type = 'button';
          addButton.title = 'Add column to the right';
          addButton.setAttribute('aria-label', 'Add column to the right');
          addButton.textContent = '+';
          addButton.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          addButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            addColumnToRight(view, this.table);
          });

          renderCellText(cell, value);
          cell.appendChild(addButton);
        } else {
          renderCellText(cell, value);
        }

        cell.addEventListener('mousedown', (event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest(`.${ADD_COLUMN_CLASS}`)) {
            return;
          }
          if ((event.target as HTMLElement).closest(`.${TABLE_INPUT_CLASS}`)) {
            return;
          }

          const coordinate = cellCoordinate(cell);
          if (!coordinate) return;

          event.preventDefault();
          event.stopPropagation();
          document.getSelection()?.removeAllRanges();

          dragStart = coordinate;
          dragged = false;
          root.dataset['suppressNextClick'] = '0';
          root.focus();
          selectCellRectangle(root, coordinate, coordinate);

          const onMouseUp = () => {
            document.removeEventListener('mouseup', onMouseUp);
            if (dragged) {
              root.dataset['suppressNextClick'] = '1';
              root.focus();
            }
            dragStart = null;
          };
          document.addEventListener('mouseup', onMouseUp);
        });
        cell.addEventListener('mouseenter', () => {
          if (!dragStart) return;

          const coordinate = cellCoordinate(cell);
          if (!coordinate) return;

          if (
            coordinate.rowIndex !== dragStart.rowIndex ||
            coordinate.columnIndex !== dragStart.columnIndex
          ) {
            dragged = true;
          }
          selectCellRectangle(root, dragStart, coordinate);
        });
        cell.addEventListener('click', (event) => {
          if ((event.target as HTMLElement).closest(`.${ADD_COLUMN_CLASS}`)) {
            return;
          }
          if (root.dataset['suppressNextClick'] === '1') {
            root.dataset['suppressNextClick'] = '0';
            return;
          }
          clearSelectedCells(root);
          startEditingCell(cell, view, this.table, rowIndex, columnIndex);
        });
        cell.addEventListener('keydown', (event) => {
          if (isSelectAllKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            startEditingCell(cell, view, this.table, rowIndex, columnIndex);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            startEditingCell(cell, view, this.table, rowIndex, columnIndex);
          } else if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            moveToNextCell(
              view,
              this.table,
              rowIndex,
              columnIndex,
              this.table.rows[rowIndex]?.[columnIndex] ?? '',
            );
          }
        });

        tr.appendChild(cell);
      });

      section.appendChild(tr);
    });

    tableElement.append(thead, tbody);
    root.appendChild(tableElement);
    return root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const buildTableDecorations = (state: EditorState): DecorationSet =>
  Decoration.set(
    findMarkdownTables(state).map((table) =>
      Decoration.replace({
        widget: new MarkdownTableWidget(table),
        block: true,
        inclusive: false,
      }).range(table.from, table.to),
    ),
    true,
  );

const tableDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state);
  },
  update(decorations, transaction) {
    if (transaction.docChanged) return buildTableDecorations(transaction.state);
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const eventPathHasClass = (event: Event, className: string): boolean =>
  event.composedPath().some((node) => {
    return node instanceof Element && node.classList.contains(className);
  });

const eventTableRoot = (event: Event): HTMLElement | null => {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;

    const root = node.closest<HTMLElement>(`.${TABLE_WIDGET_CLASS}`);
    if (root) return root;
  }

  return null;
};

const selectedTableRoots = (view: EditorView): HTMLElement[] => {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return [];
  }

  const roots = [
    ...view.dom.querySelectorAll<HTMLElement>(`.${TABLE_WIDGET_CLASS}`),
  ];
  return roots.filter((root) => {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      try {
        if (range.intersectsNode(root)) return true;
      } catch {
        continue;
      }
    }

    return false;
  });
};

const rootsWithSelectedCells = (view: EditorView): HTMLElement[] =>
  [...view.dom.querySelectorAll<HTMLElement>(`.${TABLE_WIDGET_CLASS}`)].filter(
    (root) => !!selectedCellSelection(root),
  );

const selectedCellsMarkdownForRoot = (
  state: EditorState,
  root: HTMLElement,
): string | null => {
  const table = currentTableForRoot(state, root);
  const selection = selectedCellSelection(root);
  if (!table || !selection) return null;

  const rows = table.rows
    .slice(selection.rowFrom, selection.rowTo + 1)
    .map((row) => row.slice(selection.columnFrom, selection.columnTo + 1));
  if (rows.length === 0) return null;

  const alignments = table.alignments.slice(
    selection.columnFrom,
    selection.columnTo + 1,
  );

  return [
    serializeRow(rows[0] ?? []),
    serializeDelimiterRow(alignments),
    ...rows.slice(1).map(serializeRow),
  ].join('\n');
};

const selectedCellsMarkdownForRoots = (
  state: EditorState,
  roots: readonly HTMLElement[],
): string => {
  const entries = roots
    .map((root) => {
      const table = currentTableForRoot(state, root);
      const markdown = selectedCellsMarkdownForRoot(state, root);
      return table && markdown ? { from: table.from, markdown } : null;
    })
    .filter((entry): entry is { from: number; markdown: string } => !!entry)
    .sort((a, b) => a.from - b.from)
    .map((entry) => entry.markdown);

  return [...new Set(entries)].join('\n\n');
};

const tableMarkdownForRoots = (
  state: EditorState,
  roots: readonly HTMLElement[],
): string => {
  const sourceByFrom = new Map(
    findMarkdownTables(state).map((table) => [
      String(table.from),
      table.source,
    ]),
  );

  const sources = roots
    .map((root) => {
      const from = root.dataset['tableFrom'];
      return from
        ? { from: Number(from), source: sourceByFrom.get(from) }
        : null;
    })
    .filter(
      (value): value is { from: number; source: string } =>
        !!value && Number.isFinite(value.from) && !!value.source,
    )
    .sort((a, b) => a.from - b.from)
    .map((value) => value.source);

  return [...new Set(sources)].join('\n\n');
};

const tableCopyExtension = EditorView.domEventHandlers({
  copy(event, view) {
    if (eventPathHasClass(event, TABLE_INPUT_CLASS)) return false;

    const selectedCellRoots = rootsWithSelectedCells(view);
    if (selectedCellRoots.length > 0) {
      const markdown = selectedCellsMarkdownForRoots(
        view.state,
        selectedCellRoots,
      );
      if (!markdown || !event.clipboardData) return false;

      event.clipboardData.setData('text/plain', markdown);
      event.preventDefault();
      return true;
    }

    const roots = selectedTableRoots(view);
    const eventRoot = eventTableRoot(event);
    if (roots.length === 0 && eventRoot) roots.push(eventRoot);
    if (roots.length === 0) return false;

    const markdown = tableMarkdownForRoots(view.state, roots);
    if (!markdown || !event.clipboardData) return false;

    event.clipboardData.setData('text/plain', markdown);
    event.preventDefault();
    return true;
  },
});

const tableTheme = EditorView.theme({
  [`.${TABLE_WIDGET_CLASS}`]: {
    display: 'flow-root',
    overflowX: 'auto',
    padding: '0.125rem 1.75rem 0.125rem 0',
    outline: '0',
  },
  [`.${TABLE_WIDGET_CLASS} table`]: {
    borderCollapse: 'collapse',
    width: 'max-content',
    color: 'inherit',
    font: 'inherit',
  },
  [`.${TABLE_WIDGET_CLASS} th, .${TABLE_WIDGET_CLASS} td`]: {
    position: 'relative',
    borderRight:
      '1px solid var(--pm-table-border-color, rgba(127, 127, 127, 0.24))',
    borderBottom:
      '1px solid var(--pm-table-border-color, rgba(127, 127, 127, 0.24))',
    padding: '0.25rem 0.625rem',
    textAlign: 'left',
    verticalAlign: 'top',
    whiteSpace: 'pre',
    cursor: 'text',
  },
  [`.${TABLE_WIDGET_CLASS} th`]: {
    fontWeight: '600',
  },
  [`.${TABLE_WIDGET_CLASS} th:last-child, .${TABLE_WIDGET_CLASS} td:last-child`]:
    {
      borderRight: '0',
    },
  [`.${TABLE_LAST_CELL_CLASS}`]: {
    overflow: 'visible',
  },
  [`.${TABLE_LAST_CELL_CLASS}::after`]: {
    content: '""',
    position: 'absolute',
    top: '0',
    right: '-1.35rem',
    bottom: '0',
    zIndex: '1',
    width: '1.35rem',
  },
  [`.${TABLE_WIDGET_CLASS} tr:last-child td`]: {
    borderBottom: '0',
  },
  [`.${TABLE_WIDGET_CLASS} th:focus, .${TABLE_WIDGET_CLASS} td:focus`]: {
    outline:
      '1px solid var(--pm-table-focus-color, var(--pm-link-color, #2684ff))',
    outlineOffset: '-1px',
  },
  [`.${TABLE_WIDGET_CLASS} .${TABLE_SELECTED_CELL_CLASS}`]: {
    background:
      'var(--pm-table-selected-cell-background, rgba(56, 139, 253, 0.28))',
  },
  [`.${TABLE_INPUT_CLASS}`]: {
    boxSizing: 'border-box',
    minWidth: '1ch',
    border: '0',
    padding: '0',
    margin: '0',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    outline: '0',
  },
  [`.${TABLE_INPUT_CLASS}-measure`]: {
    position: 'absolute',
    left: '-10000px',
    top: '-10000px',
    visibility: 'hidden',
    whiteSpace: 'pre',
    pointerEvents: 'none',
  },
  [`.${ADD_COLUMN_CLASS}`]: {
    position: 'absolute',
    top: '50%',
    right: '-1.25rem',
    transform: 'translateY(-50%)',
    zIndex: '2',
    width: '1.25rem',
    height: '1.25rem',
    border: '0',
    borderRadius: '0.1875rem',
    padding: '0',
    background: 'var(--pm-table-add-column-background, rgba(0, 0, 0, 0.85))',
    color: 'var(--pm-table-add-column-color, white)',
    font: 'inherit',
    lineHeight: '1.25rem',
    cursor: 'pointer',
    opacity: '0',
    pointerEvents: 'none',
  },
  [`.${TABLE_LAST_CELL_CLASS}:hover .${ADD_COLUMN_CLASS}, .${TABLE_LAST_CELL_CLASS}:focus-within .${ADD_COLUMN_CLASS}, .${ADD_COLUMN_CLASS}:hover, .${ADD_COLUMN_CLASS}:focus`]:
    {
      opacity: '1',
      pointerEvents: 'auto',
    },
});

/**
 * Replaces GitHub-flavored Markdown pipe tables with an editable table widget.
 *
 * Click a cell or press Enter while a cell is focused to edit it. Hover the last
 * cell in any row to reveal a button that inserts one column to the right.
 */
export const markdownTableExtension: Extension = [
  tableCompletionPlugin,
  tableDecorations,
  tableCopyExtension,
  tableTheme,
];

export { markdownTableExtension as tableExtension };
