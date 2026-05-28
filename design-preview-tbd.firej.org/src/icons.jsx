/* global React */
// Hand-drawn-ish SVG icons. Stroke-based so they color with currentColor.

function Icon({ children, size = 18, stroke = 1.6, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={stroke}
         strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

const I = {
  Check:  (p) => <Icon {...p}><path d="M4 12.5l4.5 4.5L20 6" /></Icon>,
  Plus:   (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>,
  Drag:   (p) => <Icon {...p}><circle cx="9"  cy="6"  r="1.2"/><circle cx="9"  cy="12" r="1.2"/><circle cx="9"  cy="18" r="1.2"/><circle cx="15" cy="6"  r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></Icon>,
  Clock:  (p) => <Icon {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></Icon>,
  Search: (p) => <Icon {...p}><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></Icon>,
  Bell:   (p) => <Icon {...p}><path d="M6 16V11a6 6 0 1112 0v5l1.5 2H4.5L6 16zM10 20a2 2 0 004 0"/></Icon>,
  Filter: (p) => <Icon {...p}><path d="M4 5h16M7 12h10M10 19h4"/></Icon>,
  More:   (p) => <Icon {...p}><circle cx="5"  cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></Icon>,
  Eye:    (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Icon>,
  EyeOff: (p) => <Icon {...p}><path d="M3 3l18 18M10.6 6.2A10 10 0 0112 6c6.5 0 10 7 10 7a17 17 0 01-3 3.6M6.2 6.2A17 17 0 002 13s3.5 6 10 6c1.8 0 3.4-.5 4.8-1.2M9.5 9.5a3 3 0 004.2 4.2"/></Icon>,
  X:      (p) => <Icon {...p}><path d="M6 6l12 12M6 18L18 6"/></Icon>,
  Inbox:  (p) => <Icon {...p}><path d="M3 12l3-7h12l3 7v7H3v-7zM3 12h5l1.5 2.5h5L16 12h5"/></Icon>,
  Star:   (p) => <Icon {...p}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/></Icon>,
  Cal:    (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></Icon>,
  Today:  (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="2" fill="currentColor" stroke="none"/></Icon>,
  Folder: (p) => <Icon {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></Icon>,
  Lock:   (p) => <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></Icon>,
  Mail:   (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/></Icon>,
  Sun:    (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/></Icon>,
  Moon:   (p) => <Icon {...p}><path d="M20 14.5A8 8 0 119.5 4a7 7 0 0010.5 10.5z"/></Icon>,
  Sync:   (p) => <Icon {...p}><path d="M4 11a8 8 0 0114-5l2 2M20 13a8 8 0 01-14 5l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></Icon>,
  Cloud:  (p) => <Icon {...p}><path d="M7 18a4 4 0 010-8 6 6 0 0111.5 1.5A3.5 3.5 0 0118 18H7z"/></Icon>,
  CloudOff:(p)=> <Icon {...p}><path d="M3 3l18 18M7 18a4 4 0 01-1-7.8M9.5 6.5A6 6 0 0118.5 11.5 3.5 3.5 0 0119 17"/></Icon>,
  Warn:   (p) => <Icon {...p}><path d="M12 3l10 17H2L12 3z"/><path d="M12 10v5M12 18h.01"/></Icon>,
  Tag:    (p) => <Icon {...p}><path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="7.5" r="1.2"/></Icon>,
  Trash:  (p) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></Icon>,
  Edit:   (p) => <Icon {...p}><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 6l4 4"/></Icon>,
  Arrow:  (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>,
  Menu:   (p) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16"/></Icon>,
  Home:   (p) => <Icon {...p}><path d="M4 11l8-7 8 7v9H4v-9z"/><path d="M9 20v-6h6v6"/></Icon>,
};

window.I = I;
