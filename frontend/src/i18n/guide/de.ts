import type { Translations } from '../types';

// Benutzerhandbuch (/guide). Gleiche Struktur wie guide/en.ts, die Referenz-Locale.
export const guideDe: Translations['guide'] = {
  page_title: "Benutzerhandbuch",
  page_subtitle: "So funktioniert jeder Bereich von Metadea – von der ersten Suche über Spielen, Ansehen und Lesen bis zur Sicherung. Suche nach einem Thema oder wähle eines aus dem Inhaltsverzeichnis.",
  search_label: "Handbuch durchsuchen",
  search_placeholder: "Suche: Player, ROMs, AniList…",
  search_clear: "Suche löschen",
  results_count: "{count} von {total} Abschnitten",
  no_results_title: "Nichts gefunden",
  no_results_body: "Kein Abschnitt erwähnt „{query}“. Versuch es mit einem kürzeren oder anderen Wort.",
  toc_title: "Inhalt",
  steps_title: "So geht's",
  tips_title: "Tipps",
  shortcuts_title: "Tastenkürzel",
  open_settings: "Einstellungen › {tab} öffnen",
  open_settings_service: "Einstellungen › {tab} › {service} öffnen",
  open_page: "{page} öffnen",
  back_to_top: "Nach oben",
  nav_link: "Benutzerhandbuch",
  sheet_link: "Benutzerhandbuch öffnen",
  groups: {
    start: "Erste Schritte",
    discover: "Entdecken",
    library: "Deine Bibliothek",
    play: "Play",
    watch: "Ansehen, lesen & hören",
    integrations: "Integrationen",
    customize: "Anpassung",
    data: "Daten & Datenschutz",
  },
  keys: {
    next_page: "Nächste Seite",
    prev_page: "Vorherige Seite",
    next_chapter: "Nächstes Kapitel",
    prev_chapter: "Vorheriges Kapitel",
    font_size: "Text größer / kleiner",
    toc: "Inhaltsverzeichnis",
    fullscreen: "Vollbild",
    close_reader: "Reader schließen",
  },
  sections: {
    overview: {
      title: "Was Metadea ist",
      intro: "Metadea ist eine persönliche Bibliothek für alles, was du spielst, schaust und liest: Spiele, Anime, Manga, Light Novels, Visual Novels, Serien, Filme, Bücher und Comics. Sie liegt auf deinem Computer und funktioniert offline; das Internet wird nur zum Nachschlagen und zum Synchronisieren genutzt, wenn du es möchtest.",
      steps: {
        s1: "Finde ein Werk über die Suche (Strg+K) und öffne seine Seite.",
        s2: "Klicke auf das Cover, um es deiner Bibliothek hinzuzufügen und Status, Fortschritt, Daten und Bewertung festzulegen.",
        s3: "Verweise Play auf deine Ordner, Launcher und Emulatoren, um deine Spiele, Videos und Bücher direkt aus Metadea zu öffnen.",
        s4: "Verfolge deinen Fortschritt auf der Startseite und in deinem Profil: Statistiken, Favoriten, Listen und Verlauf.",
      },
      tips: {
        t1: "Deine Bibliothek ist eine Datenbank auf diesem Computer. Niemand sonst hat eine Kopie, also mach ab und zu eine Sicherung (Einstellungen › Sicherung).",
        t2: "Alles, was du in der Einführung einstellst, kannst du später in den Einstellungen ändern.",
      },
    },
    navigation: {
      title: "Sich zurechtfinden",
      intro: "Die obere Leiste ist immer da. Die Pfeile gehen zurück und vor, die Symbole links öffnen Start, Play und Durchsuchen, die Namen in der Mitte öffnen deine Bibliothek nach Typ gefiltert, und die Gruppe rechts enthält Suche, Benachrichtigungen, dein Profil und die Einstellungen.",
      steps: {
        s1: "Mit den Pfeilen ← und → ganz links oder mit Alt+← / Alt+→ bewegst du dich durch deinen Verlauf.",
        s2: "Klicke in der Mitte der Leiste auf einen Medientyp (Anime, Manga, Spiele…), um zu diesem Teil deiner Bibliothek zu springen.",
        s3: "Mit Strg+1 bis Strg+6 springst du direkt zu Start, Play, Profil, Durchsuchen, Benachrichtigungen oder Einstellungen.",
        s4: "Drücke auf jedem Bildschirm ?, um die Tastenkürzel zu sehen, die dort funktionieren.",
      },
      tips: {
        t1: "Auf „Durchsuchen“ und in Play wird die Mitte der Leiste zu den Tabs der jeweiligen Seite.",
        t2: "Auf dem Mac entspricht Strg in diesen Kürzeln ⌘.",
      },
    },
    account: {
      title: "Dein Konto",
      intro: "Beim ersten Start von Metadea wählst du nur einen Benutzernamen: Die Sitzung ist lokal und nichts wird hochgeladen. Später kannst du sie mit Google verknüpfen, um ein öffentliches Profil zu haben und die Aktivität deiner Freunde zu sehen.",
      steps: {
        s1: "Um eine lokale Sitzung zu verknüpfen, nutze „Mit Google verknüpfen“ auf der Startseite.",
        s2: "Mit einem verknüpften Konto fragt die Startseite einmal am Tag, ob dein Profil synchronisiert werden soll; hochgeladen wird es erst, wenn du auf „Synchronisieren“ drückst.",
        s3: "„Abmelden“ findest du ganz unten unter Einstellungen › Erscheinungsbild.",
      },
      tips: {
        t1: "Beim Abmelden wird nur die Sitzung vergessen: Deine Bibliothek bleibt auf diesem Computer.",
        t2: "„Nicht jetzt“ blendet die Synchronisierungsfrage bis zu deinem nächsten Besuch der Startseite aus.",
      },
    },
    home: {
      title: "Startseite",
      intro: "Die Startseite ist deine tägliche Übersicht: was du gerade schaust, liest oder spielst, was diesen Monat erscheint und was deine Freunde machen.",
      steps: {
        s1: "Der erste Block zeigt, was du gerade schaust, liest oder spielst, nach Typ gruppiert. Mit + und − auf einem Cover zählst du eine Folge oder ein Kapitel hoch oder runter, ohne das Werk zu öffnen.",
        s2: "Der Kalender zeigt die Veröffentlichungen des Monats. „Für dich“ enthält nur Werke aus deiner Bibliothek, „Allgemein“ alles. Filtere nach Typ und wechsle mit den Pfeilen zwischen den Monaten.",
        s3: "Die rechte Spalte beginnt mit „An diesem Tag“: Werke, die du in früheren Jahren am heutigen Datum abgeschlossen hast.",
        s4: "Darunter wechselt der Aktivitäts-Feed zwischen „Freunde“ und „Allgemein“.",
        s5: "Die schmale Spalte ganz rechts zeigt „Heute neu“ (Folgen aus deiner Bibliothek, die heute erscheinen) und „Weiterschauen“: das Letzte, was du in Play abgespielt hast, mit der verbleibenden Zeit. Ein Klick setzt genau dort fort, wo du aufgehört hast.",
      },
      tips: {
        t1: "Blöcke ohne Inhalt bleiben ausgeblendet, eine neue Bibliothek wirkt deshalb anfangs fast leer.",
        t2: "Ein paar Sekunden nach dem Start lädt Metadea die neuesten Community-Daten herunter, sucht nach Updates und gibt dir mit einem Hinweis Bescheid.",
        t3: "Wenn du etwas erneut ansiehst, ändert sich das Datum, an dem es unter „An diesem Tag“ erscheint, nicht.",
      },
    },
    search: {
      title: "Suche und Schnellsuche",
      intro: "Es gibt zwei Wege zu suchen: die Schnellsuche, die über jedem Bildschirm schwebt, und die Seite „Durchsuchen“ mit einem Tab pro Medientyp. Ergebnisse aus deinem eigenen Katalog erscheinen zuerst, Online-Quellen kommen hinzu, sobald sie antworten.",
      steps: {
        s1: "Drücke Strg+K oder / (oder das Kompass-Symbol rechts in der oberen Leiste) und tippe mindestens zwei Buchstaben.",
        s2: "Die Schnellsuche durchsucht alle Typen gleichzeitig: Werke, Charaktere, Mitwirkende und Benutzer, bis zu sechs pro Gruppe. Bewege dich mit ↑ und ↓, öffne mit Enter oder nutze „Alle anzeigen“.",
        s3: "Wähle auf „Durchsuchen“ einen Tab, um einen einzelnen Typ zu durchsuchen. Jeder Typ hat seine Quelle: AniList für Anime, Manga und Light Novels; IGDB für Spiele und Visual Novels; TMDB für Filme und Serien; Open Library für Bücher; Comic Vine für Comics.",
        s4: "Öffne ein Ergebnis, um seine Seite zu sehen und es deiner Bibliothek hinzuzufügen.",
      },
      tips: {
        t1: "IGDB, TMDB und Comic Vine brauchen deine eigenen, kostenlosen Schlüssel. Ohne sie zeigt „Durchsuchen“ einen Hinweis mit einer Schaltfläche, die dich zur richtigen Stelle unter Einstellungen › Umgebung bringt.",
        t2: "Wenn eine Quelle ausfällt oder du offline bist, siehst du trotzdem, was schon in deinem lokalen Katalog ist.",
        t3: "Drücke auf „Durchsuchen“ Strg+F, um zum Suchfeld zu springen.",
      },
    },
    media_page: {
      title: "Die Seite eines Werks",
      intro: "Jedes Werk hat eine Seite mit Cover, Daten, deinem Fortschritt und mehreren Tabs mit verwandten Inhalten. Fast alles lässt sich per Tastatur erledigen.",
      steps: {
        s1: "Klicke auf das Cover (oder drücke E), um das Werk deiner Bibliothek hinzuzufügen oder deinen Eintrag zu bearbeiten.",
        s2: "Mit + oder − änderst du deinen Fortschritt, mit 1–9 bewertest du (0 steht für 10), und mit F markierst du es als Favorit.",
        s3: "Die Tabs darunter zeigen verwandte Werke, Editionen, Empfehlungen, Staffeln, Folgen und Opening-/Ending-Themes.",
        s4: "Der Bereich „Nutzer“ zeigt die Bewertungen der AniList-Freunde, denen du folgst, wenn du verbunden bist.",
        s5: "Die Link-Schaltfläche (oder L) kopiert einen Link, der diese Seite in Metadea öffnet.",
      },
      tips: {
        t1: "Spiele, die eine Edition eines anderen Spiels sind, führen dich zum Hauptspiel und weisen im Banner darauf hin.",
        t2: "Deine eigenen Screenshots eines Spiels oder einer Folge erscheinen im Bereich „Screenshots“.",
      },
    },
    editor: {
      title: "Deinen Eintrag bearbeiten",
      intro: "Im Editor steht alles über deine Beziehung zu einem Werk: Status, Fortschritt, Daten, Bewertung, Notizen und mehr. Er öffnet sich per Klick auf das Cover oder mit E.",
      steps: {
        s1: "Wähle einen Status über die Symbole: ausstehend, in Bearbeitung, abgeschlossen, pausiert oder abgebrochen.",
        s2: "Trage deinen Fortschritt ein. Spiele und Visual Novels zählen Stunden (H:MM), alles andere Folgen, Kapitel oder Bände. Erreichst du die Gesamtzahl, wird das Werk als abgeschlossen markiert.",
        s3: "Füge eine Bewertung, Start- und Enddatum (bei Filmen das Datum, an dem du ihn gesehen hast), bis zu fünf Tags und persönliche Notizen hinzu.",
        s4: "Markiere es als Favorit oder, bei Spielen, die du zu 100 % abgeschlossen hast, als „Platin“.",
        s5: "Wähle unter „Monatsverlauf“ den Monat, für den dieses Werk steht; jeder Monat hat ein Werk.",
        s6: "Speichere mit Strg+S. Strg+Z und Strg+Y machen rückgängig und wiederholen.",
      },
      tips: {
        t1: "„Daten aus deinem AniList-Profil übernehmen“ füllt deinen Fortschritt und deine Daten aus AniList aus.",
        t2: "Nach dem Abschluss erstellt „Teilen“ ein Hochformatbild mit dem Cover, deiner Bewertung und deinem Avatar.",
        t3: "Deine Notizen werden zu Rezensionen im Tab „Rezensionen“ deines Profils.",
      },
    },
    rewatch: {
      title: "Erneut ansehen, lesen und spielen",
      intro: "Wenn du zu etwas zurückkehrst, das du schon abgeschlossen hattest, zählt Metadea die Wiederholung, ohne deine ursprünglichen Daten zu verlieren.",
      steps: {
        s1: "Öffne den Editor eines abgeschlossenen Werks und drücke die Wiederholen-Schaltfläche („Erneut ansehen“, „Erneut lesen“ oder „Erneut spielen“).",
        s2: "Der Fortschritt springt auf null und der Status auf „In Bearbeitung“; die Daten des ersten Durchgangs bleiben erhalten.",
        s3: "Wenn du es erneut abschließt, steigt der Zähler „Wiederholungen“ um eins.",
      },
      tips: {
        t1: "Drückst du die Schaltfläche vor dem Abschluss noch einmal, wird die Wiederholung abgebrochen, ohne dass sie gezählt wird.",
        t2: "Bibliothekskarten zeigen ×2, ×3… und die Statistiken zählen die Stunden jedes Durchgangs.",
      },
    },
    sagas: {
      title: "Sagas, Staffeln und Beziehungen",
      intro: "Werke, die zusammengehören – Fortsetzungen, Vorgeschichten, Spin-offs, Staffeln –, sind miteinander verknüpft. So siehst du ein ganzes Franchise und wie viel davon du schon abgeschlossen hast.",
      steps: {
        s1: "Drücke auf der Seite eines Werks „Reihenfolge der Saga“, um das ganze Franchise in Reihenfolge zu sehen. „Du bist hier“ markiert das aktuelle Werk, und der Tab „Handlungsbögen“ teilt lange Serien in Arcs auf.",
        s2: "Der Saga-Fortschrittsbalken zeigt, wie viele Werke der Saga du abgeschlossen hast; noch nicht erschienene Werke zählen nicht.",
        s3: "Der Tab „Ähnliche Werke“ listet jede Beziehung mit ihrer Art auf (Fortsetzung, Adaption, Spin-off…).",
      },
      tips: {
        t1: "Mit aktivierter Option „Staffeln vereinheitlichen“ (Einstellungen › Einstellungen) werden Anime-Staffeln zu einer Bibliothekskarte zusammengefasst, und die Seite zeigt stattdessen einen Tab „Staffeln“.",
        t2: "Der Saga-Balken erscheint erst, wenn du mindestens einen Teil der Saga abgeschlossen hast.",
      },
    },
    characters: {
      title: "Charaktere und Mitwirkende",
      intro: "Charaktere und Mitwirkende haben eigene Seiten, die du über die Besetzung eines Werks oder über die Suche erreichst.",
      steps: {
        s1: "Eine Charakterseite zeigt die Biografie, die Werke, in denen der Charakter vorkommt, und die Synchronsprecher.",
        s2: "Markiere einen Charakter als Favorit, um ihn zu den Lieblingscharakteren in deinem Profil hinzuzufügen.",
        s3: "Die Seite einer Person listet ihre Werke und Daten auf.",
      },
      tips: {
        t1: "Die Schnellsuche findet auch Charaktere und Mitwirkende: Tippe den Namen und sieh in den jeweiligen Gruppen nach.",
      },
    },
    community: {
      title: "Community-Katalog und Vorschläge",
      intro: "Metadea teilt einen Community-Katalog: Daten, die von Nutzern ergänzt und korrigiert und auf GitHub geprüft werden. Deine Kopie wird bei jedem Start aktualisiert, und du kannst auf der Seite jedes Werks Änderungen vorschlagen.",
      steps: {
        s1: "Verbinde GitHub unter Einstellungen › Verbindungen.",
        s2: "Drücke auf der Seite eines Werks die Schaltfläche + im Banner (oder P), um den Vorschlagseditor zu öffnen.",
        s3: "Ändere Titel, Zusammenfassung, Daten, Anzahlen, Links, Bilder, Genres, Plattformen, Charaktere, Beziehungen, Folgen, Themes, Handlungsbögen oder die Saga-Reihenfolge. Du kannst mehrere Werke in derselben Sitzung bearbeiten.",
        s4: "Drücke „Vorschlag einreichen“: Daraus wird ein Pull Request, der geprüft wird, bevor er alle erreicht.",
      },
      tips: {
        t1: "Einstellungen › Neuigkeiten › „Jetzt synchronisieren“ lädt den Katalog bei Bedarf herunter.",
        t2: "Einstellungen › Admin › Katalog-Editor zeigt deinen lokalen Katalog; um den gemeinsamen zu bearbeiten, brauchst du Schreibzugriff auf das Repository.",
      },
    },
    statuses: {
      title: "Deine Bibliothek: Status und Fortschritt",
      intro: "Deine Bibliothek in deinem Profil gruppiert jeden Typ nach Status, damit du auf einen Blick siehst, was aussteht, was läuft und was erledigt ist.",
      steps: {
        s1: "Öffne einen Typ über die obere Leiste oder über den Tab „Bibliothek“ deines Profils.",
        s2: "Abschnitte: Ausstehend, In Bearbeitung, Laufend (in Bearbeitung und erscheint noch), Abgeschlossen, Pausiert und Abgebrochen.",
        s3: "Filtere nach Name, Format, Status oder Datum, sortiere nach Bewertung, Datum oder Dauer und gruppiere nach Saga oder Bundle.",
        s4: "Drücke Strg+F, um innerhalb der Bibliothek zu suchen.",
      },
      tips: {
        t1: "Die Schaltflächen + und − auf der Startseite und die Tasten +/− auf der Seite eines Werks ändern den Fortschritt, ohne den Editor zu öffnen.",
      },
    },
    ratings: {
      title: "Bewertungen",
      intro: "Wähle, wie du bewerten möchtest: 5 Sterne, eine 10 mit zwei Nachkommastellen, eine ganze 10 oder drei Gesichter. Du kannst sogar zwei Bewertungen gleichzeitig führen.",
      steps: {
        s1: "Wähle unter Einstellungen › Einstellungen › Bewertungssystem die gewünschte Skala.",
        s2: "Aktiviere „Doppelte Bewertung“, um eine zweite Bewertung mit eigenem Namen und eigener Skala zu führen (zum Beispiel Handlung und Optik).",
        s3: "Bewerte im Editor oder drücke auf der Seite eines Werks 1–9 (0 = 10).",
      },
      tips: {
        t1: "Mit doppelter Bewertung wählt ein Umschalter in der Bibliothek, welche der beiden Bewertungen angezeigt wird.",
        t2: "Beim Synchronisieren mit AniList wird deine Bewertung in die Skala deines AniList-Kontos umgerechnet.",
        t3: "„Bewertungen löschen“ unter Einstellungen › Einstellungen löscht nach einer Rückfrage alle Bewertungen.",
      },
    },
    favorites_lists: {
      title: "Favoriten, Ruhmeshalle und Listen",
      intro: "Mit Favoriten und Listen zeigst du, was dir am wichtigsten ist – in der Reihenfolge, die du wählst.",
      steps: {
        s1: "Markiere Werke und Charaktere als Favoriten; die Kronen-Schaltfläche fügt ein Werk außerdem zu den allgemeinen Favoriten unter „Multimedia“ hinzu.",
        s2: "Im Tab „Favoriten“ sortierst du per Ziehen um und kannst jedem Favoriten ein eigenes Bild geben.",
        s3: "Deine Top 10 der Werke und der Charaktere bilden die Ruhmeshalle in deinem Profil.",
        s4: "Erstelle unter „Listen“ Listen mit Werken, Charakteren oder Folgen; mach sie privat oder zu einem Ranking und sortiere sie von Hand, alphabetisch oder nach Erscheinungsdatum.",
      },
      tips: {
        t1: "Listen lassen sich per Ziehen umsortieren.",
      },
    },
    tier_lists: {
      title: "Tier Lists",
      intro: "Ordne Werke oder Charaktere im TierMaker-Stil ein: Zeilen von S bis F, die du umbenennen, umfärben, hinzufügen, entfernen und umsortieren kannst.",
      steps: {
        s1: "Öffne Tier list in der Navigationsleiste und erstelle eine Liste mit Werken oder Charakteren.",
        s2: "Fülle die Ablage aus deiner Bibliothek (Filter oder Schnellfüllungen wie „alles Abgeschlossene aus 2024“), deinen Listen und Sagas, deinen Charakteren oder einer Suche.",
        s3: "Zieh Cover in die Zeilen oder wähle mehrere aus und drücke 1–9. Ein Doppelklick legt ein Cover zurück in die Ablage.",
      },
      tips: {
        t1: "Jede Änderung wird automatisch gespeichert, Strg+Z macht sie rückgängig. „Als Bild speichern“ exportiert das Board als PNG, „In meinem Profil zeigen“ listet es im Tab Listen deines Profils.",
      },
    },
    stats: {
      title: "Statistiken und Verlauf",
      intro: "Der Tab „Statistiken“ in deinem Profil macht aus deiner Bibliothek Zahlen: wie viel du abgeschlossen hast, wie viele Stunden, welche Genres und wie du bewertest.",
      steps: {
        s1: "Die Karten oben fassen Werke, Staffeln, Gesamtstunden, Durchschnittsbewertung und bewertete Werke zusammen.",
        s2: "Darunter findest du die Aufteilung nach Status, die Zeit nach Kategorie, Lieblingsgenres, die Verteilung der Bewertungen, Abschlüsse pro Jahr und eine Aktivitätskarte der letzten sechs Monate.",
        s3: "Der Backlog-Rechner schätzt, wie lange du bräuchtest, um alles Ausstehende abzuschließen – mit oder ohne das, was du gerade in Bearbeitung hast.",
        s4: "Der Tab „Profil“ zeigt deinen Monatsverlauf (ein Cover pro Monat) und deine letzten Aktivitäten.",
      },
      tips: {
        t1: "Wiederholungen zählen mit: Eine zweimal gesehene Serie zählt ihre Stunden doppelt.",
      },
    },
    social: {
      title: "Freunde und Benachrichtigungen",
      intro: "Mit einem verknüpften Konto kannst du anderen folgen, ihre Aktivität sehen und ihre Profile besuchen. Erinnerungen an Veröffentlichungen kommen als Systembenachrichtigungen.",
      steps: {
        s1: "Im Tab „Freunde“ deines Profils siehst du, wem du folgst und wer dir folgt.",
        s2: "Öffne das Profil einer Person, um ihre Bibliothek schreibgeschützt anzusehen und ihr zu folgen.",
        s3: "Der Aktivitäts-Feed auf der Startseite zeigt, was deine Freunde gerade machen.",
      },
      tips: {
        t1: "Metadea sendet Systembenachrichtigungen für heutige Veröffentlichungen von Werken, die du dir vorgemerkt hast, für laufende Anime, denen du folgst, und für neue Folgen oder Kapitel von dem, was du gerade schaust oder liest.",
        t2: "Die Seite „Benachrichtigungen“ ist noch im Aufbau.",
      },
    },
    local_folders: {
      title: "Lokale Ordner",
      intro: "Play findet deine Dateien, indem es in einem Ordner pro Medientyp sucht. Metadea ordnet jede Datei oder jeden Unterordner einem Werk in deinem Katalog zu.",
      steps: {
        s1: "Wähle unter Einstellungen › Umgebung › Lokale Pfade einen Ordner für jeden Typ (Anime, Serien, Filme, Manga, Comics, Bücher…).",
        s2: "Für Spiele kannst du auch „Ordner hinzufügen“ im Kopfbereich von Play nutzen; jeder Unterordner zählt als ein Spiel.",
        s3: "Öffne Play: Zugeordnete Dateien erscheinen mit dem Cover und den Daten des Werks.",
        s4: "Wird etwas nicht erkannt, nutze „Manuell lokalisieren“ und danach „Für automatische Erkennung umbenennen“, damit es beim nächsten Mal von selbst gefunden wird.",
      },
      tips: {
        t1: "Die Zuordnung ignoriert Akzente und Satzzeichen und berücksichtigt Staffelnummern in Namen.",
        t2: "Unterstützte Dateien sind unter anderem mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz und cbr.",
        t3: "Drücke in Play Strg+F, um deine lokale Bibliothek zu durchsuchen.",
      },
    },
    pc_launchers: {
      title: "PC-Spiele: Steam, Epic, GOG, Xbox und EA",
      intro: "Play erkennt die Spiele, die du über die wichtigsten PC-Launcher installiert hast – ganz ohne Einrichtung.",
      steps: {
        s1: "Öffne Play › Spiele: Beim ersten Besuch werden Steam, Epic Games, GOG, die Xbox-App und EA gescannt.",
        s2: "Spätere Besuche scannen nur die Launcher erneut, die sich geändert haben; „Erneut scannen“ erzwingt einen vollständigen Scan.",
        s3: "Trage unter Einstellungen › Umgebung deinen Steam-Web-API-Schlüssel ein, um außerdem Spielzeit, zuletzt gespielt und nicht installierte Spiele aus deinem Besitz zu erhalten.",
      },
      tips: {
        t1: "Erscheinen die Spiele eines Launchers nicht, zeigt „Diagnose“, was Metadea gefunden hat.",
      },
    },
    roms: {
      title: "Emulatoren und ROMs",
      intro: "Metadea kann deine Retro-Sammlung verwalten: Es liest deine ROM-Ordner, bereinigt die Namen, erkennt jedes Spiel und öffnet es mit dem passenden Emulator.",
      steps: {
        s1: "Wähle unter Einstellungen › Emulatoren einen Hersteller und eine Konsole.",
        s2: "Wähle den Emulator und seine Programmdatei, die Startparameter ({ROM} wird durch die Datei ersetzt) und deinen ROM-Ordner.",
        s3: "Öffne Play › Spiele: Deine ROMs erscheinen mit bereinigten Namen und IGDB-Daten.",
      },
      tips: {
        t1: "„ROM-Dateinamen automatisch bereinigen“ benennt Dateien in ein ordentliches Format um (und ihre Spielstände gleich mit). Ein Hinweis erlaubt dir einige Sekunden lang, das rückgängig zu machen.",
        t2: "GameCube-, Wii-, DS- und 3DS-ROMs werden an der ID in ihrem Header erkannt; Switch-Updates und DLCs werden unter dem Basisspiel gruppiert.",
        t3: "Wurde ein ROM dem falschen Spiel zugeordnet, nutze den Stift („Spiel in IGDB ändern“) in seinem Detailbereich.",
      },
    },
    metadata: {
      title: "Metadaten abrufen",
      intro: "Die Schaltfläche „Metadaten“ in Play lädt Cover, Banner und Informationen für deine Spiele in einem Rutsch herunter.",
      steps: {
        s1: "Öffne Play › Spiele und drücke „Metadaten“ unten in der Plattformliste.",
        s2: "Wähle „Basis“ (Cover, Banner, Genres, Zusammenfassung, Datum, Publisher), „Steam-Erfolge“ oder beides.",
        s3: "Verfolge den Fortschritt im Fenster; du kannst jederzeit abbrechen.",
      },
      tips: {
        t1: "Das gilt für Steam-, GOG- und ROM-Spiele. Steam-Erfolge brauchen deinen Steam-Web-API-Schlüssel.",
        t2: "Spieldaten kommen von IGDB, deshalb müssen dessen Schlüssel unter Einstellungen › Umgebung eingetragen sein.",
      },
    },
    achievements: {
      title: "Erfolge",
      intro: "Der Detailbereich eines Spiels in Play hat einen Erfolge-Tab: Steam-Erfolge für Steam-Spiele und RetroAchievements für deine ROMs.",
      steps: {
        s1: "Für Steam trägst du deinen Steam-Web-API-Schlüssel ein und startest „Metadaten“ › „Steam-Erfolge“.",
        s2: "Für ROMs trägst du unter Einstellungen › Umgebung deinen RetroAchievements-Benutzer und Web-API-Schlüssel ein.",
        s3: "Öffne ein ROM in Play: Metadea verknüpft es über den Hash der Datei mit seinem RetroAchievements-Set oder, wenn das scheitert, über den Titel.",
        s4: "Wählt es das falsche Set, nutze „Manuell verknüpfen“ oder „Verknüpfung lösen“.",
      },
      tips: {
        t1: "Erfolge werden zwischengespeichert, du siehst sie also auch offline.",
        t2: "Nach einer Spielsitzung sagt dir ein Hinweis, wie viele Erfolge du freigeschaltet hast.",
        t3: "Konsolen ohne RetroAchievements-Sets (3DS, Wii, Wii U, Switch, PC…) zeigen den Bereich nicht an.",
      },
    },
    screenshots: {
      title: "Screenshots",
      intro: "Der Bereich „Screenshots“ eines Werks sammelt seine Aufnahmen aus Bilder › Metadea › <Werk> und bei Steam-Spielen deine Steam-Screenshots.",
      steps: {
        s1: "Drücke im integrierten Player F12, um ein Bild zu speichern. Es landet unter Bilder › Metadea › <Werk>, benannt nach Folge und Zeitpunkt.",
        s2: "Klicke im Comic-Reader mit der rechten Maustaste auf eine Seite und wähle „Seite speichern (PNG)“.",
        s3: "Bei Emulatoren machst du Screenshots wie gewohnt: Solange ein aus Metadea gestartetes Spiel läuft, wird jede Aufnahme nach Bilder › Metadea › <Spiel> verschoben, und ein Hinweis bestätigt es.",
      },
      tips: {
        t1: "Der Aufnahmeordner des Emulators wird für Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu, PPSSPP, Cemu und RPCS3 erkannt; für andere Emulatoren legst du ihn unter Einstellungen › Emulatoren (erweitert) fest.",
        t2: "Aufnahmen eines Spiels, die schon im Ordner des Emulators lagen, werden beim ersten Öffnen des Spiels dorthin verschoben.",
      },
    },
    launching: {
      title: "Spiele starten und Spielzeit",
      intro: "Die Schaltfläche „Spielen“ startet jedes Spiel deiner lokalen Bibliothek, und Metadea zählt die Zeit, die du spielst.",
      steps: {
        s1: "Öffne ein Spiel in Play und drücke „Spielen“.",
        s2: "Steam-, Epic- und GOG-Spiele öffnen sich über ihren Launcher; ROMs mit dem Emulator, der für ihre Konsole eingestellt ist.",
        s3: "Metadea beobachtet den Prozess des Spiels und rechnet jede Sitzung zu deinen Stunden in der Bibliothek hinzu.",
      },
      tips: {
        t1: "Sitzungen unter 15 Sekunden werden nicht gezählt.",
        t2: "Ist die Schaltfläche eines ROMs deaktiviert, hat seine Konsole noch keinen Emulator (Einstellungen › Emulatoren).",
        t3: "Während du spielst, zeigt Discord das Spiel an (bei ROMs auch deinen RetroAchievements-Fortschritt).",
      },
    },
    player: {
      title: "Der Videoplayer",
      intro: "Lokale Folgen und Filme laufen im integrierten Player von Metadea (libmpv), der sich deinen Fortschritt von selbst merkt.",
      steps: {
        s1: "Nichts zu installieren: Der Player (libmpv) wird mit Metadea mitgeliefert.",
        s2: "Wähle die Steuerung: über dem Video eingeblendet oder in einer festen Leiste unter dem Video.",
        s3: "Drücke in Play bei einer Folge auf „Abspielen“. Der Rest der Staffel wird in die Warteschlange gestellt; mit Q siehst du die Warteschlange.",
        s4: "Über die Menüs wechselst du Tonspur, Untertitel und Geschwindigkeit (0,5× bis 2×).",
        s5: "Bei 80 % wird die Folge als gesehen markiert: Status, Fortschritt und AniList werden aktualisiert. Ein Hinweis erlaubt dir, das rückgängig zu machen.",
        s6: "Schließt du vor 80 %, setzt das nächste „Abspielen“ auf die Sekunde genau fort.",
      },
      tips: {
        t1: "Ein Klick auf das Video pausiert, ein Doppelklick schaltet auf Vollbild.",
        t2: "Kann libmpv nicht geladen werden, sagt Metadea dir Bescheid, statt das Video zu öffnen.",
        t3: "Mit der letzten Folge wird das Werk abgeschlossen und seine Fortsetzung zu deinen ausstehenden Werken hinzugefügt.",
        t4: "Discord zeigt, was du schaust, mit einem Countdown der verbleibenden Zeit.",
      },
    },
    player_shortcuts: {
      title: "Player-Tastenkürzel",
      intro: "Im integrierten Player lässt sich alles per Tastatur erledigen. Drücke ?, während er offen ist, um diese Liste zu sehen.",
      steps: {
        s1: "Leertaste pausiert; die Pfeiltasten spulen 5 s (30 s mit Umschalt) und ändern die Lautstärke.",
        s2: "N und P (oder Strg+→ und Strg+←) springen zur nächsten oder vorherigen Folge.",
        s3: ", und . gehen Bild für Bild; [ und ] ändern die Geschwindigkeit.",
        s4: "Die Zifferntasten springen zu 10 %, 20 %… des Videos.",
      },
      tips: {
        t1: "Esc schließt in dieser Reihenfolge: offene Menüs, Vollbild, dann den Player.",
      },
    },
    skip_segments: {
      title: "Openings und Endings überspringen",
      intro: "Der integrierte Player erkennt Openings, Endings, Rückblicke und Vorschauen, damit du sie überspringen kannst.",
      steps: {
        s1: "Wähle unter Einstellungen › Einstellungen › Videoplayer, wie: eine Schaltfläche anzeigen, automatisch überspringen oder nicht erkennen.",
        s2: "Mit der Schaltfläche drückst du sie (oder S), sobald sie erscheint.",
        s3: "Im automatischen Modus sagt dir ein Hinweis, was übersprungen wurde, und bietet „Rückgängig“ an.",
      },
      tips: {
        t1: "Die Abschnitte stammen aus den Kapiteln der Datei (MKV) und bei Anime von AniSkip; gibt es beides, haben die Kapitel Vorrang.",
      },
    },
    reader_comics: {
      title: "Comics und Manga lesen",
      intro: "CBZ-, CBR- und PDF-Dateien öffnen sich im Reader von Metadea, der sich die Seite merkt, auf der du bist.",
      steps: {
        s1: "Öffne die Datei aus Play.",
        s2: "Blättere mit den Pfeiltasten, der Leertaste oder per Klick auf die linke oder rechte Seitenhälfte. Doppelseiten werden nebeneinander angezeigt, das Cover allein.",
        s3: "Klicke mit der rechten Maustaste auf eine Seite, um ein Lesezeichen zu setzen, deine Lesezeichen anzusehen oder die Seite als Bild zu speichern.",
        s4: "Auf der letzten Seite wird die Datei als gelesen markiert und deine Bibliothek aktualisiert.",
      },
      tips: {
        t1: "Deine Seite wird bei jedem Umblättern gespeichert.",
        t2: "„Auf Standby setzen“ schließt den Reader, behält die Sitzung aber in einer Leiste, damit du später weitermachen kannst.",
      },
    },
    reader_epub: {
      title: "EPUB-Bücher lesen",
      intro: "EPUB-Bücher haben einen eigenen Reader mit Typografie-Einstellungen, Inhaltsverzeichnis, Lesezeichen und Fortschritt.",
      steps: {
        s1: "Öffne das Buch aus Play.",
        s2: "Wähle unter „Typografie“ Schrift, Größe, Zeilenabstand, Ränder, Farbthema (Papier, Sepia, Dunkel, Schwarz) und Blocksatz.",
        s3: "Wähle den Modus „Seiten“ oder „Scrollen“.",
        s4: "Drücke T für das Inhaltsverzeichnis und nutze „Lesezeichen hier setzen“, um eine Stelle zu markieren.",
        s5: "Der Prozentwert zeigt, wie weit du bist; bei 98 % gilt das Buch als gelesen.",
      },
      tips: {
        t1: "„Verlagsstile verwenden“ übernimmt das eigene Design des Buchs.",
        t2: "Wenn du fertig bist, wird der Fortschritt mit deiner Bibliothek und AniList synchronisiert.",
      },
    },
    themes_jukebox: {
      title: "Openings, Endings und die Jukebox",
      intro: "Anime-Seiten enthalten ihre Opening- und Ending-Themes. Markiere die, die dir gefallen, mit einem Stern, und sie laufen in der Jukebox auf jedem Bildschirm.",
      steps: {
        s1: "Öffne ein Theme im Tab „Titelmusik“ eines Werks (oder drücke T). Wechsle zwischen Versionen (v1, v2…) und springe zum vorherigen oder nächsten.",
        s2: "Drücke den Stern („Zur Jukebox hinzufügen“), um es zu speichern.",
        s3: "Öffne die Jukebox mit der runden Schaltfläche unten rechts: Die sich drehende Scheibe zeigt das Cover und pausiert per Klick.",
        s4: "Nutze Zurück/Weiter, die Fortschrittsleiste, Lautstärke, Zufallswiedergabe und Wiederholen (aus, Warteschlange oder dieses Theme).",
      },
      tips: {
        t1: "Die Jukebox pausiert von selbst, wenn sich der Player öffnet, ein lokales Video startet, auf der Seite eines Werks ein Theme geöffnet wird oder anderer Ton abgespielt wird.",
        t2: "Die Medientasten deiner Tastatur steuern sie, und sie merkt sich Lautstärke, Zufallswiedergabe, Wiederholen und das letzte Theme.",
        t3: "Die Theme-Videos kommen von animethemes.moe und brauchen daher eine Verbindung.",
      },
    },
    api_keys: {
      title: "API-Schlüssel: welcher wofür ist",
      intro: "Manche Quellen brauchen einen kostenlosen Schlüssel, den du in deinem eigenen Konto erstellst. Alle sind optional: Richte nur die für das ein, was du nutzt.",
      steps: {
        s1: "Öffne Einstellungen › Umgebung und klicke auf das Logo eines Dienstes.",
        s2: "Drücke die Schaltfläche (i), um zu sehen, wie du den Schlüssel bekommst, füge ihn ein und drücke „Speichern“.",
        s3: "IGDB: Spiele und Visual Novels sowie die Daten deiner ROMs. TMDB: Filme und Serien. Comic Vine: Comics. Steam: Spielzeit und Erfolge.",
        s4: "AniList und MyAnimeList: eine Client-ID, um dein Konto zu verbinden (die AniList-Suche funktioniert auch ohne). RetroAchievements: Benutzer und Web-API-Schlüssel.",
      },
      tips: {
        t1: "Unter Windows werden die Schlüssel verschlüsselt in der Datenbank von Metadea gespeichert.",
        t2: "API-Sports ist für Sportereignisse gedacht, ein Typ, der derzeit deaktiviert ist.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Verbinde AniList, um deine Anime- und Manga-Liste zu importieren und synchron zu halten: Jede Änderung, die du in Metadea speicherst, wird an AniList gesendet.",
      steps: {
        s1: "Erstelle eine App auf AniList und füge ihre Client-ID unter Einstellungen › Umgebung › AniList ein.",
        s2: "Drücke unter Einstellungen › Verbindungen auf „Verbinden“, autorisiere Metadea im Browser und füge den Code ein, den du erhältst.",
        s3: "Drücke „Importieren“ und wähle die Formate (TV, Filme, OVA, Manga, Light Novels…).",
        s4: "„Importieren“ fügt nur hinzu, was du noch nicht hast; „Synchronisieren“ aktualisiert außerdem das Vorhandene mit den Daten von AniList.",
      },
      tips: {
        t1: "Speichern im Editor, im Player, im Reader oder auf der Startseite sendet die Änderung automatisch an AniList.",
        t2: "AniList erlaubt 60 Anfragen pro Minute; erreichst du das Limit, wartet Metadea und sagt dir Bescheid.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList verbindet sich über eine Anmeldung im Browser und erhält deine Änderungen an Anime, Manga und Light Novels im Hintergrund.",
      steps: {
        s1: "Erstelle auf MyAnimeList eine API-App mit metadea://auth/mal als Weiterleitungs-URL und füge ihre Client-ID unter Einstellungen › Umgebung › MyAnimeList ein (kein Secret nötig).",
        s2: "Drücke unter Einstellungen › Verbindungen auf „Verbinden“: Der Browser öffnet sich und bringt dich zurück zu Metadea.",
        s3: "Kommt der Browser nicht zurück, füge die Adresse metadea://auth/mal?code=… in das Feld ein und drücke „Verbindung abschließen“.",
        s4: "„Importieren“ holt deine MAL-Liste und gleicht sie mit AniList ab; alles ohne Entsprechung wird separat aufgelistet.",
      },
      tips: {
        t1: "Änderungen werden bei jedem Speichern an MAL gesendet, genau wie bei AniList. Werke ohne MAL-ID werden übersprungen.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea zeigt deinen RetroAchievements-Fortschritt neben deinen ROMs an. Es zeigt ihn nur an: Erfolge werden beim Spielen in einem Emulator mit aktivierten RetroAchievements freigeschaltet.",
      steps: {
        s1: "Öffne auf retroachievements.org deine Einstellungen und kopiere deinen Web-API-Schlüssel.",
        s2: "Gib unter Einstellungen › Umgebung › RetroAchievements deinen Benutzernamen und den Schlüssel ein und speichere.",
        s3: "Aktiviere RetroAchievements in deinem Emulator mit demselben Konto.",
        s4: "Öffne ein ROM in Play, um sein Set, deinen Fortschritt und jeden einzelnen Erfolg zu sehen.",
      },
      tips: {
        t1: "Spiele werden wie bei den Emulatoren am Hash des ROMs erkannt, ein sauberer Dump passt deshalb am besten.",
        t2: "Ohne Verbindung siehst du die zuletzt zwischengespeicherten Daten.",
      },
    },
    discord: {
      title: "Discord",
      intro: "Wenn Discord geöffnet ist, zeigt dein Profil, was du in Metadea machst: spielen, schauen, ein Theme hören, lesen oder ein Werk ansehen.",
      steps: {
        s1: "Öffne Discord auf diesem Computer; Metadea findet es von selbst, auch wenn du es erst später öffnest.",
        s2: "Starte ein Spiel, ein Video oder ein Theme oder öffne ein Buch oder die Seite eines Werks: Dein Status passt sich an.",
        s3: "Werke, die du ansiehst, enthalten eine Schaltfläche „In Metadea öffnen“, damit deine Freunde sie auch öffnen können.",
      },
      tips: {
        t1: "In Metadea gibt es keinen Schalter dafür: Um es auszublenden, schließe Discord oder deaktiviere das Teilen von Aktivitäten in den Einstellungen von Discord.",
        t2: "Bei Videos werden die Folge und ein Countdown der verbleibenden Zeit angezeigt; Spiele aus Emulatoren zeigen zusätzlich deinen RetroAchievements-Fortschritt.",
      },
    },
    deep_links: {
      title: "Links und Teilen",
      intro: "Metadea-Links öffnen eine Seite direkt in der App, sogar aus einem Browser oder einem Chat heraus.",
      steps: {
        s1: "Drücke auf der Seite eines Werks die Link-Schaltfläche (oder L), um seinen Link zu kopieren.",
        s2: "Teile ihn: Wenn jemand mit Metadea ihn öffnet, startet die App direkt bei diesem Werk.",
        s3: "Links, die mit metadea:// beginnen, öffnen Werke, Charaktere, Profile oder die Startseite direkt.",
      },
      tips: {
        t1: "Geteilte Links laufen über eine kleine Webseite, die den Link an Metadea weitergibt. So funktionieren sie auch in Apps, die keine metadea://-Links öffnen.",
      },
    },
    github: {
      title: "GitHub und andere Verbindungen",
      intro: "GitHub wird genutzt, um Änderungen am Community-Katalog vorzuschlagen. Es braucht nur die Berechtigung, Pull Requests in öffentlichen Repositorys zu öffnen.",
      steps: {
        s1: "Drücke unter Einstellungen › Verbindungen › Community & Profil neben GitHub auf „Verbinden“.",
        s2: "Kopiere den Code, den Metadea anzeigt, öffne github.com/login/device und füge ihn dort ein.",
        s3: "Zurück in Metadea steht dir der Vorschlagseditor bei jedem Werk zur Verfügung.",
      },
      tips: {
        t1: "Einstellungen › Verbindungen zeigt außerdem VNDB für Visual Novels, das bald kommt.",
      },
    },
    appearance: {
      title: "Erscheinungsbild und Profil",
      intro: "Mach Metadea und dein Profil zu deinem: Hintergrund, Akzentfarbe, Schrift des Namens, Avatar, Banner und Biografie.",
      steps: {
        s1: "Wähle unter Einstellungen › Erscheinungsbild einen dynamischen Hintergrund (es gibt 14, von Nebula bis Blueprint).",
        s2: "Wähle eine Akzentfarbe oder stelle die Standardfarbe wieder her.",
        s3: "Gib den Namen ein, der angezeigt werden soll, und probiere die Schriften mit den Pfeilen aus.",
        s4: "Lade einen Avatar, ein quadratisches Foto für geteilte Bilder und ein Banner hoch und schreib eine Biografie.",
      },
      tips: {
        t1: "Das quadratische Foto wird nur in den Bildern verwendet, die du teilst; ist es leer, wird dein Avatar genommen.",
      },
    },
    ui_themes: {
      title: "Oberflächen-Themes (Skins)",
      intro: "Skins gestalten ganz Metadea neu. Es sind Ordner mit einer theme.json-Datei und optional CSS, die du selbst erstellen oder von anderen bekommen kannst.",
      steps: {
        s1: "Drücke unter Einstellungen › Plugins › Oberflächen-Themes auf „Theme-Ordner öffnen“.",
        s2: "Kopiere einen Theme-Ordner dorthin (oder drücke „Beispiel-Theme erstellen“) und drücke „Neu laden“.",
        s3: "Drücke beim gewünschten Theme auf „Aktivieren“. Es bleibt auch nach einem Neustart aktiv.",
        s4: "Wenn du ein eigenes erstellst, aktiviere „Änderungen beobachten“, um deine Anpassungen alle zwei Sekunden zu sehen.",
      },
      tips: {
        t1: "Themes vom Typ „Nur Variablen“ ändern nur Farben, Radien und Geschwindigkeiten und sind sicher. Themes mit „Vollständiges CSS“ können alles ändern und einen Bildschirm unbrauchbar machen.",
        t2: "Macht ein Theme etwas unbenutzbar, drücke irgendwo Strg+Umschalt+T, um es zu deaktivieren.",
        t3: "Themes können nichts aus dem Internet laden; um eins zu teilen, packe seinen Ordner als ZIP.",
      },
    },
    language: {
      title: "Sprache",
      intro: "Metadea gibt es auf Spanisch, Englisch, Deutsch, Japanisch, Italienisch, Französisch, Katalanisch und Russisch.",
      steps: {
        s1: "Öffne Einstellungen › Einstellungen › Sprache und drücke auf den Code deiner Sprache.",
        s2: "Die App lädt in der neuen Sprache neu.",
      },
      tips: {
        t1: "Titel und Zusammenfassungen stammen aus ihren Quellen und behalten deren Sprache.",
      },
    },
    shortcuts: {
      title: "Tastenkürzel",
      intro: "Die meisten Aktionen haben ein Tastenkürzel. Die Liste ändert sich mit jedem Bildschirm, sodass du immer die siehst, die gerade funktionieren.",
      steps: {
        s1: "Drücke auf jedem Bildschirm ?, um die Übersicht der Tastenkürzel ein- oder auszublenden.",
        s2: "Die Übersicht gruppiert sie in Allgemein, Seite, Dialog und Player.",
        s3: "Einstellungen › Einstellungen › Tastenkürzel zeigt dieselbe Liste.",
      },
      tips: {
        t1: "Tastenkürzel lassen sich noch nicht anpassen.",
        t2: "Während du in ein Textfeld tippst, lösen Tastenkürzel nicht aus – außer denen, die dafür gedacht sind (wie Strg+S in Editoren).",
      },
    },
    privacy: {
      title: "Offline-Nutzung und Datenschutz",
      intro: "Metadea ist dafür gemacht, ohne Internet zu funktionieren. Deine Bibliothek, dein Fortschritt und deine Einstellungen liegen auf deinem Computer; das Netz wird nur für die unten aufgeführten Dinge genutzt.",
      steps: {
        s1: "Beim Start, wenn du online bist: eine Suche nach Updates und der Download des neuesten Community-Katalogs.",
        s2: "Wenn du suchst oder ein neues Werk öffnest: Anfragen an seine Quellen (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "Beim Speichern: Synchronisierung mit AniList und MyAnimeList, nur wenn du sie verbunden hast.",
        s4: "Profil-Synchronisierung und Aktivität: nur mit einem Google-verknüpften Konto, und die Profil-Synchronisierung nur, wenn du sie bestätigst.",
      },
      tips: {
        t1: "Jede Quelle hat ein Anfragelimit; erreichst du es, wartet Metadea und zeigt einen Hinweis.",
        t2: "Discord wird nur lokal kontaktiert, auf deinem eigenen Computer.",
      },
    },
    backup: {
      title: "Wo deine Daten liegen und Sicherungen",
      intro: "Alles wird in einer Datenbank in deinem Benutzerordner gespeichert (unter Windows %APPDATA%\\com.metadea.app). Eine Sicherung ist eine einzelne .7z-Datei mit dieser Datenbank, deinen eigenen Bildern und Skins; Caches bleiben draußen, weil sie neu geladen werden.",
      steps: {
        s1: "Öffne Einstellungen › Sicherung und drücke „Sicherung erstellen“. Speichere die .7z-Datei außerhalb des Datenordners von Metadea.",
        s2: "Zum Wiederherstellen drückst du „Aus Datei wiederherstellen“ und wählst eine .7z-Datei (oder eine .zip aus älteren Versionen). Metadea prüft jede Datei, speichert eine Kopie deiner aktuellen Daten neben dem Ordner und startet dann neu, um die Sicherung anzuwenden.",
        s3: "„Ordner öffnen“ unter Einstellungen › Umgebung › Lokale Pfade öffnet den Datenordner.",
        s4: "Verknüpfe im selben Tab Google Drive, um Sicherungen in einen privaten App-Ordner hochzuladen, sofort oder automatisch täglich bzw. wöchentlich; jede davon lässt sich aus der Liste wiederherstellen.",
      },
      tips: {
        t1: "Niemand sonst hat eine Kopie deiner Bibliothek: Mach vor großen Änderungen und ab und zu eine Sicherung.",
      },
    },
    updates: {
      title: "Updates und Wartung",
      intro: "Metadea sucht beim Start nach neuen Versionen und fragt nach, bevor etwas installiert wird.",
      steps: {
        s1: "Gibt es eine neue Version, fragt ein Dialog, ob sie installiert werden soll; zum Abschluss startet die App neu.",
        s2: "Drücke unter Einstellungen › Neuigkeiten auf „Nach Updates suchen“, um sofort zu prüfen.",
        s3: "Im selben Tab lädt „Jetzt synchronisieren“ den Community-Katalog herunter, und „IDs reparieren“ korrigiert Charaktere, die mit alten TMDB-IDs gespeichert wurden.",
      },
      tips: {
        t1: "Ohne Internet wird die Prüfung still übersprungen, und alles andere funktioniert weiter.",
      },
    },
  },
};
