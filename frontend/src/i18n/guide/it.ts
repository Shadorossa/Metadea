import type { Translations } from '../types';

export const guideIt: Translations['guide'] = {
  page_title: "Guida utente",
  page_subtitle: "Come funziona ogni parte di Metadea, dalla prima ricerca al giocare, guardare, leggere e fare backup. Cerca un argomento o sceglilo dall'indice.",
  search_label: "Cerca nella guida",
  search_placeholder: "Cerca: lettore, ROM, AniList…",
  search_clear: "Cancella ricerca",
  results_count: "{count} di {total} sezioni",
  no_results_title: "Nessun risultato",
  no_results_body: "Nessuna sezione parla di «{query}». Prova con una parola più corta o diversa.",
  toc_title: "Indice",
  steps_title: "Come si usa",
  tips_title: "Consigli",
  shortcuts_title: "Scorciatoie",
  open_settings: "Apri Impostazioni › {tab}",
  open_settings_service: "Apri Impostazioni › {tab} › {service}",
  open_page: "Apri {page}",
  back_to_top: "Torna su",
  nav_link: "Guida utente",
  sheet_link: "Apri la guida utente",
  groups: {
    start: "Primi passi",
    discover: "Scopri",
    library: "La tua libreria",
    play: "Gioca",
    watch: "Guarda, leggi e ascolta",
    integrations: "Integrazioni",
    customize: "Personalizzazione",
    data: "Dati e privacy",
  },
  keys: {
    next_page: "Pagina successiva",
    prev_page: "Pagina precedente",
    next_chapter: "Capitolo successivo",
    prev_chapter: "Capitolo precedente",
    font_size: "Testo più grande / più piccolo",
    toc: "Indice",
    fullscreen: "Schermo intero",
    close_reader: "Chiudi il lettore",
  },
  sections: {
    overview: {
      title: "Che cos'è Metadea",
      intro: "Metadea è una libreria personale per tutto ciò che giochi, guardi e leggi: videogiochi, anime, manga, light novel, visual novel, serie, film, libri e fumetti. Vive sul tuo computer e funziona offline; internet serve solo per cercare informazioni e per sincronizzare quando lo chiedi tu.",
      steps: {
        s1: "Trova un'opera con la ricerca (Ctrl+K) e apri la sua pagina.",
        s2: "Clicca sulla copertina per aggiungerla alla libreria e impostare stato, progressi, date e valutazione.",
        s3: "Indica a Play le tue cartelle, i launcher e gli emulatori per aprire giochi, video e libri direttamente da Metadea.",
        s4: "Segui i tuoi progressi nella Home e nel profilo: statistiche, preferiti, liste e cronologia.",
      },
      tips: {
        t1: "La tua libreria è un database su questo computer. Nessun altro ne ha una copia, quindi fai un backup ogni tanto (Impostazioni › Backup).",
        t2: "Ogni impostazione della guida di benvenuto si può cambiare in seguito dalle Impostazioni.",
      },
    },
    navigation: {
      title: "Orientarsi",
      intro: "La barra superiore è sempre presente. Le frecce vanno indietro e avanti, le icone a sinistra aprono Home, Play ed Esplora, i nomi al centro aprono la libreria filtrata per tipo e il gruppo a destra contiene ricerca, notifiche, profilo e Impostazioni.",
      steps: {
        s1: "Usa le frecce ← e → all'estrema sinistra, oppure Alt+← / Alt+→, per muoverti nella cronologia.",
        s2: "Clicca su un tipo di media al centro della barra (Anime, Manga, Videogiochi…) per andare a quella parte della libreria.",
        s3: "Premi da Ctrl+1 a Ctrl+6 per andare subito a Home, Play, Profilo, Esplora, Notifiche o Impostazioni.",
        s4: "Premi ? in qualsiasi schermata per vedere le scorciatoie disponibili lì.",
      },
      tips: {
        t1: "In Esplora e in Play il centro della barra diventa l'insieme delle schede di quella pagina.",
        t2: "Su Mac, il Ctrl di queste scorciatoie è ⌘.",
      },
    },
    account: {
      title: "Il tuo account",
      intro: "La prima volta che apri Metadea scegli solo un nome utente: la sessione è locale e non viene caricato nulla. In seguito puoi collegarla a Google per avere un profilo pubblico e vedere l'attività dei tuoi amici.",
      steps: {
        s1: "Per collegare una sessione locale, usa «Collega con Google» nella Home.",
        s2: "Con un account collegato, la Home ti chiede una volta al giorno se sincronizzare il profilo; viene caricato solo quando premi «Sincronizza».",
        s3: "«Esci» si trova in fondo a Impostazioni › Aspetto.",
      },
      tips: {
        t1: "Uscire fa solo dimenticare la sessione: la libreria resta su questo computer.",
        t2: "«Non ora» nasconde la richiesta di sincronizzazione fino alla prossima visita alla Home.",
      },
    },
    home: {
      title: "Home",
      intro: "La Home è il tuo riepilogo quotidiano: cosa hai in corso, cosa esce questo mese e cosa stanno facendo i tuoi amici.",
      steps: {
        s1: "Il primo blocco mostra ciò che stai guardando, leggendo o giocando, raggruppato per tipo. Usa + e − su una copertina per aggiungere o togliere un episodio o un capitolo senza aprire l'opera.",
        s2: "Il calendario mostra le uscite del mese. «Per te» include solo le opere della tua libreria; «Generale» include tutto. Filtra per tipo e cambia mese con le frecce.",
        s3: "La colonna di destra si apre con «In questo giorno»: le opere che hai finito in questa stessa data negli anni passati.",
        s4: "Sotto, il feed delle attività passa da «Amici» a «Generale».",
        s5: "La colonna stretta all’estrema destra mostra «In onda oggi» (gli episodi della tua libreria che escono oggi) e «Continua a guardare»: l’ultima cosa che hai riprodotto in Play, con il tempo rimanente. Fai clic per riprendere esattamente da dove avevi interrotto.",
      },
      tips: {
        t1: "I blocchi senza contenuto restano nascosti, quindi una libreria nuova parte quasi vuota.",
        t2: "Pochi secondi dopo l'avvio Metadea scarica i dati più recenti della community e controlla gli aggiornamenti, e te lo segnala con un avviso.",
        t3: "Rivedere qualcosa non cambia la data con cui compare in «In questo giorno».",
      },
    },
    search: {
      title: "Ricerca e ricerca rapida",
      intro: "Ci sono due modi di cercare: la ricerca rapida, che compare sopra qualsiasi schermata, e la pagina Esplora, con una scheda per ogni tipo di media. I risultati del tuo catalogo compaiono per primi, poi si aggiungono quelli delle fonti online man mano che rispondono.",
      steps: {
        s1: "Premi Ctrl+K o / (oppure l'icona della bussola a destra della barra superiore) e scrivi almeno due lettere.",
        s2: "La ricerca rapida cerca in tutti i tipi insieme: opere, personaggi, staff e utenti, fino a sei per gruppo. Spostati con ↑ e ↓, apri con Invio oppure usa «Vedi tutto».",
        s3: "In Esplora, scegli una scheda per cercare un solo tipo. Ogni tipo ha la sua fonte: AniList per anime, manga e light novel; IGDB per videogiochi e visual novel; TMDB per film e serie; Open Library per i libri; Comic Vine per i fumetti.",
        s4: "Apri un risultato per vedere la sua pagina e aggiungerlo alla libreria.",
      },
      tips: {
        t1: "IGDB, TMDB e Comic Vine richiedono chiavi tue, gratuite. Senza di esse Esplora mostra un avviso con un pulsante che ti porta al punto giusto di Impostazioni › Ambiente.",
        t2: "Se una fonte non risponde o sei offline, vedi comunque ciò che è già nel tuo catalogo locale.",
        t3: "Premi Ctrl+F in Esplora per andare alla casella di ricerca.",
      },
    },
    media_page: {
      title: "La pagina di un'opera",
      intro: "Ogni opera ha una pagina con copertina, dati, i tuoi progressi e diverse schede di contenuti correlati. Quasi tutto si può fare da tastiera.",
      steps: {
        s1: "Clicca sulla copertina (o premi E) per aggiungere l'opera alla libreria o modificare la tua voce.",
        s2: "Premi + o − per cambiare i progressi, da 1 a 9 per valutarla (0 vale 10) e F per segnarla come preferita.",
        s3: "Le schede in basso mostrano opere correlate, edizioni, consigli, stagioni, episodi e sigle di apertura e chiusura.",
        s4: "La sezione «Utenti» mostra i punteggi degli amici di AniList che segui, quando sei connesso.",
        s5: "Il pulsante del link (o L) copia un link che apre questa pagina in Metadea.",
      },
      tips: {
        t1: "I giochi che sono un'edizione di un altro ti portano al gioco principale e lo indicano nel banner.",
        t2: "I tuoi screenshot di un gioco o di un episodio compaiono nella sua sezione «Screenshot».",
      },
    },
    editor: {
      title: "Modificare la tua voce",
      intro: "L'editor raccoglie tutto il tuo rapporto con un'opera: stato, progressi, date, valutazione, note e altro. Si apre cliccando sulla copertina o premendo E.",
      steps: {
        s1: "Scegli uno stato con le icone: in sospeso, in corso, completato, in pausa o abbandonato.",
        s2: "Imposta i progressi. Videogiochi e visual novel contano le ore (H:MM); tutto il resto conta episodi, capitoli o volumi. Raggiunto il totale, l'opera risulta completata.",
        s3: "Aggiungi una valutazione, le date di inizio e fine (o la data di visione per i film), fino a cinque tag e note personali.",
        s4: "Segnala come preferita, oppure come «Platino» per i giochi completati al 100 %.",
        s5: "In «Cronologia mensile», scegli il mese che quest'opera rappresenta; ogni mese contiene una sola opera.",
        s6: "Salva con Ctrl+S. Ctrl+Z e Ctrl+Y annullano e ripetono.",
      },
      tips: {
        t1: "«Importa dati dal tuo profilo AniList» compila progressi e date a partire da AniList.",
        t2: "Una volta completata, «Condividi» crea un'immagine verticale con la copertina, la tua valutazione e il tuo avatar.",
        t3: "Le tue note diventano recensioni nella scheda «Recensioni» del profilo.",
      },
    },
    rewatch: {
      title: "Rivedere, rileggere e rigiocare",
      intro: "Quando torni su qualcosa che avevi finito, Metadea conta la ripetizione senza perdere le date originali.",
      steps: {
        s1: "Apri l'editor di un'opera completata e premi il pulsante di ripetizione («Rivedere», «Rileggere» o «Rigiocare»).",
        s2: "I progressi tornano a zero e lo stato passa a in corso; le date del primo giro restano.",
        s3: "Quando la completi di nuovo, il contatore «Volte ripetuto» aumenta di uno.",
      },
      tips: {
        t1: "Premi di nuovo il pulsante prima di finire per annullare la ripetizione senza contarla.",
        t2: "Le schede della libreria mostrano ×2, ×3… e le statistiche contano le ore di ogni giro.",
      },
    },
    sagas: {
      title: "Saghe, stagioni e relazioni",
      intro: "Le opere che vanno insieme — sequel, prequel, spin-off, stagioni — sono collegate, così puoi vedere un intero franchise e quanto ne hai completato.",
      steps: {
        s1: "Premi «Ordine della saga» nella pagina di un'opera per vedere tutto il franchise in ordine. «Sei qui» indica l'opera attuale e la scheda «Archi narrativi» divide le serie lunghe in archi.",
        s2: "La barra di avanzamento della saga ti dice quante opere della saga hai completato; quelle non ancora uscite non contano.",
        s3: "La scheda «Correlati» elenca ogni relazione con il suo tipo (sequel, adattamento, spin-off…).",
      },
      tips: {
        t1: "Con «Unifica le stagioni» attivo (Impostazioni › Preferenze), le stagioni di un anime si raggruppano in un'unica scheda della libreria e la pagina mostra invece una scheda «Stagioni».",
        t2: "La barra della saga compare solo dopo che ne hai completato almeno una parte.",
      },
    },
    characters: {
      title: "Personaggi e staff",
      intro: "Personaggi e autori hanno pagine proprie, raggiungibili dal cast di un'opera o dalla ricerca.",
      steps: {
        s1: "La pagina di un personaggio mostra la biografia, le opere in cui compare e i doppiatori.",
        s2: "Segna un personaggio come preferito per aggiungerlo ai personaggi preferiti del tuo profilo.",
        s3: "La pagina di un membro dello staff elenca le sue opere e le date.",
      },
      tips: {
        t1: "Anche la ricerca rapida trova personaggi e staff: scrivi il nome e guarda i rispettivi gruppi.",
      },
    },
    community: {
      title: "Catalogo della community e proposte",
      intro: "Metadea condivide un catalogo della community: dati aggiunti e corretti dagli utenti, revisionati su GitHub. La tua copia si aggiorna a ogni avvio e puoi proporre modifiche dalla pagina di qualsiasi opera.",
      steps: {
        s1: "Connetti GitHub in Impostazioni › Connessioni.",
        s2: "Nella pagina di un'opera, premi il pulsante + nel banner (o P) per aprire l'editor delle proposte.",
        s3: "Modifica titoli, sinossi, date, conteggi, link, immagini, generi, piattaforme, personaggi, relazioni, episodi, sigle, archi narrativi o ordine della saga. Puoi modificare più opere nella stessa sessione.",
        s4: "Premi «Invia proposta»: diventa una pull request che viene revisionata prima di arrivare a tutti.",
      },
      tips: {
        t1: "Impostazioni › Novità › «Sincronizza ora» scarica il catalogo quando vuoi.",
        t2: "Impostazioni › Admin › Editor del catalogo mostra il tuo catalogo locale; per modificare quello condiviso servono i permessi di scrittura sul repository.",
      },
    },
    statuses: {
      title: "La tua libreria: stati e progressi",
      intro: "La libreria, nel tuo profilo, raggruppa ogni tipo per stato, così vedi a colpo d'occhio cosa è in sospeso, in corso o finito.",
      steps: {
        s1: "Apri un tipo dalla barra superiore o dalla scheda «Libreria» del profilo.",
        s2: "Sezioni: In sospeso, In corso, In onda (in corso e ancora in uscita), Completate, In pausa e Abbandonate.",
        s3: "Filtra per nome, formato, stato o date, ordina per valutazione, data o durata e raggruppa per saga o raccolta.",
        s4: "Premi Ctrl+F per cercare all'interno della libreria.",
      },
      tips: {
        t1: "I pulsanti + e − della Home e i tasti +/− della pagina dell'opera aggiornano i progressi senza aprire l'editor.",
      },
    },
    ratings: {
      title: "Valutazioni",
      intro: "Scegli come preferisci votare: 5 stelle, un 10 con due decimali, un 10 intero o tre faccine. Puoi anche tenere due valutazioni contemporaneamente.",
      steps: {
        s1: "In Impostazioni › Preferenze › Sistema di valutazione, scegli la scala che preferisci.",
        s2: "Attiva «Doppia valutazione» per tenere un secondo punteggio con nome e scala propri (per esempio Trama e Grafica).",
        s3: "Valuta dall'editor oppure premi da 1 a 9 (0 = 10) nella pagina di un'opera.",
      },
      tips: {
        t1: "Con la doppia valutazione, un selettore nella libreria sceglie quale dei due punteggi mostrare.",
        t2: "Quando sincronizzi con AniList, il tuo punteggio viene convertito nella scala del tuo account AniList.",
        t3: "«Elimina valutazioni» in Impostazioni › Preferenze cancella tutte le valutazioni dopo averti chiesto conferma.",
      },
    },
    favorites_lists: {
      title: "Preferiti, Hall of Fame e liste",
      intro: "Preferiti e liste ti permettono di mostrare ciò che conta di più per te, nell'ordine che scegli.",
      steps: {
        s1: "Segna opere e personaggi come preferiti; il pulsante con la corona aggiunge inoltre un'opera ai preferiti generali «Multimedia».",
        s2: "Nella scheda «Preferiti», trascina per riordinare e assegna un'immagine personalizzata a qualsiasi preferito.",
        s3: "Le tue 10 opere e i tuoi 10 personaggi migliori formano la Hall of Fame del profilo.",
        s4: "In «Liste», crea liste di opere, personaggi o episodi; rendile private o una classifica e ordinale a mano, alfabeticamente o per data di uscita.",
      },
      tips: {
        t1: "Le liste si possono riordinare trascinandole.",
      },
    },
    tier_lists: {
      title: "Tier list",
      intro: "Classifica le opere in fasce dalla S alla F, oppure in fasce a cui dai tu nome e colore.",
      steps: {
        s1: "Apri Tier list e creane una nuova.",
        s2: "Aggiungi opere dal tuo catalogo; restano in attesa nell'area «Non classificato».",
        s3: "Trascina ogni opera nella sua fascia. Clicca sul nome o sul colore di una fascia per cambiarlo.",
      },
      tips: {
        t1: "Tier list di personaggi e ricerca nella community arriveranno presto.",
      },
    },
    stats: {
      title: "Statistiche e cronologia",
      intro: "La scheda «Statistiche» del profilo trasforma la libreria in numeri: quanto hai finito, quante ore, quali generi e come valuti.",
      steps: {
        s1: "Le schede in alto riassumono opere, stagioni, ore totali, punteggio medio e opere valutate.",
        s2: "Più in basso trovi la ripartizione per stato, il tempo per categoria, i generi preferiti, la distribuzione dei punteggi, i completamenti per anno e una mappa di attività di sei mesi.",
        s3: "Il calcolatore del backlog stima quanto tempo ti servirebbe per finire ciò che è in sospeso, con o senza quello che hai in corso.",
        s4: "La scheda «Profilo» mostra la cronologia mensile (una copertina al mese) e l'attività recente.",
      },
      tips: {
        t1: "Le ripetizioni contano: una serie vista due volte somma le sue ore due volte.",
      },
    },
    social: {
      title: "Amici e notifiche",
      intro: "Con un account collegato puoi seguire altre persone, vedere la loro attività e visitare i loro profili. I promemoria delle uscite arrivano come notifiche di sistema.",
      steps: {
        s1: "Nella scheda «Amici» del profilo, vedi chi segui e chi ti segue.",
        s2: "Apri il profilo di qualcuno per vedere la sua libreria in sola lettura e seguirlo.",
        s3: "Il feed delle attività della Home mostra cosa fanno i tuoi amici.",
      },
      tips: {
        t1: "Metadea invia notifiche di sistema per le uscite di oggi delle opere che hai in programma, per gli anime in onda che segui e per i nuovi episodi o capitoli di ciò che stai guardando o leggendo.",
        t2: "La pagina Notifiche è ancora in costruzione.",
      },
    },
    local_folders: {
      title: "Cartelle locali",
      intro: "Play trova i tuoi file cercando in una cartella per ogni tipo di media. Metadea abbina ogni file o sottocartella a un'opera del tuo catalogo.",
      steps: {
        s1: "In Impostazioni › Ambiente › Percorsi locali, scegli una cartella per ogni tipo (anime, serie, film, manga, fumetti, libri…).",
        s2: "Per i giochi puoi anche usare «Aggiungi cartella» nell'intestazione di Play; ogni sottocartella conta come un gioco.",
        s3: "Apri Play: i file abbinati compaiono con la copertina e i dati dell'opera.",
        s4: "Se qualcosa non viene riconosciuto, usa «Individua manualmente» e poi «Rinomina per il rilevamento automatico», così la prossima volta verrà trovato da solo.",
      },
      tips: {
        t1: "L'abbinamento ignora accenti e punteggiatura e rispetta i numeri di stagione nei nomi.",
        t2: "Tra i file supportati ci sono mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz e cbr.",
        t3: "Premi Ctrl+F in Play per cercare nella tua libreria locale.",
      },
    },
    pc_launchers: {
      title: "Giochi per PC: Steam, Epic, GOG, Xbox ed EA",
      intro: "Play rileva i giochi che hai installato dai principali launcher per PC, senza configurare nulla.",
      steps: {
        s1: "Apri Play › Videogiochi: la prima visita analizza Steam, Epic Games, GOG, l'app Xbox ed EA.",
        s2: "Le visite successive rianalizzano solo i launcher che sono cambiati; «Scansiona di nuovo» forza un'analisi completa.",
        s3: "Aggiungi la tua Steam Web API key in Impostazioni › Ambiente per ottenere anche tempo di gioco, data dell'ultima partita e i giochi posseduti ma non installati.",
      },
      tips: {
        t1: "Se i giochi di un launcher non compaiono, «Diagnostica» mostra cosa ha trovato Metadea.",
      },
    },
    roms: {
      title: "Emulatori e ROM",
      intro: "Metadea può ospitare la tua collezione retro: legge le cartelle delle ROM, ne ripulisce i nomi, riconosce ogni gioco e lo apre con l'emulatore giusto.",
      steps: {
        s1: "In Impostazioni › Emulatori, scegli un'azienda e una console.",
        s2: "Scegli l'emulatore e il suo eseguibile, gli argomenti di avvio ({ROM} viene sostituito dal file) e la cartella delle ROM.",
        s3: "Se vuoi, indica le estensioni delle ROM da cercare (vuoto = quelle abituali) e la cartella degli screenshot dell'emulatore.",
        s4: "Apri Play › Videogiochi: le tue ROM compaiono con nomi puliti e dati di IGDB.",
      },
      tips: {
        t1: "«Pulisci automaticamente i nomi delle ROM» rinomina i file in un formato ordinato (e con loro i salvataggi). Un avviso ti permette di annullare per qualche secondo.",
        t2: "Le ROM di GameCube, Wii, DS e 3DS vengono riconosciute dall'ID nell'intestazione; aggiornamenti e DLC di Switch vengono raggruppati sotto il gioco base.",
        t3: "Se una ROM viene abbinata al gioco sbagliato, usa la matita («Cambia gioco su IGDB») nel suo pannello dei dettagli.",
      },
    },
    metadata: {
      title: "Scaricare i metadati",
      intro: "Il pulsante «Metadati» di Play scarica in un colpo solo copertine, banner e informazioni dei tuoi giochi.",
      steps: {
        s1: "Apri Play › Videogiochi e premi «Metadati» in fondo all'elenco delle piattaforme.",
        s2: "Scegli «Base» (copertina, banner, generi, sinossi, data, editore), «Obiettivi Steam» o entrambi.",
        s3: "Segui la finestra di avanzamento; puoi annullare in qualsiasi momento.",
      },
      tips: {
        t1: "Funziona con i giochi Steam, GOG e ROM. Gli obiettivi Steam richiedono la tua Steam Web API key.",
        t2: "I dati dei giochi arrivano da IGDB, quindi le sue chiavi devono essere impostate in Impostazioni › Ambiente.",
      },
    },
    achievements: {
      title: "Obiettivi",
      intro: "Il pannello dei dettagli di un gioco in Play ha una scheda degli obiettivi: obiettivi Steam per i giochi Steam e RetroAchievements per le tue ROM.",
      steps: {
        s1: "Per Steam, aggiungi la tua Steam Web API key ed esegui «Metadati» › «Obiettivi Steam».",
        s2: "Per le ROM, aggiungi il tuo utente e la Web API key di RetroAchievements in Impostazioni › Ambiente.",
        s3: "Apri una ROM in Play: Metadea la collega al suo set di RetroAchievements tramite l'hash del file, o tramite il titolo se non ci riesce.",
        s4: "Se sceglie il set sbagliato, usa «Collega manualmente» o «Scollega».",
      },
      tips: {
        t1: "Gli obiettivi vengono salvati in cache, quindi puoi vederli anche offline.",
        t2: "Dopo una sessione, un avviso ti dice quanti obiettivi hai sbloccato.",
        t3: "Le console senza set di RetroAchievements (3DS, Wii, Wii U, Switch, PC…) non mostrano il pannello.",
      },
    },
    screenshots: {
      title: "Screenshot",
      intro: "La sezione «Screenshot» di un'opera raccoglie catture da tre posti: quelle che fai in Metadea, i tuoi screenshot di Steam e la cartella delle catture del tuo emulatore.",
      steps: {
        s1: "Premi F12 nel lettore integrato per salvare un fotogramma. Finisce in Immagini › Metadea › <opera>, con episodio e minuto nel nome.",
        s2: "Nel lettore di fumetti, fai clic destro su una pagina e scegli «Salva pagina (PNG)».",
        s3: "Per gli emulatori, imposta la cartella degli screenshot di ogni console in Impostazioni › Emulatori, oppure lasciala vuota perché venga rilevata.",
      },
      tips: {
        t1: "La cartella delle catture viene rilevata automaticamente per Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu e PPSSPP.",
        t2: "Le catture degli emulatori vengono filtrate per gioco; se nessuna corrisponde, vengono mostrate quelle recenti con una nota.",
      },
    },
    launching: {
      title: "Avviare i giochi e tempo di gioco",
      intro: "Il pulsante «Gioca» avvia qualsiasi gioco della tua libreria locale e Metadea conta il tempo che passi a giocare.",
      steps: {
        s1: "Apri un gioco in Play e premi «Gioca».",
        s2: "I giochi Steam, Epic e GOG si aprono tramite il loro launcher; le ROM si aprono con l'emulatore impostato per la loro console.",
        s3: "Metadea tiene d'occhio il processo del gioco e aggiunge ogni sessione alle tue ore nella libreria.",
      },
      tips: {
        t1: "Le sessioni più brevi di 15 secondi non vengono contate.",
        t2: "Se il pulsante di una ROM è disattivato, la sua console non ha ancora un emulatore (Impostazioni › Emulatori).",
        t3: "Mentre giochi, Discord mostra il gioco (e i tuoi progressi RetroAchievements per le ROM).",
      },
    },
    player: {
      title: "Il lettore video",
      intro: "Gli episodi e i film locali si riproducono nel lettore integrato di Metadea (libmpv), che salva i progressi da solo. Se preferisci, puoi usare VLC.",
      steps: {
        s1: "Scegli il lettore in Impostazioni › Preferenze › Lettore video: integrato (libmpv) o VLC (esterno).",
        s2: "Scegli i controlli: sovrapposti al video o in una barra fissa sotto il video.",
        s3: "Premi «Riproduci» su un episodio in Play. Il resto della stagione va in coda; premi Q per vedere la coda.",
        s4: "Usa i menu per cambiare traccia audio, sottotitoli e velocità (da 0,5× a 2×).",
        s5: "All'80 % l'episodio viene segnato come visto: stato, progressi e AniList si aggiornano. Un avviso ti permette di annullare.",
        s6: "Se chiudi prima dell'80 %, il prossimo «Riproduci» riprende esattamente dal secondo in cui eri.",
      },
      tips: {
        t1: "Clicca sul video per mettere in pausa e fai doppio clic per lo schermo intero.",
        t2: "Se libmpv non si può caricare, Metadea usa VLC automaticamente e te lo dice.",
        t3: "Finire l'ultimo episodio completa l'opera e aggiunge il suo seguito alle opere in sospeso.",
        t4: "Discord mostra cosa stai guardando con il conto alla rovescia del tempo rimanente.",
      },
    },
    player_shortcuts: {
      title: "Scorciatoie del lettore",
      intro: "Nel lettore integrato tutto si può fare da tastiera. Premi ? mentre è aperto per vedere questo elenco.",
      steps: {
        s1: "Spazio mette in pausa; le frecce spostano di 5 s (30 s con Maiusc) e cambiano il volume.",
        s2: "N e P (oppure Ctrl+→ e Ctrl+←) passano all'episodio successivo o precedente.",
        s3: ", e . avanzano fotogramma per fotogramma; [ e ] cambiano la velocità.",
        s4: "I tasti numerici saltano al 10 %, 20 %… del video.",
      },
      tips: {
        t1: "Esc chiude, in quest'ordine: i menu aperti, lo schermo intero e infine il lettore.",
      },
    },
    skip_segments: {
      title: "Saltare sigle di apertura e chiusura",
      intro: "Il lettore integrato rileva sigle di apertura e chiusura, riassunti e anteprime, così puoi saltarli.",
      steps: {
        s1: "In Impostazioni › Preferenze › Lettore video, scegli come: mostrare un pulsante, saltare automaticamente o non rilevare.",
        s2: "Con il pulsante, premilo (o S) quando compare.",
        s3: "In modalità automatica un avviso indica cosa è stato saltato e offre «Annulla».",
      },
      tips: {
        t1: "I segmenti arrivano dai capitoli del file (MKV) e, per gli anime, da AniSkip; se ci sono entrambi, prevalgono i capitoli.",
        t2: "Funziona solo nel lettore integrato, non in VLC.",
      },
    },
    reader_comics: {
      title: "Leggere fumetti e manga",
      intro: "I file CBZ, CBR e PDF si aprono nel lettore di Metadea, che ricorda la pagina a cui sei arrivato.",
      steps: {
        s1: "Apri il file da Play.",
        s2: "Gira le pagine con le frecce, con Spazio o cliccando sul lato sinistro o destro della pagina. Le doppie pagine vengono mostrate affiancate, con la copertina da sola.",
        s3: "Fai clic destro su una pagina per aggiungere un segnalibro, vedere i segnalibri o salvare la pagina come immagine.",
        s4: "Arrivare all'ultima pagina lo segna come letto e aggiorna la libreria.",
      },
      tips: {
        t1: "La pagina viene salvata a ogni cambio.",
        t2: "«Metti in standby» chiude il lettore ma conserva la sessione in una barra, così puoi riprenderla più tardi.",
      },
    },
    reader_epub: {
      title: "Leggere libri EPUB",
      intro: "I libri EPUB hanno un lettore dedicato, con controlli tipografici, indice, segnalibri e avanzamento.",
      steps: {
        s1: "Apri il libro da Play.",
        s2: "In «Tipografia», scegli carattere, dimensione, interlinea, margini, tema di colore (Carta, Seppia, Scuro, Nero) e giustificazione.",
        s3: "Scegli la modalità «Pagine» o «Scorrimento».",
        s4: "Premi T per l'indice e usa «Aggiungi segnalibro qui» per segnare un punto.",
        s5: "La percentuale indica a che punto sei; al 98 % il libro risulta letto.",
      },
      tips: {
        t1: "«Usa gli stili dell'editore» rispetta il design originale del libro.",
        t2: "Quando finisci, i progressi si sincronizzano con la libreria e con AniList.",
      },
    },
    themes_jukebox: {
      title: "Sigle e jukebox",
      intro: "Le pagine degli anime includono le sigle di apertura e chiusura. Metti una stella a quelle che ti piacciono e le potrai ascoltare nel jukebox da qualsiasi schermata.",
      steps: {
        s1: "Apri una sigla dalla scheda «Temi» di un'opera (o premi T). Passa da una versione all'altra (v1, v2…) e vai alla precedente o alla successiva.",
        s2: "Premi la stella («Aggiungi al jukebox») per salvarla.",
        s3: "Apri il jukebox con il pulsante rotondo in basso a destra: il disco che gira mostra la copertina e si mette in pausa se ci clicchi.",
        s4: "Usa precedente/successiva, la barra di avanzamento, il volume, la riproduzione casuale e la ripetizione (disattivata, coda o questa sigla).",
      },
      tips: {
        t1: "Il jukebox si mette in pausa da solo quando si apre il lettore, quando parte un video locale, quando si apre una sigla nella pagina di un'opera o quando suona un altro audio.",
        t2: "I tasti multimediali della tastiera lo controllano, e ricorda volume, riproduzione casuale, ripetizione e l'ultima sigla.",
        t3: "I video delle sigle arrivano da animethemes.moe, quindi serve una connessione.",
      },
    },
    api_keys: {
      title: "Chiavi API: a cosa serve ognuna",
      intro: "Alcune fonti richiedono una chiave gratuita da creare nel tuo account. Sono tutte facoltative: configura solo quelle per ciò che usi.",
      steps: {
        s1: "Apri Impostazioni › Ambiente e clicca sul logo di un servizio.",
        s2: "Premi il pulsante (i) per vedere come ottenere quella chiave, incollala e premi Salva.",
        s3: "IGDB: videogiochi, visual novel e i dati delle tue ROM. TMDB: film e serie. Comic Vine: fumetti. Steam: tempo di gioco e obiettivi.",
        s4: "AniList e MyAnimeList: un Client ID per connettere il tuo account (la ricerca su AniList funziona anche senza). RetroAchievements: utente e Web API key.",
      },
      tips: {
        t1: "Su Windows le chiavi vengono salvate cifrate nel database di Metadea.",
        t2: "API-Sports serve per gli eventi sportivi, un tipo per ora disattivato.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Connetti AniList per importare la tua lista di anime e manga e tenerla sincronizzata: ogni modifica che salvi in Metadea viene inviata ad AniList.",
      steps: {
        s1: "Crea un'app su AniList e incolla il suo Client ID in Impostazioni › Ambiente › AniList.",
        s2: "In Impostazioni › Connessioni premi «Connetti», autorizza Metadea nel browser e incolla il codice che ti viene dato.",
        s3: "Premi «Importa» e scegli i formati (TV, film, OVA, manga, light novel…).",
        s4: "«Importa» aggiunge solo ciò che non hai ancora; «Sincronizza» aggiorna anche ciò che hai già con i dati di AniList.",
      },
      tips: {
        t1: "Salvare dall'editor, dal lettore video, dal lettore di fumetti o libri o dalla Home invia automaticamente la modifica ad AniList.",
        t2: "AniList consente 60 richieste al minuto; se raggiungi il limite, Metadea aspetta e te lo dice.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList si connette con un accesso dal browser e riceve in background le modifiche ad anime, manga e light novel.",
      steps: {
        s1: "Crea un'app API su MyAnimeList con metadea://auth/mal come URL di reindirizzamento e incolla il suo Client ID in Impostazioni › Ambiente › MyAnimeList (non serve il secret).",
        s2: "In Impostazioni › Connessioni premi «Connetti»: si apre il browser, che poi ti riporta in Metadea.",
        s3: "Se il browser non ti riporta indietro, incolla l'indirizzo metadea://auth/mal?code=… nella casella e premi «Completa il collegamento».",
        s4: "«Importa» porta la tua lista di MAL e la abbina ad AniList; ciò che non trova corrispondenza viene elencato a parte.",
      },
      tips: {
        t1: "Le modifiche vengono inviate a MAL ogni volta che salvi, proprio come con AniList. Le opere senza id di MAL vengono saltate.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea mostra i tuoi progressi su RetroAchievements accanto alle ROM. Si limita a mostrarli: gli obiettivi si sbloccano giocando in un emulatore con RetroAchievements attivo.",
      steps: {
        s1: "Su retroachievements.org, apri le impostazioni e copia la tua Web API key.",
        s2: "In Impostazioni › Ambiente › RetroAchievements, inserisci il nome utente e la chiave, poi salva.",
        s3: "Attiva RetroAchievements nel tuo emulatore con lo stesso account.",
        s4: "Apri una ROM in Play per vedere il suo set, i tuoi progressi e ogni obiettivo.",
      },
      tips: {
        t1: "I giochi vengono riconosciuti dall'hash della ROM, come fanno gli emulatori, quindi un dump pulito funziona meglio.",
        t2: "Senza connessione vedi gli ultimi dati in cache.",
      },
    },
    discord: {
      title: "Discord",
      intro: "Se Discord è aperto, il tuo profilo mostra cosa stai facendo in Metadea: giocare, guardare, ascoltare una sigla, leggere o consultare un'opera.",
      steps: {
        s1: "Apri Discord su questo computer; Metadea lo trova da solo, anche se lo apri dopo.",
        s2: "Avvia un gioco, un video o una sigla, oppure apri un libro o la pagina di un'opera: il tuo stato cambia di conseguenza.",
        s3: "Le opere che stai consultando includono un pulsante «Open in Metadea», così anche i tuoi amici possono aprirle.",
      },
      tips: {
        t1: "In Metadea non c'è un interruttore: per nasconderlo, chiudi Discord o disattiva la condivisione dell'attività nelle impostazioni di Discord.",
        t2: "Per i video vengono mostrati l'episodio e il conto alla rovescia del tempo rimanente; i giochi da emulatore aggiungono i tuoi progressi RetroAchievements.",
      },
    },
    deep_links: {
      title: "Link e condivisione",
      intro: "I link di Metadea aprono una pagina direttamente nell'app, anche da un browser o da una chat.",
      steps: {
        s1: "Nella pagina di un'opera, premi il pulsante del link (o L) per copiarne il link.",
        s2: "Condividilo: quando qualcuno che ha Metadea lo apre, l'app si apre su quell'opera.",
        s3: "I link che iniziano con metadea:// aprono direttamente opere, personaggi, profili o la Home.",
      },
      tips: {
        t1: "I link condivisi passano per una piccola pagina web che consegna il link a Metadea, quindi funzionano anche nelle app che non aprono i link metadea://.",
      },
    },
    github: {
      title: "GitHub e altre connessioni",
      intro: "GitHub serve per proporre modifiche al catalogo della community. Richiede solo il permesso di aprire pull request sui repository pubblici.",
      steps: {
        s1: "In Impostazioni › Connessioni › Community e profilo, premi «Connetti» accanto a GitHub.",
        s2: "Copia il codice che mostra Metadea, apri github.com/login/device e incollalo.",
        s3: "Tornato in Metadea, l'editor delle proposte è disponibile su ogni opera.",
      },
      tips: {
        t1: "Impostazioni › Connessioni mostra anche VNDB per le visual novel, in arrivo.",
      },
    },
    appearance: {
      title: "Aspetto e profilo",
      intro: "Rendi tuoi Metadea e il tuo profilo: sfondo, colore di accento, carattere del nome, avatar, banner e biografia.",
      steps: {
        s1: "In Impostazioni › Aspetto, scegli uno sfondo dinamico (ce ne sono 14, da Nebula a Blueprint).",
        s2: "Scegli un colore di accento o ripristina quello predefinito.",
        s3: "Scrivi il nome da mostrare e prova i caratteri con le frecce.",
        s4: "Carica un avatar, una foto quadrata per le immagini condivise e un banner, e scrivi una biografia.",
      },
      tips: {
        t1: "La foto quadrata si usa solo nelle immagini che condividi; se è vuota, viene usato l'avatar.",
      },
    },
    ui_themes: {
      title: "Temi dell'interfaccia (skin)",
      intro: "Le skin cambiano lo stile di tutto Metadea. Sono cartelle con un file theme.json e, facoltativamente, del CSS, che puoi creare tu o ricevere da altre persone.",
      steps: {
        s1: "In Impostazioni › Aspetto › Temi della community, premi «Apri la cartella dei temi».",
        s2: "Copia lì la cartella di un tema (o premi «Crea tema di esempio») e premi «Ricarica».",
        s3: "Premi «Attiva» sul tema che vuoi. Resta attivo anche dopo il riavvio.",
        s4: "Se ne crei uno tuo, attiva «Osserva le modifiche» per vedere le tue modifiche ogni due secondi.",
      },
      tips: {
        t1: "I temi «Solo variabili» cambiano solo colori, raggi e velocità, e sono sicuri. I temi «CSS completo» possono cambiare qualsiasi cosa e potrebbero rompere una schermata.",
        t2: "Se un tema rende qualcosa inutilizzabile, premi Ctrl+Maiusc+T in qualsiasi punto per disattivarlo.",
        t3: "I temi non possono caricare nulla da internet; per condividerne uno, comprimi la sua cartella in uno ZIP.",
      },
    },
    language: {
      title: "Lingua",
      intro: "Metadea è disponibile in spagnolo, inglese, tedesco, giapponese, italiano, francese, catalano e russo.",
      steps: {
        s1: "Apri Impostazioni › Preferenze › Lingua e premi il codice della tua lingua.",
        s2: "L'app si ricarica nella nuova lingua.",
      },
      tips: {
        t1: "Titoli e sinossi arrivano dalle loro fonti e restano nella lingua di quelle fonti.",
      },
    },
    shortcuts: {
      title: "Scorciatoie da tastiera",
      intro: "La maggior parte delle azioni ha una scorciatoia. L'elenco cambia in base alla schermata, così vedi sempre quelle che funzionano dove ti trovi.",
      steps: {
        s1: "Premi ? in qualsiasi schermata per mostrare o nascondere il riepilogo delle scorciatoie.",
        s2: "Il riepilogo le raggruppa in Generali, Pagina, Finestra e Lettore.",
        s3: "Impostazioni › Preferenze › Scorciatoie da tastiera mostra lo stesso elenco.",
      },
      tips: {
        t1: "Le scorciatoie non si possono ancora personalizzare.",
        t2: "Le scorciatoie non si attivano mentre scrivi in una casella di testo, tranne quelle pensate per questo (come Ctrl+S negli editor).",
      },
    },
    privacy: {
      title: "Uso offline e privacy",
      intro: "Metadea è pensato per funzionare senza internet. Libreria, progressi e impostazioni sono sul tuo computer; la rete si usa solo per le cose elencate qui sotto.",
      steps: {
        s1: "All'avvio, se sei online: il controllo degli aggiornamenti e il download dell'ultimo catalogo della community.",
        s2: "Quando cerchi o apri un'opera nuova: le richieste alle sue fonti (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "Quando salvi: la sincronizzazione con AniList e MyAnimeList, solo se li hai connessi.",
        s4: "Sincronizzazione del profilo e attività: solo con un account collegato a Google, e la sincronizzazione del profilo solo quando la confermi.",
      },
      tips: {
        t1: "Ogni fonte ha un limite di richieste; se lo raggiungi, Metadea aspetta e mostra un avviso.",
        t2: "Discord viene contattato solo in locale, sul tuo computer.",
      },
    },
    backup: {
      title: "Dove sono i tuoi dati e backup",
      intro: "Tutto è salvato in un database nella tua cartella utente (su Windows, %APPDATA%\\com.metadea.app). Un backup copia quella cartella in un unico file ZIP.",
      steps: {
        s1: "Apri Impostazioni › Backup e premi «Esporta dati». Salva lo ZIP fuori dalla cartella dei dati di Metadea.",
        s2: "Per ripristinare, premi «Importa dati» e scegli uno ZIP. Metadea salva prima una copia dei dati attuali accanto alla cartella, poi si riavvia per applicare il backup.",
        s3: "«Apri cartella» in Impostazioni › Ambiente › Percorsi locali apre la cartella dei dati.",
      },
      tips: {
        t1: "Nessun altro ha una copia della tua libreria: fai un backup prima dei grandi cambiamenti e di tanto in tanto.",
      },
    },
    updates: {
      title: "Aggiornamenti e manutenzione",
      intro: "Metadea controlla se ci sono nuove versioni all'avvio e chiede prima di installare qualsiasi cosa.",
      steps: {
        s1: "Quando c'è una nuova versione, una finestra ti chiede se installarla; l'app si riavvia per completare.",
        s2: "In Impostazioni › Novità, premi «Cerca aggiornamenti» per controllare subito.",
        s3: "Nella stessa scheda, «Sincronizza ora» scarica il catalogo della community e «Ripara ID» sistema i personaggi salvati con vecchi ID di TMDB.",
      },
      tips: {
        t1: "Senza internet il controllo viene saltato in silenzio e tutto il resto continua a funzionare.",
      },
    },
  },
};
