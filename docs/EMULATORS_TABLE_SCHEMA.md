# Emulators Configuration Table Schema

## Overview
Table to store emulator configurations for each platform. This replaces localStorage persistence once the Tauri backend is set up.

## SQL Schema

```sql
CREATE TABLE IF NOT EXISTS emulator_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL UNIQUE,
  emulator_name TEXT NOT NULL,
  executable_path TEXT,
  launch_args TEXT,
  rom_folder TEXT,
  tracking_mode TEXT DEFAULT 'process',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

CREATE INDEX idx_emulator_configs_platform ON emulator_configs(platform_id);
```

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Primary key |
| `platform_id` | TEXT | Unique identifier for platform (e.g., 'ps1', 'gamecube') |
| `emulator_name` | TEXT | Selected emulator name (e.g., 'DuckStation', 'PCSX2') |
| `executable_path` | TEXT | Full path to emulator executable |
| `launch_args` | TEXT | Launch arguments with placeholders like {ROM} |
| `rom_folder` | TEXT | Path to folder containing ROMs |
| `tracking_mode` | TEXT | Process monitoring mode: 'process', 'directory', or 'name' |
| `created_at` | DATETIME | Record creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

## Platform IDs

**Nintendo:**
- `gamecube`
- `ds`
- `wii`
- `3ds`
- `wiiu`
- `switch`

**PlayStation:**
- `ps1`
- `ps2`
- `psp`
- `ps3`
- `psvita`
- `ps4`
- `ps5`

**Xbox:**
- `xbox`
- `xbox360`
- `xboxone`
- `xboxseriesx`

## Example Data

```sql
INSERT INTO emulator_configs (platform_id, emulator_name, executable_path, launch_args, rom_folder, tracking_mode)
VALUES (
  'ps1',
  'DuckStation',
  'C:\Emulators\DuckStation\duckstation.exe',
  '{ROM}',
  'C:\Games\PS1',
  'process'
);
```

## Backend Implementation

Create two Tauri commands:

### read_emulators_config
**Purpose:** Load all emulator configurations
**Returns:** `HashMap<String, EmulatorConfig>`

### write_emulators_config
**Purpose:** Save/update emulator configurations
**Input:** `HashMap<String, EmulatorConfig>`

## Current Storage
Currently stored in `localStorage['emulators_config']` as JSON until backend is implemented.
