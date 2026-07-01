# Metadea

Una aplicación de escritorio completa para gestionar y sincronizar tu biblioteca de medios (anime, manga, videojuegos, películas, series, libros, novelas visuales y novelas ligeras) con múltiples plataformas y servicios en línea.

## 🎯 Características principales

### Gestión de Medios
- **Sincronización multi-plataforma**: Conecta con AniList, IGDB, Steam, TMDB y otros servicios
- **Biblioteca local**: Gestiona tu colección de videojuegos, libros y otros medios locales
- **Seguimiento de progreso**: Monitorea tu progreso en anime, manga y otras series
- **Calificaciones personalizadas**: Sistema flexible de calificación (5 estrellas, 10 decimales, 3 emojis)
- **Listas personalizadas**: Crea y organiza tus propias listas de favoritos

### Características de Escritorio (Tauri)
- **Anime Local**: Detecta anime en tu carpeta local y sincroniza con AniList
  - Escanea carpetas para detectar episodios
  - Abre episodios en VLC o tu reproductor predeterminado
  - Sincroniza automáticamente el progreso con AniList
- **Búsqueda de Juegos**: Encuentra juegos en tu biblioteca de Steam, Epic Games, GOG, Xbox y EA
- **Gestión de Medios Locales**: Organiza archivos de tu colección local (libros, novelas visuales, etc.)
- **Autenticación con Servicios**: Integración nativa con GitHub, AniList y otros servicios

### Personalización
- **Temas**: Múltiples temas visuales con soporte para temas dinámicos
- **Idiomas**: Soporte multiidioma
- **Configuración avanzada**: Variables de entorno para IGDB, Steam API, TMDB y más
- **Avatar y Banner personalizados**: Personaliza tu perfil

## 🚀 Requisitos

- **Node.js**: >= 22.12.0
- **Rust**: Para compilar la aplicación Tauri
- **Git**: Para clonar el repositorio
- **Base de datos**: SQLite (local) y LibSQL (opcional para sincronización)

## 📦 Instalación

### Clonar el repositorio
```bash
git clone https://github.com/Shadorossa/Metadea.git
cd Metadea
```

### Instalar dependencias
```bash
# Frontend
cd frontend
npm install

# Backend (opcional, solo si quieres desplegar el backend)
cd ../backend
npm install
```

### Configuración de variables de entorno

Crea un archivo `.env.local` en la carpeta `frontend`:
```env
# Opcional: APIs externas
VITE_IGDB_CLIENT_ID=tu_cliente_id
STEAM_API_KEY=tu_api_key
TMDB_API_KEY=tu_api_key
ANILIST_CLIENT_ID=tu_cliente_id
```

## 🛠️ Desarrollo

### Ejecutar en modo desarrollo
```bash
cd frontend
npm run tauri:dev
```

### Construir aplicación de escritorio
```bash
cd frontend
npm run tauri:build
```

Después de compilar, el archivo `.msi` estará en:
```
frontend/src-tauri/target/release/bundle/msi/Metadea_*.msi
```

### Compilar frontend
```bash
cd frontend
npm run build
```

### Ejecutar backend (Cloudflare Workers)
```bash
cd backend
npm run dev
```

## 📱 Estructura del Proyecto

```
Metadea/
├── frontend/                    # Aplicación Astro + React + Tauri
│   ├── src/
│   │   ├── components/         # Componentes React
│   │   │   ├── local/         # Componentes de biblioteca local
│   │   │   ├── media/         # Componentes de gestión de medios
│   │   │   └── ...
│   │   ├── pages/             # Páginas Astro
│   │   ├── lib/               # Lógica compartida
│   │   │   ├── tauri.ts       # Bindings Tauri
│   │   │   ├── anilist/       # Integración AniList
│   │   │   └── settings/      # Configuración
│   │   ├── styles/            # Estilos Tailwind CSS
│   │   └── i18n/              # Internacionalización
│   ├── src-tauri/             # Backend Rust (Tauri)
│   │   └── src/
│   │       ├── folders.rs     # Comandos de carpetas y anime local
│   │       ├── db.rs          # Esquema de base de datos
│   │       ├── anilist.rs     # Integración AniList
│   │       └── ...
│   └── package.json
├── backend/                     # API Cloudflare Workers
│   ├── src/
│   │   └── index.ts           # Punto de entrada
│   ├── wrangler.jsonc         # Configuración Wrangler
│   └── package.json
└── docs/                        # Documentación
```

## 🔧 Configuración Avanzada

### Claves de Firma (Para distribución)

Para construir y distribuir la aplicación, necesitas generar claves de firma:

```bash
cd frontend
npx @tauri-apps/cli signer generate --write-keys ".tauri-keys" --password "" --ci
```

Luego, configura las variables de entorno:
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "ruta/a/.tauri-keys"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri:build
```

### Base de datos

La aplicación utiliza SQLite localmente con el siguiente esquema:

- `user_profile`: Información del perfil del usuario
- `user_library`: Biblioteca de medios del usuario
- `media_catalog`: Cache de información de medios
- `local_anime_folders`: Rutas a carpetas locales de anime
- `local_routes`: Rutas configuradas para diferentes categorías de medios
- `user_sessions`: Tokens de autenticación (AniList, GitHub, etc.)

## 🔌 Integraciones

### AniList
- Sincronización de lista de visualización
- Actualización automática de progreso
- Importación de datos

### IGDB (Internet Game Database)
- Búsqueda avanzada de juegos
- Metadata de juegos (portadas, banners, géneros)

### Steam
- Detección automática de juegos instalados
- Información de logros
- Tiempo de juego

### TMDB (The Movie Database)
- Información de películas y series
- Portadas y banners

### GitHub
- Autenticación OAuth
- Sincronización de datos

## 🎮 Uso

### Gestionar Anime Local

1. Ve a la sección **Local**
2. Selecciona la categoría **Anime**
3. Elige una carpeta con tus episodios de anime
4. La aplicación detectará automáticamente:
   - Tus animes en AniList (Watching y Plan to Watch)
   - Los archivos de episodios en la carpeta
5. Haz clic en un episodio para abrir en VLC
6. El progreso se sincroniza automáticamente con AniList

### Buscar y Gestionar Juegos

1. Ve a la sección **Local**
2. Selecciona **Videojuegos**
3. La aplicación escanea automáticamente:
   - Steam
   - Epic Games
   - GOG
   - Xbox
   - EA Play
4. Haz clic en un juego para abrir su panel de detalles
5. Haz clic en **Jugar** para lanzar el juego

### Sincronizar con AniList

1. Ve a **Configuración**
2. En la sección **Cuenta**, haz clic en **Conectar AniList**
3. Autoriza la aplicación
4. Tus datos se sincronizarán automáticamente

## 🐛 Troubleshooting

### La aplicación no arranca
```bash
# Limpiar caché de build
cd frontend
rm -rf .astro dist node_modules/.vite
npm install
npm run tauri:dev
```

### Error de base de datos
```bash
# La base de datos se crea automáticamente en:
# Windows: %APPDATA%/Metadea
# macOS: ~/Library/Application Support/Metadea
# Linux: ~/.config/Metadea
```

### Problemas con AniList
- Verifica que el token de AniList sea válido en Configuración
- Asegúrate de tener los permisos correctos configurados en AniList

### VLC no se abre
- Asegúrate de que VLC esté instalado en tu sistema
- Verifica que VLC está en la variable PATH del sistema

## 📝 Licencia

Este proyecto está bajo licencia [Especificar licencia - ej: MIT, GPL, etc.]

## 👤 Contribuir

Las contribuciones son bienvenidas. Para cambios importantes:

1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📞 Soporte

Para reportar bugs o solicitar features, abre un [Issue](https://github.com/Shadorossa/Metadea/issues) en el repositorio.

## 🙏 Agradecimientos

- [Astro](https://astro.build/) - Framework web
- [Tauri](https://tauri.app/) - Framework de aplicaciones de escritorio
- [React](https://react.dev/) - Biblioteca UI
- [Tailwind CSS](https://tailwindcss.com/) - Framework CSS
- [Cloudflare Workers](https://workers.cloudflare.com/) - Computación serverless
- [AniList](https://anilist.co/) - Base de datos de anime
- [IGDB](https://www.igdb.com/) - Base de datos de videojuegos

---

**Versión**: 0.3.1  
**Última actualización**: 2026-07-01
