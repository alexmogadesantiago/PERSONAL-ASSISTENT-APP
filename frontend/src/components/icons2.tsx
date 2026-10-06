/**
 * The v0.6 icon set (stroke 1.75, 24 grid) and the integration marks.
 * Kept apart from `icons.tsx` so existing imports stay untouched.
 */
import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function make(children: ReactNode) {
  return function Icon(props: P) {
    return (
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };
}

export const IHome = make(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>);
export const IBolt = make(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
export const IPlug = make(<><path d="M9 2v6M15 2v6" /><path d="M6 8h12v4a6 6 0 0 1-12 0V8Z" /><path d="M12 18v4" /></>);
export const IActivity = make(<path d="M3 12h4l3 8 4-16 3 8h4" />);
export const IAlert = make(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>);
export const ISparkles = make(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>);
export const ISettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>);
export const IUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>);
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IBell = make(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>);
export const IPlus = make(<path d="M12 5v14M5 12h14" />);
export const ICheck = make(<path d="M20 6 9 17l-5-5" />);
export const IX = make(<path d="M18 6 6 18M6 6l12 12" />);
export const IChevronRight = make(<path d="m9 18 6-6-6-6" />);
export const IChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IArrowLeft = make(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const IArrowRight = make(<path d="M5 12h14M12 5l7 7-7 7" />);
export const IArrowDown = make(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const IExternal = make(<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>);
export const IBrain = make(<><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V6a2 2 0 0 0-3-2Z" /><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0" /></>);
export const IPlay = make(<path d="M6 4l14 8-14 8V4Z" />);
export const IPause = make(<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>);
export const ICopy = make(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const ITrash = make(<><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>);
export const IEdit = make(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>);
export const IMore = make(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const IRefresh = make(<><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>);
export const IShield = make(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />);
export const IShieldCheck = make(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>);
export const ILock = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const IKey = make(<><circle cx="8" cy="15" r="5" /><path d="M12 12l8-8m-3 0h3v3" /></>);
export const IMail = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>);
export const ICalendar = make(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>);
export const IDrive = make(<><path d="M8 3h8l6 10-4 7H6l-4-7 6-10Z" /><path d="M2 13h20" /></>);
export const ITable = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>);
export const IDoc = make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>);
export const ISend = make(<><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>);
export const IClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IFilter = make(<path d="M3 4h18l-7 9v6l-4 2v-8L3 4Z" />);
export const ILayers = make(<><path d="m12 2 10 5-10 5L2 7l10-5Z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>);
export const IChat = make(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />);
export const IGitHub = make(<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />);
export const ICommand = make(<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6Z" />);
export const IMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const ISun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);
export const ILogout = make(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>);
export const IInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
export const IWand = make(<><path d="m15 4 5 5L9 20l-5-5L15 4Z" /><path d="M12 7l5 5M5 3v4M3 5h4M19 15v4M17 17h4" /></>);
export const IGrid = make(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const IServer = make(<><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01" /></>);
export const IEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const IPalette = make(<><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6C22 6 17.5 2 12 2Z" /></>);
export const IHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>);

const BLOCK_ICONS: Record<string, (p: P) => JSX.Element> = {
  clock: IClock,
  play: IPlay,
  mail: IMail,
  github: IGitHub,
  filter: IFilter,
  sparkles: ISparkles,
  layers: ILayers,
  send: ISend,
  calendar: ICalendar,
  drive: IDrive,
  table: ITable,
  doc: IDoc,
  chat: IChat,
};

export function BlockIcon({ name, ...p }: { name: string } & P) {
  const C = BLOCK_ICONS[name] ?? IBolt;
  return <C {...p} />;
}

/* ------------------------------------------------------- brand marks ---- */

export function ProviderMark({ provider, size = 20 }: { provider: string; size?: number }) {
  const s = { width: size, height: size, "aria-hidden": true as const };
  switch (provider) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" {...s}>
          <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-8Z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8Z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
        </svg>
      );
    case "telegram":
      return (
        <svg viewBox="0 0 24 24" {...s}>
          <circle cx="12" cy="12" r="11" fill="#2AABEE" />
          <path fill="#fff" d="M5.4 11.7 16.8 7.3c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.8Z" />
        </svg>
      );
    case "microsoft":
      return (
        <svg viewBox="0 0 24 24" {...s}>
          <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
          <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
          <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
          <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" {...s}>
          <path
            fill="currentColor"
            d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.3-3.5-1.3-.5-1.2-1.2-1.5-1.2-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 1.9v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z"
          />
        </svg>
      );
    case "ai":
      return <ISparkles width={size} height={size} />;
    default:
      return <IPlug width={size} height={size} />;
  }
}
