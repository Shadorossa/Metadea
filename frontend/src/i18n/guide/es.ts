import type { Translations } from '../types';

// Guía de uso (/guide). Misma forma que guide/en.ts, la locale de referencia.
export const guideEs: Translations['guide'] = {
  page_title: "Guía de uso",
  page_subtitle: "Cómo funciona cada parte de Metadea, desde tu primera búsqueda hasta jugar, ver, leer y hacer copias de seguridad. Busca un tema o elige uno en el índice.",
  search_label: "Buscar en la guía",
  search_placeholder: "Busca: reproductor, ROMs, AniList…",
  search_clear: "Borrar la búsqueda",
  results_count: "{count} de {total} secciones",
  no_results_title: "No hay resultados",
  no_results_body: "Ninguna sección menciona «{query}». Prueba con una palabra más corta o distinta.",
  toc_title: "Índice",
  steps_title: "Cómo se usa",
  tips_title: "Consejos",
  shortcuts_title: "Atajos",
  open_settings: "Ir a Ajustes › {tab}",
  open_settings_service: "Ir a Ajustes › {tab} › {service}",
  open_page: "Abrir {page}",
  back_to_top: "Volver arriba",
  nav_link: "Guía de uso",
  sheet_link: "Abrir la guía de uso",
  groups: {
    start: "Primeros pasos",
    discover: "Descubrir",
    library: "Tu biblioteca",
    play: "Play",
    watch: "Ver, leer y escuchar",
    integrations: "Integraciones",
    customize: "Personalización",
    data: "Datos y privacidad",
  },
  keys: {
    next_page: "Página siguiente",
    prev_page: "Página anterior",
    next_chapter: "Capítulo siguiente",
    prev_chapter: "Capítulo anterior",
    font_size: "Texto más grande / más pequeño",
    toc: "Índice del libro",
    fullscreen: "Pantalla completa",
    close_reader: "Cerrar el lector",
  },
  sections: {
    overview: {
      title: "Qué es Metadea",
      intro: "Metadea es una biblioteca personal para todo lo que juegas, ves y lees: videojuegos, anime, manga, novelas ligeras, novelas visuales, series, películas, libros y cómics. Vive en tu ordenador y funciona sin conexión; internet solo se usa para buscar información y para sincronizar cuando tú lo pides.",
      steps: {
        s1: "Busca una obra con el buscador (Ctrl+K) y abre su ficha.",
        s2: "Haz clic en la portada para añadirla a tu biblioteca y apuntar su estado, progreso, fechas y nota.",
        s3: "Indica a Play tus carpetas, lanzadores y emuladores para abrir desde Metadea tus juegos, vídeos y libros.",
        s4: "Sigue tu progreso en Inicio y en tu perfil: estadísticas, favoritos, listas e historial.",
      },
      tips: {
        t1: "Tu biblioteca es una base de datos en este ordenador. Nadie más tiene una copia, así que haz una copia de seguridad de vez en cuando (Ajustes › Copia de seguridad).",
        t2: "Todo lo que configuras en la guía de bienvenida se puede cambiar después en Ajustes.",
      },
    },
    navigation: {
      title: "Moverte por la aplicación",
      intro: "La barra superior está siempre visible. Las flechas van atrás y adelante; los iconos de la izquierda abren Inicio, Play y Explorar; los nombres del centro abren tu biblioteca filtrada por tipo, y el grupo de la derecha reúne la búsqueda, las notificaciones, tu perfil y los Ajustes.",
      steps: {
        s1: "Usa las flechas ← y → del extremo izquierdo, o Alt+← / Alt+→, para moverte por el historial.",
        s2: "Haz clic en un tipo del centro de la barra (Anime, Manga, Videojuegos…) para saltar a esa parte de tu biblioteca.",
        s3: "Pulsa de Ctrl+1 a Ctrl+6 para ir directamente a Inicio, Play, Perfil, Explorar, Notificaciones o Ajustes.",
        s4: "Pulsa ? en cualquier pantalla para ver los atajos que funcionan en ella.",
      },
      tips: {
        t1: "En Explorar y en Play, el centro de la barra se convierte en las pestañas de esa página.",
        t2: "En Mac, el Ctrl de estos atajos es ⌘.",
      },
    },
    account: {
      title: "Tu cuenta",
      intro: "La primera vez que abres Metadea solo eliges un nombre de usuario: la sesión es local y no se sube nada. Más adelante puedes vincularla con Google para tener un perfil público y ver la actividad de tus amigos.",
      steps: {
        s1: "Para vincular una sesión local, usa «Vincular con Google» en Inicio.",
        s2: "Con una cuenta vinculada, Inicio te pregunta una vez al día si quieres sincronizar tu perfil; solo se sube cuando pulsas «Sincronizar».",
        s3: "«Cerrar sesión» está al final de Ajustes › Apariencia.",
      },
      tips: {
        t1: "Cerrar sesión solo olvida la sesión: tu biblioteca se queda en este ordenador.",
        t2: "«Ahora no» oculta el aviso de sincronización hasta la próxima vez que vuelvas a Inicio.",
      },
    },
    home: {
      title: "Inicio",
      intro: "Inicio es tu resumen del día: lo que tienes a medias, lo que se estrena este mes y lo que hacen tus amigos.",
      steps: {
        s1: "El primer bloque muestra lo que estás viendo, leyendo o jugando, agrupado por tipo. Usa + y − sobre una portada para sumar o restar un episodio o capítulo sin abrir la obra.",
        s2: "El calendario muestra los estrenos del mes. «Para ti» incluye solo obras de tu biblioteca; «General», todas. Filtra por tipo y cambia de mes con las flechas.",
        s3: "La columna derecha empieza con «Un día como hoy»: obras que terminaste en esta misma fecha en años anteriores.",
        s4: "Debajo, el feed de actividad alterna entre «Amigos» y «General».",
        s5: "La franja del extremo derecho muestra «Hoy se emite» (episodios de tu biblioteca que salen hoy) y «Seguir donde lo dejaste»: lo último que reprodujiste en Play, con el tiempo que te queda. Haz clic para continuar justo donde paraste.",
      },
      tips: {
        t1: "Los bloques sin nada que mostrar se ocultan, así que una biblioteca nueva empieza casi vacía.",
        t2: "Unos segundos después de abrir Metadea se descargan los últimos datos de la comunidad y se buscan actualizaciones, y un aviso te lo indica.",
        t3: "Volver a ver algo no cambia la fecha con la que aparece en «Un día como hoy».",
      },
    },
    search: {
      title: "Búsqueda y búsqueda rápida",
      intro: "Hay dos formas de buscar: la búsqueda rápida, que aparece sobre cualquier pantalla, y la página Explorar, con una pestaña por tipo. Primero salen los resultados de tu propio catálogo y después se añaden los de las fuentes en línea a medida que responden.",
      steps: {
        s1: "Pulsa Ctrl+K o / (o el icono de la brújula, a la derecha de la barra superior) y escribe al menos dos letras.",
        s2: "La búsqueda rápida busca en todos los tipos a la vez: obras, personajes, staff y usuarios, hasta seis por grupo. Muévete con ↑ y ↓, abre con Intro o usa «Ver todo».",
        s3: "En Explorar, elige una pestaña para buscar un solo tipo. Cada tipo tiene su fuente: AniList para anime, manga y novelas ligeras; IGDB para videojuegos y novelas visuales; TMDB para películas y series; Open Library para libros, y Comic Vine para cómics.",
        s4: "Abre un resultado para ver su ficha y añadirlo a tu biblioteca.",
      },
      tips: {
        t1: "IGDB, TMDB y Comic Vine necesitan tus propias claves gratuitas. Sin ellas, Explorar muestra un aviso con un botón que te lleva al sitio exacto de Ajustes › Entorno.",
        t2: "Si una fuente falla o no tienes conexión, sigues viendo lo que ya está en tu catálogo local.",
        t3: "Pulsa Ctrl+F en Explorar para saltar al cuadro de búsqueda.",
      },
    },
    media_page: {
      title: "La ficha de una obra",
      intro: "Cada obra tiene una ficha con su portada, sus datos, tu progreso y varias pestañas de contenido relacionado. Casi todo se puede hacer con el teclado.",
      steps: {
        s1: "Haz clic en la portada (o pulsa E) para añadir la obra a tu biblioteca o editar tu entrada.",
        s2: "Pulsa + o − para cambiar tu progreso, de 1 a 9 para puntuarla (0 equivale a 10) y F para marcarla como favorita.",
        s3: "Las pestañas de abajo muestran obras relacionadas, ediciones, recomendaciones, temporadas, episodios y temas de opening y ending.",
        s4: "La sección «Usuarios» muestra las notas de los amigos de AniList a los que sigues, si tienes la cuenta conectada.",
        s5: "El botón de enlace (o L) copia un enlace que abre esta ficha en Metadea.",
      },
      tips: {
        t1: "Los juegos que son una edición de otro te llevan al juego principal y lo indican en el banner.",
        t2: "Tus capturas de un juego o episodio aparecen en su sección «Capturas de pantalla».",
      },
    },
    editor: {
      title: "Editar tu entrada",
      intro: "El editor reúne todo lo que tiene que ver contigo y una obra: estado, progreso, fechas, nota, notas personales y más. Se abre haciendo clic en la portada o pulsando E.",
      steps: {
        s1: "Elige el estado con los iconos: pendiente, en progreso, completado, en pausa o abandonado.",
        s2: "Indica tu progreso. Los videojuegos y las novelas visuales cuentan horas (H:MM); el resto, episodios, capítulos o volúmenes. Al llegar al total, la obra pasa a completada.",
        s3: "Añade una nota, las fechas de inicio y fin (o la fecha de visionado en las películas), hasta cinco etiquetas y tus notas personales.",
        s4: "Márcala como favorita, o como «Platino» en los juegos que hayas completado al 100 %.",
        s5: "En «Historial mensual», elige el mes que representa esta obra; cada mes admite una sola obra.",
        s6: "Guarda con Ctrl+S. Ctrl+Z y Ctrl+Y deshacen y rehacen.",
      },
      tips: {
        t1: "«Traer datos de tu perfil de AniList» rellena tu progreso y tus fechas con los de AniList.",
        t2: "Cuando la completas, «Compartir» crea una imagen vertical con la portada, tu nota y tu avatar.",
        t3: "Tus notas se convierten en reseñas en la pestaña «Reseñas» de tu perfil.",
      },
    },
    rewatch: {
      title: "Volver a ver, releer y rejugar",
      intro: "Cuando vuelves a algo que ya habías terminado, Metadea cuenta la repetición sin perder tus fechas originales.",
      steps: {
        s1: "Abre el editor de una obra completada y pulsa el botón de repetir («Volver a ver», «Releer» o «Rejugar»).",
        s2: "El progreso vuelve a cero y el estado pasa a en progreso; se conservan las fechas de la primera vez.",
        s3: "Al completarla de nuevo, el contador «Veces repetido» sube en uno.",
      },
      tips: {
        t1: "Si vuelves a pulsar el botón antes de terminar, la repetición se cancela sin contarse.",
        t2: "Las tarjetas de la biblioteca muestran ×2, ×3…, y las estadísticas suman las horas de cada vez.",
      },
    },
    sagas: {
      title: "Sagas, temporadas y relaciones",
      intro: "Las obras que van juntas (secuelas, precuelas, spin-offs, temporadas) están enlazadas, así que puedes ver una franquicia entera y cuánto llevas de ella.",
      steps: {
        s1: "Pulsa «Orden de la saga» en la ficha de una obra para ver toda la franquicia en orden. «Estás aquí» marca la obra actual, y la pestaña «Arcos Argumentales» divide las series largas en arcos.",
        s2: "La barra de progreso de la saga indica cuántas obras de la saga has completado; las que aún no se han estrenado no cuentan.",
        s3: "La pestaña «Relacionados» lista cada relación con su tipo (secuela, adaptación, spin-off…).",
      },
      tips: {
        t1: "Con «Unificar temporadas» activado (Ajustes › Preferencias), las temporadas de un anime se agrupan en una sola tarjeta de la biblioteca y la ficha muestra una pestaña «Temporadas».",
        t2: "La barra de la saga solo aparece cuando has completado al menos una parte.",
      },
    },
    characters: {
      title: "Personajes y staff",
      intro: "Los personajes y los autores tienen su propia página, a la que llegas desde el reparto de una obra o desde el buscador.",
      steps: {
        s1: "La página de un personaje muestra su biografía, las obras en las que aparece y sus actores de voz.",
        s2: "Marca un personaje como favorito para añadirlo a los personajes favoritos de tu perfil.",
        s3: "La página de una persona del staff lista sus obras y sus fechas.",
      },
      tips: {
        t1: "La búsqueda rápida también encuentra personajes y staff: escribe el nombre y mira sus grupos.",
      },
    },
    community: {
      title: "Catálogo comunitario y propuestas",
      intro: "Metadea comparte un catálogo comunitario: datos que añaden y corrigen los usuarios, revisados en GitHub. Tu copia se actualiza cada vez que abres la aplicación, y puedes proponer cambios desde la ficha de cualquier obra.",
      steps: {
        s1: "Conecta GitHub en Ajustes › Conexiones.",
        s2: "En la ficha de una obra, pulsa el botón + del banner (o P) para abrir el editor de propuestas.",
        s3: "Cambia títulos, sinopsis, fechas, recuentos, enlaces, imágenes, géneros, plataformas, personajes, relaciones, episodios, temas, arcos argumentales u orden de la saga. Puedes editar varias obras en la misma sesión.",
        s4: "Pulsa «Enviar propuesta»: se convierte en una pull request que se revisa antes de llegar a todo el mundo.",
      },
      tips: {
        t1: "Ajustes › Novedades › «Sincronizar ahora» descarga el catálogo cuando quieras.",
        t2: "Ajustes › Admin › Editor de catálogo muestra tu catálogo local; editar el compartido requiere permisos de escritura en el repositorio.",
      },
    },
    statuses: {
      title: "Tu biblioteca: estados y progreso",
      intro: "Tu biblioteca, en tu perfil, agrupa cada tipo por estado para que veas de un vistazo qué tienes pendiente, a medias o terminado.",
      steps: {
        s1: "Abre un tipo desde la barra superior o desde la pestaña «Biblioteca» de tu perfil.",
        s2: "Secciones: Pendientes, En progreso, En publicación (en progreso y que se sigue publicando), Completadas, En pausa y Abandonadas.",
        s3: "Filtra por nombre, formato, estado o fechas; ordena por nota, fecha o duración, y agrupa por saga o por pack.",
        s4: "Pulsa Ctrl+F para buscar dentro de la biblioteca.",
      },
      tips: {
        t1: "Los botones + y − de Inicio y las teclas +/− de la ficha actualizan el progreso sin abrir el editor.",
      },
    },
    ratings: {
      title: "Puntuaciones",
      intro: "Elige cómo prefieres puntuar: 5 estrellas, nota sobre 10 con dos decimales, nota entera sobre 10 o tres caritas. Incluso puedes llevar dos notas a la vez.",
      steps: {
        s1: "En Ajustes › Preferencias › Sistema de Calificación, elige la escala que quieras.",
        s2: "Activa «Doble calificación» para llevar una segunda nota con su propio nombre y escala (por ejemplo, Historia y Apartado visual).",
        s3: "Puntúa desde el editor o pulsa de 1 a 9 (0 = 10) en la ficha de una obra.",
      },
      tips: {
        t1: "Con la doble calificación, un selector en la biblioteca elige cuál de las dos notas se muestra.",
        t2: "Al sincronizar con AniList, tu nota se convierte a la escala de tu cuenta de AniList.",
        t3: "«Eliminar calificaciones», en Ajustes › Preferencias, borra todas tus notas tras pedirte confirmación.",
      },
    },
    favorites_lists: {
      title: "Favoritos, Hall of Fame y listas",
      intro: "Los favoritos y las listas te permiten mostrar lo que más te importa, en el orden que tú elijas.",
      steps: {
        s1: "Marca obras y personajes como favoritos; el botón de la corona añade además la obra a los favoritos generales «Multimedia».",
        s2: "En la pestaña «Favoritos», arrastra para reordenar y pon una imagen personalizada a cualquier favorito.",
        s3: "Tus 10 obras y tus 10 personajes principales forman el Hall of Fame de tu perfil.",
        s4: "En «Listas», crea listas de obras, personajes o episodios; hazlas privadas o de tipo ranking y ordénalas a mano, alfabéticamente o por fecha de salida.",
      },
      tips: {
        t1: "Las listas se pueden reordenar arrastrando.",
      },
    },
    tier_lists: {
      title: "Tier lists",
      intro: "Clasifica obras o personajes al estilo TierMaker: filas de la S a la F que puedes renombrar, recolorear, añadir, quitar y reordenar.",
      steps: {
        s1: "Abre Tier list en la barra de navegación y crea una lista de obras o de personajes.",
        s2: "Llena el banco de elementos desde tu biblioteca (filtros o rellenos rápidos como «todo lo completado de 2024»), tus listas y sagas, tus personajes o una búsqueda.",
        s3: "Arrastra las portadas a las filas, o selecciona varias y pulsa 1–9. Haz doble clic en una portada para devolverla al banco.",
      },
      tips: {
        t1: "Cada cambio se guarda solo y Ctrl+Z lo deshace. «Guardar como imagen» exporta el tablero como PNG y «Mostrar en mi perfil» la muestra en la pestaña Listas de tu perfil.",
      },
    },
    stats: {
      title: "Estadísticas e historial",
      intro: "La pestaña «Estadísticas» de tu perfil convierte tu biblioteca en números: cuánto has terminado, cuántas horas, qué géneros y cómo puntúas.",
      steps: {
        s1: "Las tarjetas de arriba resumen obras, temporadas, horas totales, nota media y obras puntuadas.",
        s2: "Debajo tienes el reparto por estado, el tiempo por categoría, tus géneros favoritos, la distribución de notas, lo completado por año y un mapa de actividad de seis meses.",
        s3: "La calculadora de pendientes estima cuánto tardarías en acabar lo que tienes pendiente, con o sin lo que llevas a medias.",
        s4: "La pestaña «Perfil» muestra tu historial mensual (una portada por mes) y tu actividad reciente.",
      },
      tips: {
        t1: "Las repeticiones cuentan: una serie vista dos veces suma sus horas dos veces.",
      },
    },
    social: {
      title: "Amigos y notificaciones",
      intro: "Con una cuenta vinculada puedes seguir a otras personas, ver su actividad y visitar su perfil. Los avisos de estrenos llegan como notificaciones del sistema.",
      steps: {
        s1: "En la pestaña «Amigos» de tu perfil, mira a quién sigues y quién te sigue.",
        s2: "Abre el perfil de alguien para ver su biblioteca en modo lectura y seguirle.",
        s3: "El feed de actividad de Inicio muestra lo que hacen tus amigos.",
      },
      tips: {
        t1: "Metadea envía notificaciones del sistema con los estrenos de hoy de obras que tienes pendientes, con los anime en emisión que sigues y con los episodios o capítulos nuevos de lo que estás viendo o leyendo.",
        t2: "La página de Notificaciones todavía está en desarrollo.",
      },
    },
    local_folders: {
      title: "Carpetas locales",
      intro: "Play encuentra tus archivos buscando en una carpeta por cada tipo. Metadea empareja cada archivo o subcarpeta con una obra de tu catálogo.",
      steps: {
        s1: "En Ajustes › Entorno › Rutas locales, elige una carpeta para cada tipo (anime, series, películas, manga, cómics, libros…).",
        s2: "Para los videojuegos también puedes usar «Añadir carpeta» en la cabecera de Play; cada subcarpeta cuenta como un juego.",
        s3: "Abre Play: los archivos reconocidos aparecen con la portada y los datos de la obra.",
        s4: "Si algo no se reconoce, usa «Localizar manualmente» y después «Renombrar para detección automática» para que la próxima vez se encuentre solo.",
      },
      tips: {
        t1: "El emparejamiento ignora tildes y signos de puntuación y respeta los números de temporada de los nombres.",
        t2: "Entre los archivos compatibles están mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz y cbr.",
        t3: "Pulsa Ctrl+F en Play para buscar en tu biblioteca local.",
      },
    },
    pc_launchers: {
      title: "Juegos de PC: Steam, Epic, GOG, Xbox y EA",
      intro: "Play detecta los juegos que tienes instalados en los principales lanzadores de PC, sin configurar nada.",
      steps: {
        s1: "Abre Play › Videojuegos: la primera visita analiza Steam, Epic Games, GOG, la aplicación de Xbox y EA.",
        s2: "Las visitas siguientes solo vuelven a analizar los lanzadores que han cambiado; «Escanear de nuevo» fuerza un análisis completo.",
        s3: "Añade tu clave de la API web de Steam en Ajustes › Entorno para tener también el tiempo de juego, la última partida y los juegos que tienes pero no están instalados.",
      },
      tips: {
        t1: "Si no aparecen los juegos de un lanzador, «Diagnóstico» muestra lo que ha encontrado Metadea.",
      },
    },
    roms: {
      title: "Emuladores y ROMs",
      intro: "Metadea puede reunir tu colección retro: lee tus carpetas de ROMs, limpia sus nombres, reconoce cada juego y lo abre con el emulador adecuado.",
      steps: {
        s1: "En Ajustes › Emuladores, elige una compañía y una consola.",
        s2: "Elige el emulador y su ejecutable, los argumentos de lanzamiento ({ROM} se sustituye por el archivo) y tu carpeta de ROMs.",
        s3: "Abre Play › Videojuegos: tus ROMs aparecen con nombres limpios y datos de IGDB.",
      },
      tips: {
        t1: "«Limpiar nombres de ROM automáticamente» renombra los archivos con un formato ordenado (y sus partidas guardadas con ellos). Un aviso te deja deshacerlo durante unos segundos.",
        t2: "Las ROMs de GameCube, Wii, DS y 3DS se reconocen por el ID de su cabecera; las actualizaciones y DLC de Switch se agrupan bajo el juego base.",
        t3: "Si una ROM se empareja con el juego equivocado, usa el lápiz («Cambiar juego en IGDB») en su panel de detalles.",
      },
    },
    metadata: {
      title: "Obtener metadatos",
      intro: "El botón «Metadatos» de Play descarga de una vez portadas, banners e información de tus juegos.",
      steps: {
        s1: "Abre Play › Videojuegos y pulsa «Metadatos», al final de la lista de plataformas.",
        s2: "Elige «Básico» (portada, banner, géneros, sinopsis, fecha y editor), «Logros de Steam» o ambos.",
        s3: "Sigue el avance en la ventana de progreso; puedes cancelar en cualquier momento.",
      },
      tips: {
        t1: "Abarca los juegos de Steam, GOG y ROMs. Los logros de Steam necesitan tu clave de la API web de Steam.",
        t2: "Los datos de los juegos vienen de IGDB, así que sus claves tienen que estar en Ajustes › Entorno.",
      },
    },
    achievements: {
      title: "Logros",
      intro: "El panel de detalles de un juego en Play tiene una pestaña de logros: los de Steam para los juegos de Steam y los de RetroAchievements para tus ROMs.",
      steps: {
        s1: "Para Steam, añade tu clave de la API web de Steam y ejecuta «Metadatos» › «Logros de Steam».",
        s2: "Para las ROMs, añade tu usuario y tu Web API key de RetroAchievements en Ajustes › Entorno.",
        s3: "Abre una ROM en Play: Metadea la vincula con su set de RetroAchievements por el hash del archivo o, si no lo consigue, por el título.",
        s4: "Si elige un set equivocado, usa «Vincular manualmente» o «Desvincular».",
      },
      tips: {
        t1: "Los logros se guardan en caché, así que puedes verlos sin conexión.",
        t2: "Después de una sesión, un aviso te dice cuántos logros has desbloqueado.",
        t3: "Las consolas sin sets de RetroAchievements (3DS, Wii, Wii U, Switch, PC…) no muestran el panel.",
      },
    },
    screenshots: {
      title: "Capturas de pantalla",
      intro: "La sección «Capturas de pantalla» de una obra reúne sus capturas de Imágenes › Metadea › <obra> y, en los juegos de Steam, tus capturas de Steam.",
      steps: {
        s1: "Pulsa F12 en el reproductor integrado para guardar un fotograma. Se guarda en Imágenes › Metadea › <obra>, con el episodio y el minuto en el nombre.",
        s2: "En el lector de cómics, haz clic derecho en una página y elige «Guardar página (PNG)».",
        s3: "En los emuladores, haz capturas como siempre: mientras corre un juego lanzado desde Metadea, cada captura se mueve a Imágenes › Metadea › <juego> y un aviso lo confirma.",
      },
      tips: {
        t1: "La carpeta de capturas del emulador se detecta sola en Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu, PPSSPP, Cemu y RPCS3; para otros emuladores, indícala en Ajustes › Emuladores (avanzado).",
        t2: "Las capturas de un juego que ya estaban en la carpeta del emulador se mueven allí la primera vez que abres el juego.",
      },
    },
    launching: {
      title: "Abrir juegos y tiempo de juego",
      intro: "El botón «Jugar» inicia cualquier juego de tu biblioteca local, y Metadea cuenta el tiempo que pasas jugando.",
      steps: {
        s1: "Abre un juego en Play y pulsa «Jugar».",
        s2: "Los juegos de Steam, Epic y GOG se abren con su lanzador; las ROMs, con el emulador configurado para su consola.",
        s3: "Metadea vigila el proceso del juego y suma cada sesión a tus horas de la biblioteca.",
      },
      tips: {
        t1: "Las sesiones de menos de 15 segundos no se cuentan.",
        t2: "Si el botón de una ROM está desactivado, su consola todavía no tiene emulador (Ajustes › Emuladores).",
        t3: "Mientras juegas, Discord muestra el juego (y tu progreso de RetroAchievements en las ROMs).",
      },
    },
    player: {
      title: "El reproductor de vídeo",
      intro: "Los episodios y películas locales se reproducen en el reproductor integrado de Metadea (libmpv), que guarda tu progreso por sí solo.",
      steps: {
        s1: "No hay nada que instalar: el reproductor (libmpv) viene incluido con Metadea.",
        s2: "Elige los controles: superpuestos sobre el vídeo o en una barra fija bajo el vídeo.",
        s3: "Pulsa «Reproducir» en un episodio de Play. El resto de la temporada se pone en cola; pulsa Q para verla.",
        s4: "Usa los menús para cambiar la pista de audio, los subtítulos y la velocidad (de 0,25× a 1×: más lento, nunca más rápido).",
        s5: "Al 80 % el episodio se marca como visto: se actualizan el estado, el progreso y AniList. Un aviso te deja deshacerlo.",
        s6: "Si cierras antes del 80 %, el siguiente «Reproducir» continúa en el segundo exacto.",
      },
      tips: {
        t1: "Haz clic en el vídeo para pausar y doble clic para la pantalla completa.",
        t2: "Si no se puede cargar libmpv, Metadea te avisa en lugar de abrir el vídeo.",
        t3: "Al terminar el último episodio, la obra se completa y su secuela se añade a tus pendientes.",
        t4: "Discord muestra lo que estás viendo con una cuenta atrás del tiempo que queda.",
      },
    },
    player_shortcuts: {
      title: "Atajos del reproductor",
      intro: "Todo lo del reproductor integrado se puede hacer con el teclado. Pulsa ? con el reproductor abierto para ver esta lista.",
      steps: {
        s1: "Espacio pausa; las flechas avanzan o retroceden 5 s (30 s con Mayús) y cambian el volumen.",
        s2: "N y P (o Ctrl+→ y Ctrl+←) pasan al episodio siguiente o al anterior.",
        s3: ", y . avanzan fotograma a fotograma; [ reduce la velocidad; D activa o desactiva el modo nocturno (diálogos claros).",
        s4: "Las teclas numéricas saltan al 10 %, 20 %… del vídeo.",
      },
      tips: {
        t1: "Esc cierra, por este orden: los menús abiertos, la pantalla completa y, por último, el reproductor.",
      },
    },
    skip_segments: {
      title: "Saltar openings y endings",
      intro: "El reproductor integrado detecta openings, endings, resúmenes y avances para que puedas saltarlos.",
      steps: {
        s1: "En Ajustes › Preferencias › Reproductor, elige cómo: mostrar un botón, saltar automáticamente o no detectar.",
        s2: "Con el botón, púlsalo (o pulsa S) cuando aparezca.",
        s3: "En modo automático, un aviso te dice qué se ha saltado y ofrece «Deshacer».",
      },
      tips: {
        t1: "Los tramos salen de los capítulos del archivo (MKV) y, en el anime, de AniSkip; si hay ambos, mandan los capítulos.",
      },
    },
    reader_comics: {
      title: "Leer cómics y manga",
      intro: "Los archivos CBZ, CBR y PDF se abren en el lector de Metadea, que recuerda la página por la que vas.",
      steps: {
        s1: "Abre el archivo desde Play.",
        s2: "Pasa página con las flechas, con Espacio o haciendo clic en el lado izquierdo o derecho de la página. Las páginas dobles se muestran juntas, con la portada sola.",
        s3: "Haz clic derecho en una página para añadir un marcador, ver tus marcadores o guardar la página como imagen.",
        s4: "Al llegar a la última página se marca como leído y se actualiza tu biblioteca.",
      },
      tips: {
        t1: "La página se guarda cada vez que pasas una.",
        t2: "«Dejar en pausa» cierra el lector pero guarda la sesión en una barra para que la retomes más tarde.",
      },
    },
    reader_epub: {
      title: "Leer libros EPUB",
      intro: "Los libros EPUB tienen su propio lector, con ajustes de tipografía, índice, marcadores y progreso.",
      steps: {
        s1: "Abre el libro desde Play.",
        s2: "En «Tipografía», elige la fuente, el tamaño, el interlineado, los márgenes, el tema de color (Papel, Sepia, Oscuro, Negro) y si justificar el texto.",
        s3: "Elige el modo «Páginas» o «Desplazamiento».",
        s4: "Pulsa T para ver el índice y usa «Añadir marcador aquí» para marcar un punto.",
        s5: "El porcentaje indica cuánto llevas; al 98 % el libro cuenta como leído.",
      },
      tips: {
        t1: "«Usar estilos del editor» respeta el diseño propio del libro.",
        t2: "El progreso se sincroniza con tu biblioteca y con AniList al terminar.",
      },
    },
    themes_jukebox: {
      title: "Openings, endings y la gramola",
      intro: "Las fichas de anime incluyen sus openings y endings. Marca con la estrella los que te gusten y sonarán en la gramola desde cualquier pantalla.",
      steps: {
        s1: "Abre un tema desde la pestaña «Temas» de una obra (o pulsa T). Cambia entre versiones (v1, v2…) y pasa al anterior o al siguiente.",
        s2: "Pulsa la estrella («Añadir a la gramola») para guardarlo.",
        s3: "Abre la gramola con el botón redondo de abajo a la derecha: el disco que gira muestra la portada y pausa al hacer clic.",
        s4: "Usa anterior/siguiente, la barra de progreso, el volumen, el modo aleatorio y la repetición (desactivada, cola o este tema).",
      },
      tips: {
        t1: "La gramola se pausa sola cuando se abre el reproductor, cuando empieza un vídeo local, cuando abres un tema en la ficha de una obra o cuando suena otro audio.",
        t2: "Las teclas multimedia del teclado la controlan, y recuerda el volumen, el modo aleatorio, la repetición y el último tema.",
        t3: "Los vídeos de los temas vienen de animethemes.moe, así que necesitan conexión.",
      },
    },
    api_keys: {
      title: "Claves API: para qué sirve cada una",
      intro: "Algunas fuentes necesitan una clave gratuita que creas en tu propia cuenta. Todas son opcionales: configura solo las de lo que uses.",
      steps: {
        s1: "Abre Ajustes › Entorno y haz clic en el logotipo de un servicio.",
        s2: "Pulsa el botón (i) para ver cómo conseguir esa clave, pégala y pulsa Guardar.",
        s3: "IGDB: videojuegos y novelas visuales, y los datos de tus ROMs. TMDB: películas y series. Comic Vine: cómics. Steam: tiempo de juego y logros.",
        s4: "AniList y MyAnimeList: un Client ID para conectar tu cuenta (la búsqueda de AniList funciona sin él). RetroAchievements: usuario y Web API key.",
      },
      tips: {
        t1: "En Windows, las claves se guardan cifradas en la base de datos de Metadea.",
        t2: "API-Sports es para eventos deportivos, un tipo que de momento está desactivado.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Conecta AniList para importar tu lista de anime y manga y mantenerla sincronizada: cada cambio que guardas en Metadea se envía a AniList.",
      steps: {
        s1: "Crea una aplicación en AniList y pega su Client ID en Ajustes › Entorno › AniList.",
        s2: "En Ajustes › Conexiones, pulsa «Conectar», autoriza a Metadea en el navegador y pega el código que te dé.",
        s3: "Pulsa «Importar» y elige los formatos (TV, películas, OVA, manga, novelas ligeras…).",
        s4: "«Importar» solo añade lo que aún no tienes; «Sincronizar» también actualiza lo que ya tienes con los datos de AniList.",
      },
      tips: {
        t1: "Guardar desde el editor, el reproductor, el lector o Inicio envía el cambio a AniList automáticamente.",
        t2: "AniList admite 60 peticiones por minuto; si llegas al límite, Metadea espera y te avisa.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList se conecta iniciando sesión en el navegador y recibe en segundo plano tus cambios de anime, manga y novelas ligeras.",
      steps: {
        s1: "Crea una aplicación de API en MyAnimeList con metadea://auth/mal como URL de redirección y pega su Client ID en Ajustes › Entorno › MyAnimeList (no hace falta el secreto).",
        s2: "En Ajustes › Conexiones, pulsa «Conectar»: se abre el navegador y después te devuelve a Metadea.",
        s3: "Si el navegador no vuelve, pega la dirección metadea://auth/mal?code=… en el cuadro y pulsa «Completar conexión».",
        s4: "«Importar» trae tu lista de MAL y la empareja con AniList; lo que no tiene equivalente se muestra aparte.",
      },
      tips: {
        t1: "Los cambios se envían a MAL cada vez que guardas, igual que con AniList. Las obras sin id de MAL se omiten.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea muestra tu progreso de RetroAchievements junto a tus ROMs. Solo lo muestra: los logros se desbloquean jugando en un emulador con RetroAchievements activado.",
      steps: {
        s1: "En retroachievements.org, abre tus ajustes y copia tu Web API key.",
        s2: "En Ajustes › Entorno › RetroAchievements, escribe tu usuario y la clave, y guarda.",
        s3: "Activa RetroAchievements en tu emulador con la misma cuenta.",
        s4: "Abre una ROM en Play para ver su set, tu progreso y cada logro.",
      },
      tips: {
        t1: "Los juegos se reconocen por el hash de la ROM, como hacen los emuladores, así que un volcado limpio se reconoce mejor.",
        t2: "Sin conexión ves los últimos datos guardados en caché.",
      },
    },
    discord: {
      title: "Discord",
      intro: "Si tienes Discord abierto, tu perfil muestra lo que haces en Metadea: jugar, ver, escuchar un tema, leer o consultar una obra.",
      steps: {
        s1: "Abre Discord en este ordenador; Metadea lo encuentra solo, aunque lo abras después.",
        s2: "Juega, reproduce un vídeo o un tema, o abre un libro o la ficha de una obra: tu estado cambia en consecuencia.",
        s3: "Las obras que estás consultando incluyen un botón «Open in Metadea» para que tus amigos también puedan abrirlas.",
      },
      tips: {
        t1: "Metadea no tiene un interruptor para esto: para ocultarlo, cierra Discord o desactiva compartir tu actividad en los ajustes del propio Discord.",
        t2: "En los vídeos se muestra el episodio y una cuenta atrás del tiempo restante; en los juegos de emulador se añade tu progreso de RetroAchievements.",
      },
    },
    deep_links: {
      title: "Enlaces y compartir",
      intro: "Los enlaces de Metadea abren una página directamente en la aplicación, incluso desde un navegador o un chat.",
      steps: {
        s1: "En la ficha de una obra, pulsa el botón de enlace (o L) para copiar su enlace.",
        s2: "Compártelo: cuando alguien con Metadea lo abra, la aplicación se abrirá en esa obra.",
        s3: "Los enlaces que empiezan por metadea:// abren directamente obras, personajes, perfiles o Inicio.",
      },
      tips: {
        t1: "Los enlaces compartidos pasan por una pequeña página web que se los entrega a Metadea, así que también funcionan en aplicaciones que no abren enlaces metadea://.",
      },
    },
    github: {
      title: "GitHub y otras conexiones",
      intro: "GitHub sirve para proponer cambios al catálogo comunitario. Solo necesita permiso para abrir pull requests en repositorios públicos.",
      steps: {
        s1: "En Ajustes › Conexiones › Comunidad y perfil, pulsa «Conectar» junto a GitHub.",
        s2: "Copia el código que muestra Metadea, abre github.com/login/device y pégalo.",
        s3: "De vuelta en Metadea, el editor de propuestas ya está disponible en todas las obras.",
      },
      tips: {
        t1: "En Ajustes › Conexiones también aparece VNDB, para novelas visuales, que llegará próximamente.",
      },
    },
    appearance: {
      title: "Apariencia y perfil",
      intro: "Haz tuyos Metadea y tu perfil: fondo, color de acento, fuente del nombre, avatar, banner y biografía.",
      steps: {
        s1: "En Ajustes › Apariencia, elige un fondo dinámico (hay 14, de Nebulosa a Pizarra).",
        s2: "Elige un color de acento o recupera el de por defecto.",
        s3: "Escribe el nombre que quieres mostrar y prueba las fuentes con las flechas.",
        s4: "Sube un avatar, una foto cuadrada para las imágenes que compartes y un banner, y escribe una biografía.",
      },
      tips: {
        t1: "La foto cuadrada solo se usa en las imágenes que compartes; si está vacía, se usa tu avatar.",
      },
    },
    ui_themes: {
      title: "Temas de interfaz (skins)",
      intro: "Las skins cambian el aspecto de todo Metadea. Son carpetas con un archivo theme.json y, si quieres, CSS; puedes crearlas tú o conseguirlas de otras personas.",
      steps: {
        s1: "En Ajustes › Plugins › Temas de interfaz, pulsa «Abrir carpeta de temas».",
        s2: "Copia ahí la carpeta de un tema (o pulsa «Crear tema de ejemplo») y pulsa «Recargar».",
        s3: "Pulsa «Activar» en el tema que quieras. Sigue activo al reiniciar.",
        s4: "Si haces el tuyo, activa «Vigilar cambios» para ver tus ediciones cada dos segundos.",
      },
      tips: {
        t1: "Los temas «Solo variables» solo cambian colores, radios y velocidades, y son seguros. Los de «CSS completo» pueden cambiarlo todo y romper alguna pantalla.",
        t2: "Si un tema deja algo inservible, pulsa Ctrl+Mayús+T en cualquier sitio para desactivarlo.",
        t3: "Los temas no pueden cargar nada de internet; para compartir uno, comprime su carpeta en un ZIP.",
      },
    },
    language: {
      title: "Idioma",
      intro: "Metadea está disponible en español, inglés, alemán, japonés, italiano, francés, catalán y ruso.",
      steps: {
        s1: "Abre Ajustes › Preferencias › Idioma y pulsa el código de tu idioma.",
        s2: "La aplicación se recarga en el nuevo idioma.",
      },
      tips: {
        t1: "Los títulos y las sinopsis vienen de sus fuentes y conservan el idioma de estas.",
      },
    },
    shortcuts: {
      title: "Atajos de teclado",
      intro: "La mayoría de acciones tienen atajo. La lista cambia con cada pantalla, así que siempre ves los que funcionan donde estás.",
      steps: {
        s1: "Pulsa ? en cualquier pantalla para mostrar u ocultar la hoja de atajos.",
        s2: "La hoja los agrupa en Generales, Página, Ventana y Reproductor.",
        s3: "Ajustes › Preferencias › Atajos de teclado muestra la misma lista.",
      },
      tips: {
        t1: "Los atajos todavía no se pueden personalizar.",
        t2: "Los atajos no se activan mientras escribes en un cuadro de texto, salvo los pensados para ello (como Ctrl+S en los editores).",
      },
    },
    privacy: {
      title: "Uso sin conexión y privacidad",
      intro: "Metadea está pensado para funcionar sin internet. Tu biblioteca, tu progreso y tus ajustes están en tu ordenador; la red solo se usa para lo que se indica aquí.",
      steps: {
        s1: "Al abrir la aplicación, si hay conexión: la búsqueda de actualizaciones y la descarga del último catálogo comunitario.",
        s2: "Al buscar o abrir una obra nueva: consultas a sus fuentes (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "Al guardar: la sincronización con AniList y MyAnimeList, solo si las has conectado.",
        s4: "La sincronización del perfil y la actividad: solo con una cuenta vinculada a Google, y el perfil solo cuando lo confirmas.",
      },
      tips: {
        t1: "Cada fuente tiene un límite de peticiones; si lo alcanzas, Metadea espera y muestra un aviso.",
        t2: "Con Discord solo se comunica de forma local, dentro de tu ordenador.",
      },
    },
    backup: {
      title: "Dónde están tus datos y copias de seguridad",
      intro: "Todo se guarda en una base de datos dentro de tu carpeta de usuario (en Windows, %APPDATA%\\com.metadea.app). Una copia de seguridad es un único archivo .7z con esa base de datos, tus imágenes personalizadas y tus skins; las cachés se dejan fuera porque se vuelven a descargar.",
      steps: {
        s1: "Abre Ajustes › Copia de seguridad y pulsa «Crear copia». Guarda el .7z fuera de la carpeta de datos de Metadea.",
        s2: "Para restaurar, pulsa «Restaurar desde archivo» y elige un .7z (o un .zip de versiones anteriores). Metadea comprueba cada archivo, guarda una copia de tus datos actuales junto a la carpeta y se reinicia para aplicar la copia.",
        s3: "«Abrir carpeta», en Ajustes › Entorno › Rutas locales, abre la carpeta de datos.",
        s4: "Vincula Google Drive en la misma pestaña para subir copias a una carpeta privada de la app, al momento o automáticamente cada día o cada semana; puedes restaurar cualquiera desde la lista.",
      },
      tips: {
        t1: "Nadie más tiene una copia de tu biblioteca: haz una copia de seguridad antes de cambios grandes y de vez en cuando.",
      },
    },
    updates: {
      title: "Actualizaciones y mantenimiento",
      intro: "Metadea busca versiones nuevas al abrirse y te pregunta antes de instalar nada.",
      steps: {
        s1: "Cuando hay una versión nueva, un cuadro de diálogo te pregunta si quieres instalarla; la aplicación se reinicia para terminar.",
        s2: "En Ajustes › Novedades, pulsa «Buscar actualizaciones» para comprobarlo en ese momento.",
        s3: "En la misma pestaña, «Sincronizar ahora» descarga el catálogo comunitario y «Reparar IDs» arregla los personajes guardados con ID antiguos de TMDB.",
      },
      tips: {
        t1: "Sin internet, la comprobación se omite sin avisar y todo lo demás sigue funcionando.",
      },
    },
  },
};
