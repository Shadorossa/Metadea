export interface EmulatorPlatform {
  id: string;
  name: string;
  logo: string;
}

export interface EmulatorCompany {
  id: string;
  name: string;
  logo: string;
  color: string;
  platforms: EmulatorPlatform[];
}

export interface EmulatorDefinition {
  name: string;
  extensions: string[];
  // Has its own RetroAchievements client: unlocks reach RA while playing.
  retroAchievements?: boolean;
}

// Platforms with RetroAchievements sets (src-tauri/src/retro_achievements/consoles.rs).
const RETRO_ACHIEVEMENTS_PLATFORMS = new Set(['gamecube', 'ds', 'wii', 'ps1', 'ps2', 'psp']);

/** True when `emulatorName` runs a platform RA covers but never reports unlocks to RA. */
export function emulatorLacksRetroAchievements(platformId: string, emulatorName: string): boolean {
  if (!emulatorName || !RETRO_ACHIEVEMENTS_PLATFORMS.has(platformId)) return false;
  const emulator = EMULATORS_DB[platformId]?.find(em => em.name === emulatorName);
  return !!emulator && !emulator.retroAchievements;
}

export const COMPANIES: EmulatorCompany[] = [
  {
    id: 'nintendo',
    name: 'Nintendo',
    logo: '/platforms/nintendo_logo.png',
    color: '#e60012',
    platforms: [
      { id: 'gamecube', name: 'GameCube', logo: '/platforms/Emu/Gamecube_logo.png' },
      { id: 'ds', name: 'Nintendo DS', logo: '/platforms/Emu/NintendoDS_logo.png' },
      { id: 'wii', name: 'Nintendo Wii', logo: '/platforms/Emu/Wii_logo.png' },
      { id: '3ds', name: 'Nintendo 3DS', logo: '/platforms/Emu/3ds_logo.png' },
      { id: 'wiiu', name: 'Wii U', logo: '/platforms/Emu/Wii_U_logo.png' },
      { id: 'switch', name: 'Nintendo Switch', logo: '/platforms/Emu/NSwitch_logo.png' },
    ],
  },
  {
    id: 'playstation',
    name: 'PlayStation',
    logo: '/platforms/playstation_logo.png',
    color: '#003087',
    platforms: [
      { id: 'ps1', name: 'PlayStation 1', logo: '/platforms/Emu/PS1_logo.png' },
      { id: 'ps2', name: 'PlayStation 2', logo: '/platforms/Emu/PS2_logo.png' },
      { id: 'psp', name: 'PlayStation Portable', logo: '/platforms/Emu/Psp_logo.png' },
      { id: 'ps3', name: 'PlayStation 3', logo: '/platforms/Emu/PS3_logo.png' },
      { id: 'psvita', name: 'PlayStation Vita', logo: '/platforms/Emu/PSVita_logo.png' },
      { id: 'ps4', name: 'PlayStation 4', logo: '/platforms/Emu/PS4_logo.png' },
      { id: 'ps5', name: 'PlayStation 5', logo: '/platforms/Emu/PS5_logo.png' },
    ],
  },
  {
    id: 'xbox',
    name: 'Xbox',
    logo: '/platforms/xbox_logo.png',
    color: '#107c10',
    platforms: [
      { id: 'xbox', name: 'Xbox', logo: '/platforms/Emu/Xbox_logo.png' },
      { id: 'xbox360', name: 'Xbox 360', logo: '/platforms/Emu/Xbox360_logo.png' },
      { id: 'xboxone', name: 'Xbox One', logo: '/platforms/Emu/XboxOne_logo.png' },
      { id: 'xboxseriesx', name: 'Xbox Series X/S', logo: '/platforms/Emu/XboxSeriesXS_logo.png' },
    ],
  },
];

export const EMULATORS_DB: Record<string, EmulatorDefinition[]> = {
  gamecube: [
    { name: 'Dolphin', extensions: ['.elf', '.dol', '.gcm', '.tgc', '.ciso', '.gcz', '.iso', '.wad', '.dff', '.rvz', '.m3u'], retroAchievements: true },
  ],
  ds: [
    { name: 'melonDS', extensions: ['.nds', '.zip'] },
    { name: 'DeSmuME', extensions: ['.nds', '.zip', '.7z', '.rar', '.gz'] },
    { name: 'RetroArch', extensions: ['.nds', '.zip'], retroAchievements: true },
  ],
  wii: [
    { name: 'Dolphin', extensions: ['.elf', '.dol', '.gcm', '.tgc', '.ciso', '.gcz', '.iso', '.wad', '.dff', '.rvz', '.m3u'], retroAchievements: true },
  ],
  '3ds': [
    { name: 'Citra', extensions: ['.3ds', '.3dsx', '.cci', '.zcci', '.cxi', '.elf', '.cia'] },
    { name: 'Lime3DS', extensions: ['.3ds', '.3dsx', '.cci', '.cxi', '.elf', '.cia'] },
  ],
  wiiu: [
    { name: 'Cemu', extensions: ['.wud', '.wux', '.rpx', '.wua'] },
  ],
  switch: [
    { name: 'Ryujinx', extensions: ['.nsp', '.xci'] },
    { name: 'Yuzu', extensions: ['.nso', '.nro', '.nca', '.xci', '.nsp'] },
    { name: 'Suyu', extensions: ['.nso', '.nro', '.nca', '.xci', '.nsp'] },
  ],
  ps1: [
    { name: 'DuckStation', extensions: ['.bin', '.img', '.exe', '.chd', '.psexe', '.m3u', '.cue', '.pbp', '.iso'], retroAchievements: true },
    { name: 'ePSXe', extensions: ['.bin', '.iso', '.img', '.pbp', '.zip', '.cue'] },
    { name: 'PCSXR-PGXP', extensions: ['.bin', '.cue', '.img', '.iso'] },
  ],
  ps2: [
    { name: 'PCSX2', extensions: ['.bin', '.chd', '.cso', '.gz', '.img', '.iso', '.m3u', '.mdf', '.nrg'], retroAchievements: true },
  ],
  psp: [
    { name: 'PPSSPP', extensions: ['.chd', '.cso', '.iso', '.pbp'], retroAchievements: true },
  ],
  ps3: [
    { name: 'RPCS3', extensions: ['.bin', '.iso'] },
  ],
  psvita: [
    { name: 'Vita3K', extensions: ['.vpk'] },
  ],
  ps4: [
    { name: 'shadPS4', extensions: ['.bin', '.iso'] },
  ],
  ps5: [
    { name: 'shadPS4', extensions: ['.bin', '.iso'] },
  ],
  xbox: [
    { name: 'Xemu', extensions: ['.iso', '.xiso'] },
  ],
  xbox360: [
    { name: 'Xenia', extensions: ['.iso', '.xex', '.cci', '.cxi', '.elf', '.zar'] },
  ],
  xboxone: [
    { name: 'Xenia Edge', extensions: ['.iso', '.xex'] },
  ],
  xboxseriesx: [
    { name: 'Xenia Edge', extensions: ['.iso', '.xex'] },
  ],
};

export const ALL_PLATFORMS = COMPANIES.flatMap(company =>
  company.platforms.map(platform => ({ ...platform, company: company.id, color: company.color })),
);
