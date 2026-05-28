/* global React, Tile */
// TaskList — bento grid + HTML5 drag-and-drop reorder.

function useDragReorder(items, setItems) {
  const [draggedId, setDraggedId] = React.useState(null);
  const [hoverInfo, setHoverInfo] = React.useState(null); // { id, hint:'above'|'below' }

  const onDragStart = (id) => (e) => {
    setDraggedId(id);
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch {}
  };
  const onDragOver = (id) => (e) => {
    e.preventDefault();
    if (id === draggedId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const isVerticalLayout = r.width > r.height * 1.6;
    let hint;
    if (isVerticalLayout) hint = (e.clientY - r.top) < r.height / 2 ? 'above' : 'below';
    else                  hint = (e.clientX - r.left) < r.width / 2  ? 'above' : 'below';
    setHoverInfo({ id, hint });
  };
  const onDragLeave = (id) => (e) => {
    if (hoverInfo && hoverInfo.id === id) setHoverInfo(null);
  };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (!draggedId || draggedId === id) return;
    const from = items.findIndex(t => t.id === draggedId);
    let to = items.findIndex(t => t.id === id);
    if (from < 0 || to < 0) return;
    const arr = items.slice();
    const [moved] = arr.splice(from, 1);
    if (hoverInfo && hoverInfo.hint === 'below') to = items.findIndex(t => t.id === id);
    if (from < to) to = Math.max(0, to - 1);
    if (hoverInfo && hoverInfo.hint === 'below') to += 1;
    arr.splice(to, 0, moved);
    setItems(arr);
  };
  const onDragEnd = () => { setDraggedId(null); setHoverInfo(null); };

  return { draggedId, hoverInfo, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd };
}

function TaskList({ tasks, setTasks, density = 'cozy', cols = 4, themeStyle = 'paper', onPick, onDelete, frozenDragId = null, frozenHover = null }) {
  const dnd = useDragReorder(tasks, setTasks);
  const draggedId = frozenDragId || dnd.draggedId;
  const hoverInfo = frozenHover || dnd.hoverInfo;

  // grid sizes per cols
  const rowHeight = cols >= 4 ? 132 : cols === 3 ? 124 : 116;
  const gap = cols >= 4 ? 16 : 14;

  return (
    <div className={`tile-grid cols-${cols}`} style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridAutoRows: `${rowHeight}px`,
      gridAutoFlow: 'dense',
      gap,
    }}>
      <style>{`
        .tile-grid .tile--s    { grid-column: span 1; grid-row: span 1; }
        .tile-grid .tile--m    { grid-column: span 2; grid-row: span 1; }
        .tile-grid .tile--wide { grid-column: span ${Math.min(3, cols)}; grid-row: span 1; }
        .tile-grid .tile--l    { grid-column: span 2; grid-row: span 2; }
        .tile-grid.cols-2 .tile--wide { grid-column: span 2; }
        .tile-grid.cols-2 .tile--m    { grid-column: span 2; }
        .tile-grid.cols-2 .tile--l    { grid-column: span 2; grid-row: span 2; }
      `}</style>

      {tasks.map(t => (
        <Tile
          key={t.id}
          task={t}
          density={density}
          themeStyle={themeStyle}
          onToggle={(id) => setTasks(tasks.map(x => x.id === id ? { ...x, done: !x.done } : x))}
          onPick={() => onPick && onPick(t)}
          onDelete={onDelete}
          isDragging={draggedId === t.id}
          dropHint={hoverInfo && hoverInfo.id === t.id ? hoverInfo.hint : null}
          onDragStart={dnd.onDragStart(t.id)}
          onDragOver={dnd.onDragOver(t.id)}
          onDragLeave={dnd.onDragLeave(t.id)}
          onDrop={dnd.onDrop(t.id)}
          onDragEnd={dnd.onDragEnd}
        />
      ))}
    </div>
  );
}

window.TaskList = TaskList;
