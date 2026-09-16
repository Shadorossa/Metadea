import {
  Monitor, Folder, File as FileIcon, RefreshCw, Download, Plus, X, SquarePen, Eye, ExternalLink, Trash2,
  LayoutGrid, BookOpen, Bookmark, Gamepad2, MessageSquare, Film, MonitorPlay, Book, BookImage, User, IdCard,
  CirclePlay, CircleCheckBig, CirclePause, CircleX, Check, CircleAlert, Layers, Heart, Award, Hourglass, Play, Pause,
} from 'lucide-react';

// Every icon below used to be its own hand-drawn <svg> (duplicated, in several
// cases identically, across other components too — see DeleteContextMenu.tsx,
// LocalMediaDetailPanel.tsx, MediaEditorModal.tsx, ActivitySection.tsx,
// TierIndex.tsx for the same trash glyph alone). Routing them all through
// lucide-react here means every one of those call sites gets a consistent
// stroke width/size/library instead of a hand-copied path, without any of
// them needing to change — this file's exported names and prop shapes are
// unchanged. IconGithub and IconAnime stay hand-drawn: lucide dropped brand
// logos (no github/youtube icons), and there's no stock icon for a kanji
// glyph.

// ── Generic UI ────────────────────────────────────────────────────────────────

export function IconMonitor() {
  return <Monitor size={48} strokeWidth={1.5} />;
}

export function IconFolder({ size = 40, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number } = {}) {
  return <Folder size={size} strokeWidth={strokeWidth} />;
}

export function IconFile() {
  return <FileIcon size={32} strokeWidth={1.5} />;
}

export function IconRefresh() {
  return <RefreshCw size={16} strokeWidth={2} />;
}

export function IconDownload() {
  return <Download size={16} strokeWidth={2} />;
}

export function IconPlus({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return <Plus size={size} strokeWidth={strokeWidth} />;
}

export function IconX({ size = 12, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number } = {}) {
  return <X size={size} strokeWidth={strokeWidth} />;
}

export function IconPencil({ size = 14, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return <SquarePen size={size} strokeWidth={strokeWidth} />;
}

export function IconEye({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return <Eye size={size} strokeWidth={strokeWidth} />;
}

export function IconExternalLink({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return <ExternalLink size={size} strokeWidth={strokeWidth} />;
}

// Brand logo — lucide-react removed all brand/wordmark icons (trademark
// reasons), so this one stays hand-drawn; there's no library equivalent to
// standardize onto.
export function IconGithub({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>
    </svg>
  );
}

export function IconTrash({ size = 14, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}) {
  return <Trash2 size={size} strokeWidth={strokeWidth} />;
}

// ── Media type icons (search tabs, etc.) ──────────────────────────────────────

interface SvgProps { size?: number; strokeWidth?: number; }

export function IconAll(p: SvgProps) {
  return <LayoutGrid {...p} />;
}

// A kanji glyph, not a pictogram — no stock icon (lucide or otherwise) stands
// in for "anime" the way BookOpen can stand in for "manga", so this one stays
// hand-drawn text.
export function IconAnime(p: SvgProps) {
  const size = p.size ?? 20;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <text x="50%" y="78%" textAnchor="middle" fontSize="21" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" stroke="none">画</text>
    </svg>
  );
}

export function IconManga(p: SvgProps) {
  return <BookOpen {...p} />;
}

export function IconNovel(p: SvgProps) {
  return <Bookmark {...p} />;
}

export function IconGame(p: SvgProps) {
  return <Gamepad2 {...p} />;
}

export function IconVNovel(p: SvgProps) {
  return <MessageSquare {...p} />;
}

export function IconMovie(p: SvgProps) {
  return <Film {...p} />;
}

export function IconSeries(p: SvgProps) {
  return <MonitorPlay {...p} />;
}

export function IconBook(p: SvgProps) {
  return <Book {...p} />;
}

export function IconComic(p: SvgProps) {
  return <BookImage {...p} />;
}

export function IconCharacter(p: SvgProps) {
  return <User {...p} />;
}

// A crew ID badge — distinct from IconCharacter's plain person silhouette,
// since this represents the people who made a work (director/writer/...)
// rather than a character within it.
export function IconStaff(p: SvgProps) {
  return <IdCard {...p} />;
}

// ── Status icons (editor modal, profile render) ───────────────────────────────

export function IconStatusPlanning(p: SvgProps) {
  return <Bookmark {...p} />;
}

export function IconStatusInProgress(p: SvgProps) {
  return <CirclePlay {...p} />;
}

export function IconStatusCompleted(p: SvgProps) {
  return <CircleCheckBig {...p} />;
}

export function IconStatusPaused(p: SvgProps) {
  return <CirclePause {...p} />;
}

export function IconStatusDropped(p: SvgProps) {
  return <CircleX {...p} />;
}

// ── Utility icons ─────────────────────────────────────────────────────────────

export function IconCheck(p: SvgProps) {
  return <Check {...p} />;
}

export function IconAlertCircle(p: SvgProps) {
  return <CircleAlert {...p} />;
}

export function IconLayers(p: SvgProps) {
  return <Layers {...p} />;
}

export function IconHeart({ filled = false, size = 20, strokeWidth = 1.8 }: SvgProps & { filled?: boolean }) {
  return <Heart size={size} strokeWidth={strokeWidth} fill={filled ? 'currentColor' : 'none'} />;
}

export function IconPlatinum({ filled = false, size = 20, strokeWidth = 1.8 }: SvgProps & { filled?: boolean }) {
  return <Award size={size} strokeWidth={strokeWidth} fill={filled ? 'currentColor' : 'none'} />;
}

// ── Tray status icon (MediaPage — different designs from editor status icons) ──

export function IconTrayStatus({ status, size = 20 }: { status: string; size?: number }) {
  const props = { size, strokeWidth: 2.5 };
  switch (status) {
    case 'planning':
      return <Hourglass {...props} />;
    case 'watching':
    case 'reading':
      return <Play {...props} />;
    case 'playing':
      return <Gamepad2 {...props} />;
    case 'completed':
      return <Check {...props} />;
    case 'paused':
      return <Pause {...props} />;
    case 'dropped':
      return <X {...props} />;
    default:
      return <Plus {...props} />;
  }
}
