// Ported from ui/src/components/main/Catalogue.jsx's stringToColor/stringAvatar - deterministic
// per-author color so the same author gets a visually consistent avatar across renders/devices,
// without needing a color assigned/stored anywhere.
export const stringToColor = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';
  for (let i = 0; i < 3; i += 1) {
    const part = (hash >> (i * 8)) & 0xff;
    color += `00${part.toString(16)}`.slice(-2);
  }
  return color;
};

export const initialFor = (name: string): string => (name.split(' ')[0]?.[0] ?? '?').toUpperCase();
