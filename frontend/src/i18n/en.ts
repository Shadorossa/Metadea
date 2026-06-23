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
      anime:  'Anime',
      manga:  'Manga',
      game:   'Games',
      movie:  'Movies',
      series: 'Series',
      book:   'Books',
    },
    placeholder:  'Search {type}...',
    idle_label:   'Search {type}',
    idle_hint:    'Type at least 2 characters',
    error:        'Search failed. Please try again.',
    no_results:   'No results for "{q}"',
  },
} as const;
