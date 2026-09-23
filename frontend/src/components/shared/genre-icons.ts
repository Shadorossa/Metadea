// One lucide icon per unified genre (lib/media/genre-unifier.ts's
// UNIFIED_GENRE_NAMES), for anywhere a genre is shown as a chip — first
// used by the taste comparison's "Genres you both love". Lives in
// components/ (not lib/) because the values are React components.
// Unknown or unmapped genres fall back to a plain tag; adult tags get the
// same neutral tag on purpose.
import {
  Axe, Baby, Biohazard, Blocks, BookOpen, BookText, Bot, Brain, Briefcase, Building, Car, Castle, Cat,
  CircleQuestionMark, Clapperboard, Coffee, Cog, Compass, Cpu, Crosshair, Crown, Dices, DoorOpen, Drama,
  Droplet, EyeOff, Eye, FaceSlightlySmiling, Feather, Film, FingerprintPattern, Footprints, Gauge, Gem,
  Ghost, Glasses, Globe, GraduationCap, Handshake, Headphones, Heart, Hourglass, HouseHeart, Joystick,
  Landmark, Map as MapIcon, Medal, Mic, Moon, Mountain, MousePointerClick, Music, Newspaper, Orbit, Palette, Popcorn,
  Puzzle, Radiation, Rainbow, Rocket, School, Scroll, Search, Shapes, Shield, Skull, Sparkles, Sprout,
  Star, Sun, Sword, Swords, Tag, Target, Tent, Theater, TreePine, Trophy, TvMinimal, Umbrella, Users,
  VenetianMask, Wand, WandSparkles, Zap, type LucideIcon,
} from 'lucide-react';

export const GENRE_ICONS: Readonly<Record<string, LucideIcon>> = {
  // Action / combat
  'Action': Zap,
  'Fighting': Swords,
  'Hack and Slash': Sword,
  'Shooter': Crosshair,
  // Adventure
  'Adventure': Compass,
  'Point-and-click': MousePointerClick,
  // Strategy
  'Strategy': Crown,
  'Real-Time Strategy (RTS)': Castle,
  'Turn-Based Strategy (TBS)': Hourglass,
  'Tactical': Target,
  '4X': Globe,
  // RPG
  'Role-playing (RPG)': Shield,
  'RPG': Shield,
  // Platformer / puzzle / arcade
  'Platformer': Footprints,
  'Puzzle': Puzzle,
  'Arcade': Joystick,
  // Simulation / sports
  'Simulation': Gauge,
  'Sports': Trophy,
  'Racing': Car,
  // Multiplayer / social
  'MOBA': Users,
  'Party': Popcorn,
  // Narrative / visual
  'Visual Novel': BookOpen,
  'Card & Board Game': Dices,
  'Music': Music,
  'Quiz/Trivia': CircleQuestionMark,
  // Open world / survival
  'Sandbox': Blocks,
  'Open world': MapIcon,
  'Survival': Tent,
  'Stealth': EyeOff,
  // Cross-media genres
  'Fantasy': WandSparkles,
  'Sci-Fi': Rocket,
  'Horror': Ghost,
  'Thriller': Eye,
  'Mystery': Search,
  'Romance': Heart,
  'Comedy': FaceSlightlySmiling,
  'Drama': Drama,
  'History': Landmark,
  'War': Axe,
  'Western': Sun,
  'Crime': FingerprintPattern,
  'Animation': Palette,
  'Documentary': Film,
  'Family': HouseHeart,
  'TV Movie': TvMinimal,
  'News': Newspaper,
  'Reality': Clapperboard,
  'Soap Opera': Theater,
  'Talk Show': Mic,
  // Aesthetic subgenres
  'Cyberpunk': Cpu,
  'Steampunk': Cog,
  // Anime-specific
  'Slice of Life': Coffee,
  'Supernatural': Moon,
  'Psychological': Brain,
  'Mecha': Bot,
  'Mahou Shoujo': Star,
  'Ecchi': Tag,
  'Harem': Users,
  'Isekai': DoorOpen,
  'Hentai': Tag,
  // Book subjects
  'Juvenile Fiction': Baby,
  'Teen Fiction': Headphones,
  'School': School,
  'Magic': Wand,
  'Witches': Cat,
  'Wizards': Scroll,
  'Vampires': Droplet,
  'Ghosts': Ghost,
  'Monsters': Skull,
  'Friendship': Handshake,
  'Coming of Age': Sprout,
  'Adventure & Adventurers': Mountain,
  'Overcoming Adversity': Medal,
  // Misc tags
  'Indie': Gem,
  'Educational': GraduationCap,
  'Kids': Shapes,
  'Business': Briefcase,
  'Non-fiction': BookText,
  'Erotic': Tag,
  'Space Opera': Orbit,
  'Literary Fiction': Feather,
  'Magical Realism': Sparkles,
  'Young Adult': Headphones,
  'Urban': Building,
  'Paranormal': Ghost,
  'LGBTQ+': Rainbow,
  'Noir': Umbrella,
  'Dystopian': Radiation,
  'Post-Apocalyptic': Biohazard,
  'Heist': VenetianMask,
  'Spy Thriller': Glasses,
  'Mythology': Landmark,
  'Folk Tale': TreePine,
};

const BY_LOWER_CASE: ReadonlyMap<string, LucideIcon> = new Map(
  Object.entries(GENRE_ICONS).map(([name, icon]) => [name.toLowerCase(), icon]),
);

/** The genre's icon, matched case-insensitively; a plain tag otherwise. */
export function genreIcon(genre: string): LucideIcon {
  return GENRE_ICONS[genre] ?? BY_LOWER_CASE.get(genre.trim().toLowerCase()) ?? Tag;
}
