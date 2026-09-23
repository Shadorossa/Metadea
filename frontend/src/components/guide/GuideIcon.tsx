// Icon for a guide section (lib/welcome/guide-content.ts names them by role).
import {
  Award, Bell, BookOpen, BookText, Camera, ChartColumn, Compass, Database, Download, Film, Folder,
  Gamepad2, GitPullRequest, Globe, Heart, House, Keyboard, KeyRound, Layers, Link, List, Map,
  MessageSquare, Monitor, Music, Paintbrush, Palette, Pencil, Play, RefreshCw, Repeat, Rocket, Search,
  Shield, SkipForward, Sparkles, Star, Trophy, User, Users,
  type LucideIcon,
} from 'lucide-react';
import type { GuideIcon as GuideIconName } from '../../lib/welcome/guide-content';

const ICONS: Record<GuideIconName, LucideIcon> = {
  compass: Compass,
  map: Map,
  user: User,
  house: House,
  search: Search,
  film: Film,
  pencil: Pencil,
  repeat: Repeat,
  layers: Layers,
  users: Users,
  git: GitPullRequest,
  list: List,
  star: Star,
  heart: Heart,
  trophy: Trophy,
  chart: ChartColumn,
  bell: Bell,
  folder: Folder,
  monitor: Monitor,
  gamepad: Gamepad2,
  download: Download,
  award: Award,
  camera: Camera,
  rocket: Rocket,
  play: Play,
  keyboard: Keyboard,
  skip: SkipForward,
  book: BookOpen,
  'book-text': BookText,
  music: Music,
  key: KeyRound,
  refresh: RefreshCw,
  link: Link,
  message: MessageSquare,
  palette: Palette,
  paintbrush: Paintbrush,
  globe: Globe,
  shield: Shield,
  database: Database,
  sparkles: Sparkles,
};

export function GuideIcon({ name, size = 18 }: { name: GuideIconName; size?: number }) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
