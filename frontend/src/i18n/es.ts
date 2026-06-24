export const es = {
  home: {
    title: 'Tu biblioteca personal de medios',
  },
  nav: {
    home:          'Inicio',
    search:        'Buscar',
    notifications: 'Notificaciones',
    account:       'Mi cuenta',
  },
  auth: {
    login:    'Iniciar sesión',
    register: 'Registrarse',
  },
  profile: {
    sign_out:    'Cerrar sesión',
    library:     'Mi biblioteca',
    empty:       'Tu biblioteca está vacía. ¡Empieza a buscar obras!',
    empty_cta:   'Ir al buscador',
    stats_title: 'En tu biblioteca',
  },
  notifications: {
    title:       'Notificaciones',
    coming_soon: 'Las notificaciones estarán disponibles próximamente.',
  },
  search: {
    title: 'Buscar',
    types: {
      all:    'Todos',
      anime:  'Anime',
      manga:  'Manga',
      novel:  'Novela Ligera',
      game:   'Videojuegos',
      vnovel: 'Novela Visual',
      movie:  'Películas',
      series: 'Series',
      book:   'Libros',
      user:   'Usuarios',
    },
    placeholder: 'Busca {type}...',
    idle_label:  'Busca {type}',
    idle_hint:   'Escribe al menos 2 caracteres',
    error:       'Error al buscar. Inténtalo de nuevo.',
    no_results:  'Sin resultados para "{q}"',
  },
} as const;
