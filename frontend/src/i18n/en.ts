export const en = {
  home: {
    title: 'Your personal media library',
  },
  nav: {
    home:          'Home',
    search:        'Search',
    notifications: 'Notifications',
    account:       'My account',
  },
  auth: {
    login:    'Log in',
    register: 'Sign up',
  },
  profile: {
    sign_out:    'Sign out',
    library:     'My library',
    empty:       'Your library is empty. Start searching for titles!',
    empty_cta:   'Go to search',
    stats_title: 'In your library',
  },
  notifications: {
    title:       'Notifications',
    coming_soon: 'Notifications will be available soon.',
  },
  search: {
    title: 'Search',
    types: {
      all:    'All',
      anime:  'Anime',
      manga:  'Manga',
      novel:  'Light Novel',
      game:   'Games',
      vnovel: 'Visual Novel',
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
