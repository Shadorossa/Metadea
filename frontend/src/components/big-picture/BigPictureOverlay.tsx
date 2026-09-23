import '../../styles/pages/local/big-picture.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ModalShell, modalStack } from '../shared/ModalShell';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { useGamePresence } from '../shared/hooks/useGamePresence';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { getLangCode, getT } from '../../i18n/runtime';
import { interpolateTranslation } from '../../lib/i18n-dom/apply-translations';
import { formatAppError } from '../../lib/errors/format-error';
import type { BigPictureAction, ConnectedPad } from '../../lib/big-picture/gamepad';
import { readNavigatorGamepads, detectControllerFamily } from '../../lib/big-picture/gamepad';
import { chunkRowLengths, indexToPos, moveFocus, posToIndex } from '../../lib/big-picture/focus-grid';
import type { BigPictureItem, BigPictureTab } from '../../lib/big-picture/categories';
import type { InputDevice } from '../../lib/big-picture/glyphs';
import { hasMediaRemote, mediaRemoteCountStore, sendMediaRemote, type MediaRemoteCommand } from '../../lib/big-picture/media-remote';
import { navigateForeignDialog } from '../../lib/big-picture/dialog-pad-navigation';
import { readBigPicturePreferences, writeBigPicturePreferences } from '../../lib/big-picture/big-picture-preferences';
import { isWindowFullscreen, setWindowFullscreen, quitApp } from '../../lib/big-picture/window-mode';
import { playNavSound, type NavSound } from '../../lib/big-picture/nav-sounds';
import { markNextProgress, setLibraryFavorite } from '../../lib/big-picture/big-picture-actions';
import { launchLocalGameSession } from '../../lib/local/game-launch-session';
import { playbackStore } from '../../lib/local/playback-service';
import { jukeboxStore } from '../../lib/jukebox/jukebox-store';
import { setVolume as setAppVolume } from '../../lib/jukebox/jukebox-engine';
import { interceptAmbientInput } from '../../lib/ambient/ambient-state';
import { openMediaEditor } from '../../lib/media/editor/open-media-editor';
import { useBigPictureItems, platformName, type BigPictureData } from './hooks/useBigPictureItems';
import { useGamepadFrameLoop } from './hooks/useGamepad';
import { useFocusedExtras } from './hooks/useFocusedExtras';
import { createInputLayers, InputLayerContext } from './input-layers';
import { BigPictureBackdrop } from './BigPictureBackdrop';
import { BigPictureGrid } from './BigPictureGrid';
import { BigPictureDetails, primaryActionKind } from './BigPictureDetails';
import { BigPictureStatus } from './BigPictureStatus';
import { BigPictureHints, ButtonGlyph, type Hint } from './BigPictureHints';
import { BigPictureSheet, type SheetEntry } from './BigPictureSheet';
import { BigPictureSearch } from './BigPictureSearch';
import type { BigPictureResumeRequest } from './BigPictureMode';

type Layer = 'browse' | 'options' | 'menu' | 'search';
type Notice = { text: string; tone: 'info' | 'error' };

const NOTICE_MS = 4000;
// How long a work gets to open its player/reader before Big Picture says
// nothing playable was found (the panel scans its folder first).
const OPEN_WATCHDOG_MS = 9000;
const PAGE_ROWS = 3;
const VOLUME_STEP = 0.1;

const PAD_TO_REMOTE: Partial<Record<BigPictureAction, MediaRemoteCommand>> = {
  confirm: 'confirm', back: 'back', up: 'up', down: 'down', left: 'left', right: 'right',
  tab_prev: 'prev', tab_next: 'next', page_prev: 'prev', page_next: 'next',
};

const SOUND_FOR: Partial<Record<BigPictureAction, NavSound>> = {
  up: 'move', down: 'move', left: 'move', right: 'move',
  tab_prev: 'tab', tab_next: 'tab', page_prev: 'move', page_next: 'move',
  confirm: 'confirm', back: 'back', details: 'confirm', search: 'confirm', menu: 'confirm',
};

const KEY_BINDINGS: ReadonlyArray<{ action: BigPictureAction; keys: string[]; description: string; inInputs?: boolean }> = [
  { action: 'up', keys: ['arrowup'], description: 'shortcuts.big_picture_navigate', inInputs: true },
  { action: 'down', keys: ['arrowdown'], description: 'shortcuts.big_picture_navigate', inInputs: true },
  { action: 'left', keys: ['arrowleft'], description: 'shortcuts.big_picture_navigate', inInputs: true },
  { action: 'right', keys: ['arrowright'], description: 'shortcuts.big_picture_navigate', inInputs: true },
  { action: 'confirm', keys: ['enter'], description: 'shortcuts.big_picture_select', inInputs: true },
  { action: 'back', keys: ['escape'], description: 'shortcuts.big_picture_back', inInputs: true },
  { action: 'back', keys: ['backspace'], description: 'shortcuts.big_picture_back' },
  { action: 'details', keys: ['i'], description: 'shortcuts.big_picture_options' },
  { action: 'search', keys: ['s', '/'], description: 'shortcuts.big_picture_search' },
  { action: 'menu', keys: ['m'], description: 'shortcuts.big_picture_menu' },
  { action: 'tab_prev', keys: ['q', '['], description: 'shortcuts.big_picture_tabs' },
  { action: 'tab_next', keys: ['e', ']'], description: 'shortcuts.big_picture_tabs' },
  { action: 'page_prev', keys: ['pageup'], description: 'shortcuts.big_picture_page' },
  { action: 'page_next', keys: ['pagedown'], description: 'shortcuts.big_picture_page' },
];

interface BigPictureOverlayProps {
  data: BigPictureData;
  onResume: (request: BigPictureResumeRequest) => void;
  onExit: () => void;
}

export default function BigPictureOverlay({ data, onResume, onExit }: BigPictureOverlayProps) {
  const allT = getT();
  const t = allT.big_picture;
  const { items, tabs, gameByKey } = useBigPictureItems(data);

  const [tabId, setTabId] = useState('all');
  const tabIndex = Math.max(0, tabs.findIndex(tab => tab.id === tabId));
  const tab = tabs[tabIndex];
  // Focus is remembered per tab by item key, so a library refresh (a
  // favourite toggled, progress saved) keeps it on the same item.
  const [focusKeys, setFocusKeys] = useState<Record<string, string>>({});
  const found = focusKeys[tab.id] ? tab.items.findIndex(item => item.key === focusKeys[tab.id]) : -1;
  const focusIndex = found === -1 ? 0 : found;
  const focused: BigPictureItem | null = tab.items[focusIndex] ?? null;
  const focusedGame = focused ? gameByKey.get(focused.key) : undefined;
  const extras = useFocusedExtras(focused, focusedGame);

  const [columns, setColumns] = useState(1);
  const [layer, setLayer] = useState<Layer>('browse');
  const [pads, setPads] = useState<ConnectedPad[]>([]);
  const [device, setDevice] = useState<InputDevice>(() => {
    const pad = readNavigatorGamepads().find(p => p?.connected);
    return pad ? detectControllerFamily(pad.id) : 'keyboard';
  });
  const [prefs, setPrefs] = useState(readBigPicturePreferences);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsListRef = useRef<HTMLDivElement>(null);
  const layers = useMemo(() => createInputLayers(), []);

  const jukebox = useExternalStore(jukeboxStore);
  const playback = useExternalStore(playbackStore);
  const remoteCount = useExternalStore(mediaRemoteCountStore);
  const runningGame = useGamePresence();
  const [dismissedGameStart, setDismissedGameStart] = useState<number | null>(null);
  const dimmed = !!runningGame && dismissedGameStart !== runningGame.startTime;

  const showNotice = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ text, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);

  // Window fullscreen for as long as Big Picture is open; restored on exit
  // unless the window was already fullscreen before.
  useEffect(() => {
    let cancelled = false;
    let wasFullscreen = false;
    isWindowFullscreen().then(current => {
      wasFullscreen = current;
      if (!cancelled && !current) void setWindowFullscreen(true);
    });
    document.documentElement.classList.add('big-picture-open');
    return () => {
      cancelled = true;
      document.documentElement.classList.remove('big-picture-open');
      if (!wasFullscreen) void setWindowFullscreen(false);
    };
  }, []);

  // A reader's/player's Escape leaves window fullscreen first; take it back
  // once the last media surface closes.
  const previousRemoteCount = useRef(remoteCount);
  useEffect(() => {
    if (previousRemoteCount.current > 0 && remoteCount === 0) void setWindowFullscreen(true);
    previousRemoteCount.current = remoteCount;
  }, [remoteCount]);

  // LB/RB past the visible tabs scroll the strip along.
  useEffect(() => {
    tabsListRef.current?.children[tabIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabIndex]);

  // Dialogs opened on top of Big Picture (the media editor…) own the input.
  const modalBaseline = useRef(Number.POSITIVE_INFINITY);
  useEffect(() => { modalBaseline.current = modalStack.size; }, []);
  const foreignModalOpen = () => modalStack.size > modalBaseline.current;

  const setFocus = (index: number) => {
    const item = tab.items[Math.max(0, Math.min(tab.items.length - 1, index))];
    if (item) setFocusKeys(prev => ({ ...prev, [tab.id]: item.key }));
  };

  const tabLabel = (target: BigPictureTab): string => {
    switch (target.kind) {
      case 'all': return t.tab_all;
      case 'recent': return t.tab_recent;
      case 'installed': return t.tab_installed;
      case 'favorites': return t.tab_favorites;
      case 'emulated': return platformName(target.platform ?? '');
      case 'media': return t[`tab_${target.mediaKind ?? 'anime'}` as const];
    }
  };
  const kindLabel = (item: BigPictureItem) => (item.kind === 'game' ? t.kind_game : t[`tab_${item.mediaKind ?? 'anime'}` as const]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const pendingOpen = useRef<{ externalId: string; title: string } | null>(null);
  const activate = (item: BigPictureItem) => {
    if (busyKey) return;
    if (item.kind === 'game') {
      const game = gameByKey.get(item.key);
      if (!game) return;
      setBusyKey(item.key);
      showNotice(interpolateTranslation(t.launching, { title: item.title }));
      launchLocalGameSession({
        target: game,
        externalId: item.externalId ?? game.external_id ?? game.app_id ?? game.name,
        title: item.title,
        coverUrl: item.cover,
      })
        .then(() => setDismissedGameStart(null))
        .catch(err => showNotice(`${interpolateTranslation(t.launch_failed, { title: item.title })} — ${formatAppError(err, getT())}`, 'error'))
        .finally(() => setBusyKey(null));
      return;
    }
    if (!item.externalId) return;
    // Works open through Local's own detail panel (resume + folder match +
    // player/reader) — exactly what its Continue/Read button does.
    showNotice(interpolateTranslation(t.opening, { title: item.title }));
    pendingOpen.current = { externalId: item.externalId, title: item.title };
    onResume({ category: item.category, externalId: item.externalId });
    const request = pendingOpen.current;
    window.setTimeout(() => {
      if (pendingOpen.current !== request) return;
      pendingOpen.current = null;
      const opened = hasMediaRemote() || playbackStore.get()?.externalId === request.externalId;
      if (!opened) showNotice(interpolateTranslation(t.nothing_to_play, { title: request.title }), 'error');
    }, OPEN_WATCHDOG_MS);
  };

  const browse = (action: BigPictureAction) => {
    const count = tab.items.length;
    switch (action) {
      case 'up': case 'down': case 'left': case 'right': {
        if (count === 0) return;
        const next = moveFocus(chunkRowLengths(count, columns), indexToPos(focusIndex, columns), action, { wrapHorizontal: true });
        setFocus(posToIndex(next, columns));
        return;
      }
      case 'page_prev': case 'page_next':
        setFocus(focusIndex + (action === 'page_next' ? 1 : -1) * PAGE_ROWS * columns);
        return;
      case 'tab_prev': case 'tab_next': {
        const step = action === 'tab_next' ? 1 : -1;
        setTabId(tabs[(tabIndex + step + tabs.length) % tabs.length].id);
        return;
      }
      case 'confirm': if (focused) activate(focused); return;
      case 'details': if (focused) setLayer('options'); return;
      case 'search': setLayer('search'); return;
      case 'menu': setLayer('menu'); return;
      case 'back': case 'guide': onExit(); return;
    }
  };
  const browseRef = useRef(browse);
  useEffect(() => { browseRef.current = browse; });
  useEffect(() => layers.push(action => browseRef.current(action)), [layers]);

  const route = (action: BigPictureAction, source: 'pad' | 'keyboard') => {
    if (source === 'pad') {
      if (hasMediaRemote()) {
        const command = PAD_TO_REMOTE[action];
        if (command) sendMediaRemote(command);
        return;
      }
      if (foreignModalOpen()) { navigateForeignDialog(action, rootRef.current?.closest('[role="dialog"]') ?? null); return; }
      // A launched game in front: its pad input is not ours.
      if (!document.hasFocus()) return;
    }
    if (dimmed) {
      if (runningGame && (action === 'confirm' || action === 'back' || action === 'menu')) setDismissedGameStart(runningGame.startTime);
      return;
    }
    if (action === 'guide') { onExit(); return; }
    const sound = SOUND_FOR[action];
    if (sound && prefs.navigationSounds) playNavSound(sound, jukebox.volume);
    layers.dispatch(action);
  };

  useGamepadFrameLoop(true, {
    onActions: (actions, pad) => {
      // Pad input is Ambient mode's activity signal; while its screensaver
      // is up, a press only closes it.
      if (interceptAmbientInput()) return;
      setDevice(pad.family);
      for (const action of actions) route(action, 'pad');
    },
    onPadsChanged: setPads,
  });

  const canTakeKeys = () => !hasMediaRemote() && !foreignModalOpen();
  useShortcuts('modal', KEY_BINDINGS.map((binding, i) => ({
    id: `big_picture.${binding.action}.${i}`,
    keys: binding.keys,
    description: binding.description,
    allowInInputs: binding.inInputs,
    when: canTakeKeys,
    handler: () => { setDevice('keyboard'); route(binding.action, 'keyboard'); },
  })));

  // ── Layers ─────────────────────────────────────────────────────────────────

  const closeLayer = () => setLayer('browse');
  const focusedExternalId = focused?.externalId;
  const entry = focused?.externalId ? data.mediaRaw?.entries.find(e => e.external_id === focused.externalId) : undefined;
  const runWrite = (write: Promise<unknown>) => {
    closeLayer();
    write.then(() => showNotice(t.saved)).catch(err => showNotice(`${t.save_failed} — ${formatAppError(err, getT())}`, 'error'));
  };
  const optionEntries: SheetEntry[] = focused ? [
    ...(entry ? [{
      id: 'favorite',
      label: entry.is_favorite === 1 ? t.option_favorite_remove : t.option_favorite_add,
      onSelect: () => runWrite(setLibraryFavorite(entry, entry.is_favorite !== 1)),
    }] : []),
    ...(entry && focused.kind === 'media' && focused.progress ? [{
      id: 'progress',
      label: focused.progress.unit === 'chapter' ? t.option_mark_next_chapter : t.option_mark_next_episode,
      disabled: !!focused.progress.total && focused.progress.current >= focused.progress.total,
      onSelect: () => runWrite(markNextProgress(entry, focused.progress?.total ?? null)),
    }] : []),
    ...(focusedExternalId ? [{
      id: 'edit',
      label: t.option_edit_log,
      onSelect: () => { closeLayer(); openMediaEditor(focusedExternalId); },
    }] : []),
    { id: 'close', label: t.option_close, onSelect: closeLayer },
  ] : [];

  const toggleSounds = () => setPrefs(writeBigPicturePreferences({ navigationSounds: !prefs.navigationSounds }));
  const menuEntries: SheetEntry[] = [
    { id: 'sounds', label: t.menu_sounds, value: prefs.navigationSounds ? t.on : t.off, onSelect: toggleSounds, onAdjust: toggleSounds },
    {
      id: 'volume',
      label: t.menu_volume,
      value: <span className="bp-volume"><span className="bp-volume-bar"><span style={{ transform: `scaleX(${jukebox.volume})` }} /></span>{Math.round(jukebox.volume * 100)}%</span>,
      onAdjust: direction => {
        setAppVolume(Math.round((jukebox.volume + direction * VOLUME_STEP) * 10) / 10);
        if (prefs.navigationSounds) playNavSound('move', Math.max(0.1, jukebox.volume));
      },
    },
    { id: 'exit', label: t.menu_exit, onSelect: onExit },
    { id: 'quit', label: t.menu_quit, onSelect: () => { quitApp().catch(err => showNotice(formatAppError(err, getT()), 'error')); } },
  ];

  const pausedHere = !!focused && playback?.externalId === focused.externalId && playback?.status === 'paused';
  const primary = focused ? primaryActionKind(focused, pausedHere) : 'play';
  const hints: Hint[] = layer === 'browse'
    ? [
      { button: 'confirm', label: t[`action_${primary}` as const] },
      { button: 'details', label: t.hint_options },
      { button: 'search', label: t.hint_search },
      { button: 'menu', label: t.hint_menu },
      { button: 'tabs', label: t.hint_tabs },
      { button: 'back', label: t.hint_exit },
    ]
    : layer === 'search'
      ? [
        { button: 'confirm', label: t.hint_select },
        { button: 'details', label: t.key_delete },
        { button: 'back', label: t.hint_back },
      ]
      : [
        { button: 'confirm', label: t.hint_select },
        { button: 'back', label: t.hint_back },
      ];

  const hero = extras?.banner ?? focused?.hero ?? focused?.cover ?? null;
  const loading = !data.mediaRaw && items.length === 0;

  return (
    <ModalShell
      overlay={false}
      onClose={onExit}
      label={t.dialog_label}
      panelClassName={`bp-root${dimmed ? ' is-dimmed' : ''}`}
      closeOnEscape={false}
      closeOnBackdrop={false}
      stopPanelPropagation={false}
    >
      <InputLayerContext.Provider value={layers}>
        <div className="bp-shell" ref={rootRef}>
          <BigPictureBackdrop image={hero} />

          <header className="bp-top">
            <nav className="bp-tabs" aria-label={t.dialog_label}>
              <ButtonGlyph device={device} button="tabs" />
              <div className="bp-tabs-list" role="tablist" ref={tabsListRef}>
                {tabs.map((entryTab, i) => (
                  <button
                    key={entryTab.id}
                    type="button"
                    role="tab"
                    aria-selected={i === tabIndex}
                    className={`bp-tab${i === tabIndex ? ' is-active' : ''}`}
                    tabIndex={-1}
                    onClick={() => setTabId(entryTab.id)}
                  >
                    {tabLabel(entryTab)}
                    <span className="bp-tab-count">{entryTab.items.length}</span>
                  </button>
                ))}
              </div>
            </nav>
            <BigPictureStatus pads={pads} locale={getLangCode()} t={t} />
            <button type="button" className="bp-exit" onClick={onExit} aria-label={t.menu_exit} title={t.menu_exit}>
              <X size={22} aria-hidden="true" />
            </button>
          </header>

          <main className="bp-main">
            <BigPictureDetails
              item={focused}
              game={focusedGame}
              extras={extras}
              device={device}
              primary={primary}
              busy={!!busyKey}
              onPrimary={() => { if (focused) activate(focused); }}
              t={t}
              profileT={allT.profile}
              kindLabel={focused ? kindLabel(focused) : ''}
            />
            <BigPictureGrid
              items={tab.items}
              focusIndex={focusIndex}
              domFocus={layer === 'browse' && !dimmed}
              onColumnsChange={setColumns}
              onCardClick={index => (index === focusIndex ? focused && activate(focused) : setFocus(index))}
              onWheelStep={rows => browse(rows > 0 ? 'down' : 'up')}
              emptyLabel={loading ? t.loading : items.length === 0 ? t.empty_library : t.empty_tab}
              favoriteLabel={t.favorite_badge}
            />
          </main>

          <footer className="bp-bottom">
            <BigPictureHints device={device} hints={hints} />
          </footer>

          {notice && <div className={`bp-notice bp-notice--${notice.tone}`} role="status">{notice.text}</div>}

          {layer === 'options' && focused && <BigPictureSheet title={focused.title} entries={optionEntries} onClose={closeLayer} />}
          {layer === 'menu' && <BigPictureSheet title={t.menu_title} entries={menuEntries} onClose={closeLayer} className="bp-sheet--menu" />}
          {layer === 'search' && (
            <BigPictureSearch
              items={items}
              t={t}
              onClose={closeLayer}
              onPick={item => {
                setTabId('all');
                setFocusKeys(prev => ({ ...prev, all: item.key }));
                closeLayer();
              }}
            />
          )}

          {dimmed && runningGame && (
            <div className="bp-dim" role="status">
              <p className="bp-dim-title">{interpolateTranslation(t.now_playing, { title: runningGame.title })}</p>
              <p className="bp-dim-hint">
                <ButtonGlyph device={device} button="confirm" />
                {t.now_playing_hint}
              </p>
            </div>
          )}
        </div>
      </InputLayerContext.Provider>
    </ModalShell>
  );
}
