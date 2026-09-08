// Measure usable space; page through 200 stocks instead of shrinking text to fit.
export function fitBoard(width: number, height: number, graph: boolean, largeText: boolean, total = 200) {
  const tabletPortrait = width >= 700 && width <= 1100 && height > width;
  const columns = tabletPortrait ? 2 : graph ? (width >= 1360 ? 4 : width >= 1000 ? 3 : width >= 700 ? 2 : 1)
    : (width >= 1560 ? 4 : width >= 1000 ? 3 : width >= 740 ? 2 : 1);
  const minimumRow = graph ? (largeText ? 60 : 54) : largeText ? 30 : 27;
  const heading = graph ? 0 : 25;
  // Use the same 200-stock density even for a watchlist containing just 1–2 stocks.
  // Dividing the viewport by the actual watchlist length creates giant cells.
  const rows = Math.max(1, Math.min(graph ? Math.floor(80 / columns) : 200, Math.ceil(Math.max(total, 200) / columns), Math.floor((height - heading - 2) / minimumRow)));
  const rowHeight = Math.max(minimumRow, Math.floor((height - heading - 2) / rows));
  return { columns, rows, capacity: rows * columns, rowHeight: graph ? Math.min(70, rowHeight) : rowHeight };
}
