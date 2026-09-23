// User guide (/guide) — reference locale. Structure (groups, icons, settings
// deep links, shortcuts) lives in lib/welcome/guide-content.ts; every section
// id there has an entry here with the same shape in all 8 locales.
export const guideEn = {
  page_title: "User guide",
  page_subtitle: "How every part of Metadea works, from your first search to playing, watching, reading and backing up. Search for a topic or pick one from the contents.",
  search_label: "Search the guide",
  search_placeholder: "Search: player, ROMs, AniList…",
  search_clear: "Clear search",
  results_count: "{count} of {total} sections",
  no_results_title: "Nothing found",
  no_results_body: "No section mentions “{query}”. Try a shorter or different word.",
  toc_title: "Contents",
  steps_title: "How to use it",
  tips_title: "Tips",
  shortcuts_title: "Shortcuts",
  open_settings: "Open Settings › {tab}",
  open_settings_service: "Open Settings › {tab} › {service}",
  open_page: "Open {page}",
  back_to_top: "Back to top",
  nav_link: "User guide",
  sheet_link: "Open the user guide",
  groups: {
    start: "Getting started",
    discover: "Discover",
    library: "Your library",
    play: "Play",
    watch: "Watch, read & listen",
    integrations: "Integrations",
    customize: "Customization",
    data: "Data & privacy",
  },
  keys: {
    next_page: "Next page",
    prev_page: "Previous page",
    next_chapter: "Next chapter",
    prev_chapter: "Previous chapter",
    font_size: "Bigger / smaller text",
    toc: "Table of contents",
    fullscreen: "Full screen",
    close_reader: "Close the reader",
  },
  sections: {
    overview: {
      title: "What Metadea is",
      intro: "Metadea is a personal library for everything you play, watch and read: games, anime, manga, light novels, visual novels, series, films, books and comics. It lives on your computer and works offline; the internet is only used to look things up and to sync when you ask it to.",
      steps: {
        s1: "Find a work with the search (Ctrl+K) and open its page.",
        s2: "Click the cover to add it to your library and set its status, progress, dates and rating.",
        s3: "Point Play at your folders, launchers and emulators to open your games, videos and books from Metadea.",
        s4: "Follow your progress on Home and in your profile: statistics, favorites, lists and history.",
      },
      tips: {
        t1: "Your library is a database on this computer. Nobody else has a copy, so make a backup from time to time (Settings › Backup).",
        t2: "Every setting from the welcome guide can be changed later in Settings.",
      },
    },
    navigation: {
      title: "Getting around",
      intro: "The top bar is always there. The arrows go back and forward, the icons on the left open Home, Play and Explore, the names in the middle open your library filtered by type, and the right-hand group holds search, notifications, your profile and Settings.",
      steps: {
        s1: "Use the ← and → arrows at the far left, or Alt+← / Alt+→, to move through your history.",
        s2: "Click a media type in the middle of the bar (Anime, Manga, Games…) to jump to that part of your library.",
        s3: "Press Ctrl+1 to Ctrl+6 to jump straight to Home, Play, Profile, Explore, Notifications or Settings.",
        s4: "Press ? on any screen to see the shortcuts that work there.",
      },
      tips: {
        t1: "On Explore and Play the middle of the bar turns into that page's own tabs.",
        t2: "On a Mac, Ctrl in these shortcuts is ⌘.",
      },
    },
    account: {
      title: "Your account",
      intro: "The first time you open Metadea you only choose a user name: the session is local and nothing is uploaded. You can link it to Google later to have a public profile and see friends' activity.",
      steps: {
        s1: "To link a local session, use “Link with Google” on Home.",
        s2: "With a linked account, Home asks once a day whether to sync your profile; it is only uploaded when you press “Sync”.",
        s3: "“Sign out” is at the bottom of Settings › Appearance.",
      },
      tips: {
        t1: "Signing out only forgets the session: your library stays on this computer.",
        t2: "“Not now” hides the sync prompt until your next visit to Home.",
      },
    },
    home: {
      title: "Home",
      intro: "Home is your daily summary: what you are in the middle of, what comes out this month and what your friends are doing.",
      steps: {
        s1: "The first block shows what you are watching, reading or playing, grouped by type. Use + and − on a cover to add or subtract an episode or chapter without opening the work.",
        s2: "The calendar shows this month's releases. “For you” only includes works in your library; “General” includes everything. Filter by type and move between months with the arrows.",
        s3: "The right-hand column opens with “On this day”: works you finished on today's date in earlier years.",
        s4: "Below it, the activity feed switches between “Friends” and “General”.",
        s5: "The rail on the far right shows “Airing today” (episodes from your library that come out today) and “Continue watching”: the last thing you played in Play, with the time left. Click it to resume where you stopped.",
      },
      tips: {
        t1: "Blocks with nothing to show stay hidden, so a new library starts almost empty.",
        t2: "A few seconds after launch Metadea downloads the latest community data and checks for updates, and tells you with a notice.",
        t3: "Rewatching something does not move the date it appears in “On this day”.",
      },
    },
    search: {
      title: "Search and quick search",
      intro: "There are two ways to search: quick search, which floats over any screen, and the Explore page, with a tab per media type. Results from your own catalog appear first, and online sources are added as they answer.",
      steps: {
        s1: "Press Ctrl+K or / (or the compass icon on the right of the top bar) and type at least two letters.",
        s2: "Quick search looks in every type at once: works, characters, staff and users, up to six per group. Move with ↑ and ↓, open with Enter, or use “See all”.",
        s3: "On Explore, choose a tab to search one type. Each type has its source: AniList for anime, manga and light novels; IGDB for games and visual novels; TMDB for films and series; Open Library for books; Comic Vine for comics.",
        s4: "Open a result to see its page and add it to your library.",
      },
      tips: {
        t1: "IGDB, TMDB and Comic Vine need your own free keys. Without them Explore shows a notice with a button that takes you to the right place in Settings › Environment.",
        t2: "If a source fails or you are offline, you still see what is already in your local catalog.",
        t3: "Press Ctrl+F on Explore to jump to the search box.",
      },
    },
    media_page: {
      title: "A work's page",
      intro: "Every work has a page with its cover, data, your progress and several tabs of related content. Almost everything can be done from the keyboard.",
      steps: {
        s1: "Click the cover (or press E) to add the work to your library or edit your entry.",
        s2: "Press + or − to change your progress, 1–9 to rate it (0 means 10) and F to mark it as a favorite.",
        s3: "The tabs below show related works, editions, recommendations, seasons, episodes and opening/ending themes.",
        s4: "The “Users” section shows the scores of the AniList friends you follow, when you are connected.",
        s5: "The link button (or L) copies a link that opens this page in Metadea.",
      },
      tips: {
        t1: "Games that are an edition of another one take you to the main game and say so in the banner.",
        t2: "Your own screenshots of a game or episode appear in its “Screenshots” section.",
      },
    },
    editor: {
      title: "Editing your entry",
      intro: "The editor holds everything about your relationship with a work: status, progress, dates, rating, notes and more. It opens by clicking the cover or pressing E.",
      steps: {
        s1: "Pick a status with the icons: planning, in progress, completed, paused or dropped.",
        s2: "Set your progress. Games and visual novels count hours (H:MM); everything else counts episodes, chapters or volumes. Reaching the total marks the work as completed.",
        s3: "Add a rating, start and finish dates (or the viewing date for films), up to five tags and personal notes.",
        s4: "Mark it as a favorite, or as “Platinum” for games you have completed 100 %.",
        s5: "In “Monthly history”, choose the month this work represents; each month holds one work.",
        s6: "Save with Ctrl+S. Ctrl+Z and Ctrl+Y undo and redo.",
      },
      tips: {
        t1: "“Import data from your AniList profile” fills in your progress and dates from AniList.",
        t2: "Once completed, “Share” creates a vertical image with the cover, your rating and your avatar.",
        t3: "Your notes become reviews in the “Reviews” tab of your profile.",
      },
    },
    rewatch: {
      title: "Rewatching, rereading and replaying",
      intro: "When you go back to something you had finished, Metadea counts the repeat without losing your original dates.",
      steps: {
        s1: "Open the editor of a completed work and press the repeat button (“Rewatch”, “Reread” or “Replay”).",
        s2: "Progress goes back to zero and the status to in progress; the first run's dates are kept.",
        s3: "When you complete it again, the “Times repeated” counter goes up by one.",
      },
      tips: {
        t1: "Press the button again before finishing to cancel the repeat without counting it.",
        t2: "Library cards show ×2, ×3… and statistics count the hours of every run.",
      },
    },
    sagas: {
      title: "Sagas, seasons and relations",
      intro: "Works that belong together — sequels, prequels, spin-offs, seasons — are linked, so you can see a whole franchise and how much of it you have finished.",
      steps: {
        s1: "Press “Saga order” on a work's page to see the whole franchise in order. “You are here” marks the current work, and the “Story Arcs” tab splits long series into arcs.",
        s2: "The saga progress bar tells you how many works of the saga you have completed; unreleased works do not count.",
        s3: "The “Related” tab lists every relation with its type (sequel, adaptation, spin-off…).",
      },
      tips: {
        t1: "With “Unify seasons” on (Settings › Preferences), anime seasons are grouped into one library card and the page shows a “Seasons” tab instead.",
        t2: "The saga bar only appears once you have completed at least part of the saga.",
      },
    },
    characters: {
      title: "Characters and staff",
      intro: "Characters and creators have their own pages, reachable from a work's cast or from search.",
      steps: {
        s1: "A character page shows the biography, the works they appear in and their voice actors.",
        s2: "Mark a character as a favorite to add it to your profile's favorite characters.",
        s3: "A staff page lists that person's works and dates.",
      },
      tips: {
        t1: "Quick search also finds characters and staff: type the name and look at their groups.",
      },
    },
    community: {
      title: "Community catalog and proposals",
      intro: "Metadea shares a community catalog: data added and corrected by users, reviewed on GitHub. Your copy is updated at every launch, and you can propose changes from any work's page.",
      steps: {
        s1: "Connect GitHub in Settings › Connections.",
        s2: "On a work's page, press the + button in the banner (or P) to open the proposal editor.",
        s3: "Change titles, synopsis, dates, counts, links, images, genres, platforms, characters, relations, episodes, themes, story arcs or saga order. You can edit several works in the same session.",
        s4: "Press “Send proposal”: it becomes a pull request that is reviewed before it reaches everyone.",
      },
      tips: {
        t1: "Settings › What's New › “Sync now” downloads the catalog on demand.",
        t2: "Settings › Admin › catalog editor shows your local catalog; editing the shared one needs write access to the repository.",
      },
    },
    statuses: {
      title: "Your library: statuses and progress",
      intro: "Your library, in your profile, groups each type by status so you can see at a glance what is pending, in progress or done.",
      steps: {
        s1: "Open a type from the top bar or the “Library” tab of your profile.",
        s2: "Sections: Planning, In progress, Airing (in progress and still being released), Completed, Paused and Dropped.",
        s3: "Filter by name, format, status or dates, sort by rating, date or duration, and group by saga or bundle.",
        s4: "Press Ctrl+F to search inside the library.",
      },
      tips: {
        t1: "Home's + and − buttons and the media page's +/− keys update progress without opening the editor.",
      },
    },
    ratings: {
      title: "Ratings",
      intro: "Choose how you like to score: 5 stars, a 10 with two decimals, a whole 10, or three faces. You can even keep two ratings at once.",
      steps: {
        s1: "In Settings › Preferences › Rating system, pick the scale you want.",
        s2: "Turn on “Dual rating” to keep a second score with its own name and scale (for example Story and Visuals).",
        s3: "Rate from the editor, or press 1–9 (0 = 10) on a work's page.",
      },
      tips: {
        t1: "With dual rating, a selector in the library chooses which of the two scores is shown.",
        t2: "When syncing with AniList, your score is converted to the scale of your AniList account.",
        t3: "“Delete ratings” in Settings › Preferences erases every rating after asking for confirmation.",
      },
    },
    favorites_lists: {
      title: "Favorites, Hall of Fame and lists",
      intro: "Favorites and lists let you show what matters most to you, in the order you choose.",
      steps: {
        s1: "Mark works and characters as favorites; the crown button also adds a work to the general “Multimedia” favorites.",
        s2: "In the “Favorites” tab, drag to reorder and give any favorite a custom image.",
        s3: "Your top 10 works and top 10 characters make up the Hall of Fame on your profile.",
        s4: "In “Lists”, create lists of works, characters or episodes; make them private or a ranking and sort them by hand, alphabetically or by release.",
      },
      tips: {
        t1: "Lists can be reordered by dragging.",
      },
    },
    tier_lists: {
      title: "Tier lists",
      intro: "Rank works in tiers from S to F, or in tiers you name and color yourself.",
      steps: {
        s1: "Open Tier list and create a new one.",
        s2: "Add works from your catalog; they wait in the “Unclassified” pool.",
        s3: "Drag each work to its tier. Click a tier's name or color to change it.",
      },
      tips: {
        t1: "Tier lists of characters and community search are coming soon.",
      },
    },
    stats: {
      title: "Statistics and history",
      intro: "The “Statistics” tab of your profile turns your library into numbers: how much you have finished, how many hours, which genres and how you rate.",
      steps: {
        s1: "The top cards sum up works, seasons, total hours, average score and rated works.",
        s2: "Below you have the split by status, time by category, favorite genres, score distribution, completions per year and a six-month activity map.",
        s3: "The backlog calculator estimates how long you would need to finish what is pending, with or without what you have in progress.",
        s4: "The “Profile” tab shows your monthly history (one cover per month) and your recent activity.",
      },
      tips: {
        t1: "Repeats count: a series watched twice adds its hours twice.",
      },
    },
    social: {
      title: "Friends and notifications",
      intro: "With a linked account you can follow other people, see their activity and visit their profiles. Release reminders arrive as system notifications.",
      steps: {
        s1: "In your profile's “Friends” tab, see who you follow and who follows you.",
        s2: "Open someone's profile to see their library in read-only mode and follow them.",
        s3: "Home's activity feed shows what your friends are doing.",
      },
      tips: {
        t1: "Metadea sends system notifications for today's releases of works you plan to see, for airing anime you are following and for new episodes or chapters of what you are watching or reading.",
        t2: "The Notifications page is still being built.",
      },
    },
    local_folders: {
      title: "Local folders",
      intro: "Play finds your files by looking in one folder per media type. Metadea matches each file or subfolder with a work in your catalog.",
      steps: {
        s1: "In Settings › Environment › Local routes, choose a folder for each type (anime, series, films, manga, comics, books…).",
        s2: "For games you can also use “Add folder” in the Play header; each subfolder counts as one game.",
        s3: "Open Play: matched files appear with the work's cover and data.",
        s4: "If something is not recognized, use “Locate manually”, and then “Rename for automatic detection” so it is found on its own next time.",
      },
      tips: {
        t1: "Matching ignores accents and punctuation and respects season numbers in names.",
        t2: "Supported files include mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz and cbr.",
        t3: "Press Ctrl+F in Play to search your local library.",
      },
    },
    pc_launchers: {
      title: "PC games: Steam, Epic, GOG, Xbox and EA",
      intro: "Play detects the games you have installed from the main PC launchers, with no setup.",
      steps: {
        s1: "Open Play › Games: the first visit scans Steam, Epic Games, GOG, the Xbox app and EA.",
        s2: "Later visits only re-scan the launchers that changed; “Scan again” forces a full scan.",
        s3: "Add your Steam Web API key in Settings › Environment to also get playtime, last played date and owned games that are not installed.",
      },
      tips: {
        t1: "If a launcher's games do not appear, “Diagnostics” shows what Metadea found.",
      },
    },
    roms: {
      title: "Emulators and ROMs",
      intro: "Metadea can hold your retro collection: it reads your ROM folders, cleans up their names, recognizes each game and opens it with the right emulator.",
      steps: {
        s1: "In Settings › Emulators, choose a company and a console.",
        s2: "Pick the emulator and its executable, the launch arguments ({ROM} is replaced by the file) and your ROM folder.",
        s3: "Optionally set the ROM extensions to look for (empty = the usual ones) and the emulator's screenshots folder.",
        s4: "Open Play › Games: your ROMs appear with clean names and IGDB data.",
      },
      tips: {
        t1: "“Clean up ROM names automatically” renames files to a tidy format (and their save files with them). A notice lets you undo it for a few seconds.",
        t2: "GameCube, Wii, DS and 3DS ROMs are recognized by the ID in their header; Switch updates and DLC are grouped under the base game.",
        t3: "If a ROM is matched to the wrong game, use the pencil (“Change game in IGDB”) in its detail panel.",
      },
    },
    metadata: {
      title: "Getting metadata",
      intro: "The “Metadata” button in Play downloads covers, banners and information for your games in one go.",
      steps: {
        s1: "Open Play › Games and press “Metadata” at the bottom of the platform list.",
        s2: "Choose “Basic” (cover, banner, genres, synopsis, date, publisher), “Steam achievements”, or both.",
        s3: "Follow the progress window; you can cancel at any time.",
      },
      tips: {
        t1: "It covers Steam, GOG and ROM games. Steam achievements need your Steam Web API key.",
        t2: "Game data comes from IGDB, so its keys have to be set in Settings › Environment.",
      },
    },
    achievements: {
      title: "Achievements",
      intro: "A game's detail panel in Play has an achievements tab: Steam achievements for Steam games and RetroAchievements for your ROMs.",
      steps: {
        s1: "For Steam, add your Steam Web API key and run “Metadata” › “Steam achievements”.",
        s2: "For ROMs, add your RetroAchievements user and Web API key in Settings › Environment.",
        s3: "Open a ROM in Play: Metadea links it to its RetroAchievements set by the file's hash, or by title if that fails.",
        s4: "If it picks the wrong set, use “Link manually” or “Unlink”.",
      },
      tips: {
        t1: "Achievements are cached, so you can see them offline.",
        t2: "After a session, a notice tells you how many achievements you unlocked.",
        t3: "Consoles without RetroAchievements sets (3DS, Wii, Wii U, Switch, PC…) do not show the panel.",
      },
    },
    screenshots: {
      title: "Screenshots",
      intro: "A work's “Screenshots” section gathers captures from three places: the ones you take in Metadea, your Steam screenshots and your emulator's capture folder.",
      steps: {
        s1: "Press F12 in the built-in player to save a frame. It goes to Pictures › Metadea › <work>, named with the episode and time.",
        s2: "In the comic reader, right-click a page and choose “Save page (PNG)”.",
        s3: "For emulators, set the screenshots folder of each console in Settings › Emulators, or leave it empty so it is detected.",
      },
      tips: {
        t1: "The capture folder is detected automatically for Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu and PPSSPP.",
        t2: "Emulator captures are filtered to the game; if none match, recent captures are shown with a note.",
      },
    },
    launching: {
      title: "Launching games and playtime",
      intro: "The “Play” button starts any game in your local library, and Metadea counts the time you spend playing.",
      steps: {
        s1: "Open a game in Play and press “Play”.",
        s2: "Steam, Epic and GOG games open through their launcher; ROMs open with the emulator set for their console.",
        s3: "Metadea watches the game's process and adds each session to your hours in the library.",
      },
      tips: {
        t1: "Sessions shorter than 15 seconds are not counted.",
        t2: "If a ROM's button is disabled, its console has no emulator yet (Settings › Emulators).",
        t3: "While you play, Discord shows the game (and your RetroAchievements progress for ROMs).",
      },
    },
    player: {
      title: "The video player",
      intro: "Local episodes and films play in Metadea's built-in player (libmpv), which keeps your progress by itself. You can use VLC instead if you prefer.",
      steps: {
        s1: "Choose the player in Settings › Preferences › Player: built-in (libmpv) or VLC (external).",
        s2: "Choose the controls: overlaid on the video, or in a fixed bar under the video.",
        s3: "Press “Play” on an episode in Play. The rest of the season is queued; press Q to see the queue.",
        s4: "Use the menus to change audio track, subtitles and speed (0.5× to 2×).",
        s5: "At 80 % the episode is marked as watched: status, progress and AniList update. A notice lets you undo it.",
        s6: "Close before 80 % and the next “Play” resumes at the exact second.",
      },
      tips: {
        t1: "Click the video to pause and double-click for full screen.",
        t2: "If libmpv cannot be loaded, Metadea uses VLC automatically and tells you.",
        t3: "Finishing the last episode completes the work and adds its sequel to your planning list.",
        t4: "Discord shows what you are watching with a countdown of the time left.",
      },
    },
    player_shortcuts: {
      title: "Player shortcuts",
      intro: "Everything in the built-in player can be done from the keyboard. Press ? while it is open to see this list.",
      steps: {
        s1: "Space pauses; the arrows seek 5 s (30 s with Shift) and change the volume.",
        s2: "N and P (or Ctrl+→ and Ctrl+←) move to the next or previous episode.",
        s3: ", and . move frame by frame; [ and ] change the speed.",
        s4: "Number keys jump to 10 %, 20 %… of the video.",
      },
      tips: {
        t1: "Esc closes, in this order: open menus, full screen, then the player.",
      },
    },
    skip_segments: {
      title: "Skipping openings and endings",
      intro: "The built-in player detects openings, endings, recaps and previews so you can skip them.",
      steps: {
        s1: "In Settings › Preferences › Player, choose how: show a button, skip automatically, or do not detect.",
        s2: "With the button, press it (or S) when it appears.",
        s3: "In automatic mode a notice says what was skipped and offers “Undo”.",
      },
      tips: {
        t1: "Segments come from the file's chapters (MKV) and, for anime, from AniSkip; chapters win when both exist.",
        t2: "It only works in the built-in player, not in VLC.",
      },
    },
    reader_comics: {
      title: "Reading comics and manga",
      intro: "CBZ, CBR and PDF files open in Metadea's reader, which remembers the page you are on.",
      steps: {
        s1: "Open the file from Play.",
        s2: "Turn pages with the arrows, Space or by clicking the left or right side of the page. Double pages are shown side by side, with the cover alone.",
        s3: "Right-click a page to add a bookmark, see your bookmarks or save the page as an image.",
        s4: "Reaching the last page marks it as read and updates your library.",
      },
      tips: {
        t1: "Your page is saved at every turn.",
        t2: "“Put on standby” closes the reader but keeps the session in a bar so you can pick it up later.",
      },
    },
    reader_epub: {
      title: "Reading EPUB books",
      intro: "EPUB books have their own reader, with typography controls, a table of contents, bookmarks and progress.",
      steps: {
        s1: "Open the book from Play.",
        s2: "In “Typography”, choose the font, size, line spacing, margins, color theme (Paper, Sepia, Dark, Black) and justification.",
        s3: "Choose “Pages” or “Scroll” mode.",
        s4: "Press T for the table of contents and use “Add bookmark here” to mark a place.",
        s5: "The percentage shows how far you are; at 98 % the book counts as read.",
      },
      tips: {
        t1: "“Use publisher styles” respects the book's own design.",
        t2: "Progress syncs with your library and AniList when you finish.",
      },
    },
    themes_jukebox: {
      title: "Openings, endings and the jukebox",
      intro: "Anime pages include their opening and ending themes. Star the ones you like and they will play in the jukebox on any screen.",
      steps: {
        s1: "Open a theme from a work's “Themes” tab (or press T). Switch between versions (v1, v2…) and move to the previous or next one.",
        s2: "Press the star (“Add to the jukebox”) to save it.",
        s3: "Open the jukebox with the round button at the bottom right: the spinning disc shows the cover and pauses when clicked.",
        s4: "Use previous/next, the progress bar, volume, shuffle and repeat (off, queue or this theme).",
      },
      tips: {
        t1: "The jukebox pauses by itself when the player opens, when a local video starts, when a theme opens on a work's page or when other audio plays.",
        t2: "Your keyboard's media keys control it, and it remembers volume, shuffle, repeat and the last theme.",
        t3: "Theme videos come from animethemes.moe, so they need a connection.",
      },
    },
    api_keys: {
      title: "API keys: which one is for what",
      intro: "Some sources need a free key that you create in your own account. They are all optional: set up only the ones for the things you use.",
      steps: {
        s1: "Open Settings › Environment and click a service's logo.",
        s2: "Press the (i) button to see how to get that key, paste it and press Save.",
        s3: "IGDB: games and visual novels, and your ROMs' data. TMDB: films and series. Comic Vine: comics. Steam: playtime and achievements.",
        s4: "AniList and MyAnimeList: a Client ID to connect your account (AniList search works without it). RetroAchievements: user and Web API key.",
      },
      tips: {
        t1: "On Windows, keys are stored encrypted in Metadea's database.",
        t2: "API-Sports is for sports events, a type that is disabled for now.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Connect AniList to import your anime and manga list and keep it in sync: every change you save in Metadea is sent to AniList.",
      steps: {
        s1: "Create an app on AniList and paste its Client ID in Settings › Environment › AniList.",
        s2: "In Settings › Connections press “Connect”, authorize Metadea in the browser and paste the code it gives you.",
        s3: "Press “Import” and choose the formats (TV, films, OVA, manga, light novels…).",
        s4: "“Import” only adds what you do not have yet; “Sync” also updates what you already have with AniList's data.",
      },
      tips: {
        t1: "Saving from the editor, the player, the reader or Home sends the change to AniList automatically.",
        t2: "AniList allows 60 requests per minute; if you hit the limit, Metadea waits and tells you.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList connects with a browser login and receives your anime, manga and light novel changes in the background.",
      steps: {
        s1: "Create an API app on MyAnimeList with metadea://auth/mal as the redirect URL, and paste its Client ID in Settings › Environment › MyAnimeList (no secret needed).",
        s2: "In Settings › Connections press “Connect”: the browser opens and brings you back to Metadea.",
        s3: "If the browser does not return, paste the metadea://auth/mal?code=… address in the box and press “Complete connection”.",
        s4: "“Import” brings your MAL list and matches it with AniList; anything without a match is listed apart.",
      },
      tips: {
        t1: "Changes are sent to MAL every time you save, just like AniList. Works without a MAL id are skipped.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea shows your RetroAchievements progress next to your ROMs. It only shows it: achievements are unlocked while playing in an emulator with RetroAchievements enabled.",
      steps: {
        s1: "On retroachievements.org, open your settings and copy your Web API key.",
        s2: "In Settings › Environment › RetroAchievements, enter your user name and the key, and save.",
        s3: "Enable RetroAchievements in your emulator with the same account.",
        s4: "Open a ROM in Play to see its set, your progress and each achievement.",
      },
      tips: {
        t1: "Games are recognized by the ROM's hash, like the emulators do, so a clean dump matches best.",
        t2: "Without a connection you see the last cached data.",
      },
    },
    discord: {
      title: "Discord",
      intro: "If Discord is open, your profile shows what you are doing in Metadea: playing, watching, listening to a theme, reading or browsing a work.",
      steps: {
        s1: "Open Discord on this computer; Metadea finds it on its own, even if you open it later.",
        s2: "Play a game, a video or a theme, or open a book or a work's page: your status changes to match.",
        s3: "Works you are viewing include an “Open in Metadea” button so your friends can open them too.",
      },
      tips: {
        t1: "There is no switch in Metadea: to hide it, close Discord or turn off activity sharing in Discord's own settings.",
        t2: "Video shows the episode and a countdown of the time left; games from emulators add your RetroAchievements progress.",
      },
    },
    deep_links: {
      title: "Links and sharing",
      intro: "Metadea links open a page straight in the app, even from a browser or a chat.",
      steps: {
        s1: "On a work's page, press the link button (or L) to copy its link.",
        s2: "Share it: when someone with Metadea opens it, the app opens on that work.",
        s3: "Links starting with metadea:// open works, characters, profiles or Home directly.",
      },
      tips: {
        t1: "Shared links go through a small web page that hands the link over to Metadea, so they also work in apps that do not open metadea:// links.",
      },
    },
    github: {
      title: "GitHub and other connections",
      intro: "GitHub is used to propose changes to the community catalog. It only needs permission to open pull requests on public repositories.",
      steps: {
        s1: "In Settings › Connections › Community and profile, press “Connect” next to GitHub.",
        s2: "Copy the code Metadea shows, open github.com/login/device and paste it.",
        s3: "Back in Metadea, the proposal editor is available on every work.",
      },
      tips: {
        t1: "Settings › Connections also shows VNDB for visual novels, coming soon.",
      },
    },
    appearance: {
      title: "Appearance and profile",
      intro: "Make Metadea and your profile yours: background, accent color, name font, avatar, banner and biography.",
      steps: {
        s1: "In Settings › Appearance, pick a dynamic background (there are 14, from Nebula to Blueprint).",
        s2: "Choose an accent color, or restore the default one.",
        s3: "Type the name to show and try the fonts with the arrows.",
        s4: "Upload an avatar, a square photo for shared images and a banner, and write a biography.",
      },
      tips: {
        t1: "The square photo is only used in the images you share; if it is empty, your avatar is used.",
      },
    },
    ui_themes: {
      title: "Interface themes (skins)",
      intro: "Skins restyle all of Metadea. They are folders with a theme.json file and, optionally, CSS, which you can make yourself or get from other people.",
      steps: {
        s1: "In Settings › Appearance › Community themes, press “Open themes folder”.",
        s2: "Copy a theme folder there (or press “Create example theme”) and press “Reload”.",
        s3: "Press “Activate” on the theme you want. It stays on after restarting.",
        s4: "If you make your own, turn on “Watch for changes” to see your edits every two seconds.",
      },
      tips: {
        t1: "“Variables only” themes only change colors, radii and speeds, and are safe. “Full CSS” themes can change anything and may break a screen.",
        t2: "If a theme leaves something unusable, press Ctrl+Shift+T anywhere to turn it off.",
        t3: "Themes cannot load anything from the internet; to share one, zip its folder.",
      },
    },
    language: {
      title: "Language",
      intro: "Metadea is available in Spanish, English, German, Japanese, Italian, French, Catalan and Russian.",
      steps: {
        s1: "Open Settings › Preferences › Language and press your language's code.",
        s2: "The app reloads in the new language.",
      },
      tips: {
        t1: "Titles and synopses come from their sources and keep those sources' language.",
      },
    },
    shortcuts: {
      title: "Keyboard shortcuts",
      intro: "Most actions have a shortcut. The list changes with each screen, so you always see the ones that work where you are.",
      steps: {
        s1: "Press ? on any screen to show or hide the shortcuts sheet.",
        s2: "The sheet groups them as General, Page, Window and Player.",
        s3: "Settings › Preferences › Keyboard shortcuts shows the same list.",
      },
      tips: {
        t1: "Shortcuts cannot be customized yet.",
        t2: "Shortcuts do not fire while you type in a text box, except the ones meant for it (like Ctrl+S in editors).",
      },
    },
    privacy: {
      title: "Offline use and privacy",
      intro: "Metadea is designed to work without internet. Your library, progress and settings are on your computer; the network is only used for the things listed below.",
      steps: {
        s1: "At launch, if you are online: an update check and the download of the latest community catalog.",
        s2: "When you search or open a new work: queries to its sources (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "When you save: sync with AniList and MyAnimeList, only if you have connected them.",
        s4: "Profile sync and activity: only with an account linked to Google, and profile sync only when you confirm it.",
      },
      tips: {
        t1: "Each source has a request limit; if you reach it, Metadea waits and shows a notice.",
        t2: "Discord is contacted only locally, on your own computer.",
      },
    },
    backup: {
      title: "Where your data lives and backups",
      intro: "Everything is stored in a database in your user folder (on Windows, %APPDATA%\\com.metadea.app). A backup copies that folder into a single ZIP file.",
      steps: {
        s1: "Open Settings › Backup and press “Export data”. Save the ZIP outside Metadea's data folder.",
        s2: "To restore, press “Import data” and choose a ZIP. Metadea first saves a copy of your current data next to the folder, then restarts to apply the backup.",
        s3: "“Open folder” in Settings › Environment › Local routes opens the data folder.",
      },
      tips: {
        t1: "Nobody else has a copy of your library: make a backup before big changes and from time to time.",
      },
    },
    updates: {
      title: "Updates and maintenance",
      intro: "Metadea checks for new versions at launch and asks before installing anything.",
      steps: {
        s1: "When there is a new version, a dialog asks whether to install it; the app restarts to finish.",
        s2: "In Settings › What's New, press “Check for updates” to check now.",
        s3: "In the same tab, “Sync now” downloads the community catalog and “Repair IDs” fixes characters saved with old TMDB IDs.",
      },
      tips: {
        t1: "Without internet the check is skipped silently and everything else keeps working.",
      },
    },
  },
} as const;
