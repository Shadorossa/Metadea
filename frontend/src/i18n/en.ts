export const en = {
  home: {
    title: 'Your personal media library',
  },
  nav: {
    login: 'Log in',
    register: 'Sign up',
  },
  search: {
    title: 'Search',
    types: {
      all:    'All',
      anime:  'Anime',
      manga:  'Manga',
      novel:  'Light Novel',
      game:   'Games',
      vn:     'Visual Novel',
      movie:  'Movies',
      series: 'Series',
      book:   'Books',
      user:   'Users',
    },
    placeholder: 'Search {type}...',
    idle_label:  'Search {type}',
    idle_hint:   'Type at least 2 characters',
    error:       'Search failed. Please try again.',
    no_results:  'No results for "{q}"',
  },
} as const;
