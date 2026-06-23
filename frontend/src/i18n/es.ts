export const es = {
  home: {
    title: 'Tu biblioteca personal de medios',
  },
  nav: {
    login: 'Iniciar sesión',
    register: 'Registrarse',
  },
  search: {
    title: 'Buscar',
    types: {
      anime:  'Anime',
      manga:  'Manga',
      game:   'Juegos',
      movie:  'Películas',
      series: 'Series',
      book:   'Libros',
    },
    placeholder:  'Buscar {type}...',
    idle_label:   'Busca {type}',
    idle_hint:    'Escribe al menos 2 caracteres',
    error:        'Error al buscar. Inténtalo de nuevo.',
    no_results:   'Sin resultados para "{q}"',
  },
} as const;
