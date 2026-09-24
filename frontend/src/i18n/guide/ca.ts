import type { Translations } from '../types';

export const guideCa: Translations['guide'] = {
  page_title: "Guia d'usuari",
  page_subtitle: "Com funciona cada part de Metadea, des de la primera cerca fins a jugar, mirar, llegir i fer còpies de seguretat. Cerca un tema o tria'l de l'índex.",
  search_label: "Cerca a la guia",
  search_placeholder: "Cerca: reproductor, ROM, AniList…",
  search_clear: "Esborra la cerca",
  results_count: "{count} de {total} seccions",
  no_results_title: "No s'ha trobat res",
  no_results_body: "Cap secció parla de «{query}». Prova amb una paraula més curta o diferent.",
  toc_title: "Índex",
  steps_title: "Com s'utilitza",
  tips_title: "Consells",
  shortcuts_title: "Dreceres",
  open_settings: "Obre Ajustos › {tab}",
  open_settings_service: "Obre Ajustos › {tab} › {service}",
  open_page: "Obre {page}",
  back_to_top: "Torna a dalt",
  nav_link: "Guia d'usuari",
  sheet_link: "Obre la guia d'usuari",
  groups: {
    start: "Primers passos",
    discover: "Descobrir",
    library: "La teva biblioteca",
    play: "Jugar",
    watch: "Mirar, llegir i escoltar",
    integrations: "Integracions",
    customize: "Personalització",
    data: "Dades i privadesa",
  },
  keys: {
    next_page: "Pàgina següent",
    prev_page: "Pàgina anterior",
    next_chapter: "Capítol següent",
    prev_chapter: "Capítol anterior",
    font_size: "Text més gran / més petit",
    toc: "Índex",
    fullscreen: "Pantalla completa",
    close_reader: "Tanca el lector",
  },
  sections: {
    overview: {
      title: "Què és Metadea",
      intro: "Metadea és una biblioteca personal per a tot el que jugues, mires i llegeixes: videojocs, anime, manga, novel·les lleugeres, novel·les visuals, sèries, pel·lícules, llibres i còmics. Viu al teu ordinador i funciona sense connexió; internet només s'utilitza per buscar informació i per sincronitzar quan tu ho demanes.",
      steps: {
        s1: "Troba una obra amb el cercador (Ctrl+K) i obre'n la pàgina.",
        s2: "Fes clic a la portada per afegir-la a la biblioteca i definir-ne l'estat, el progrés, les dates i la qualificació.",
        s3: "Indica a Play les teves carpetes, llançadors i emuladors per obrir els jocs, vídeos i llibres des de Metadea.",
        s4: "Segueix el teu progrés a Inici i al teu perfil: estadístiques, preferits, llistes i historial.",
      },
      tips: {
        t1: "La teva biblioteca és una base de dades en aquest ordinador. Ningú més en té una còpia, així que fes-ne una còpia de seguretat de tant en tant (Ajustos › Còpia de seguretat).",
        t2: "Tots els ajustos de la guia de benvinguda es poden canviar més endavant a Ajustos.",
      },
    },
    navigation: {
      title: "Com moure't",
      intro: "La barra superior sempre hi és. Les fletxes van enrere i endavant, les icones de l'esquerra obren Inici, Play i Explora, els noms del centre obren la biblioteca filtrada per tipus i el grup de la dreta conté la cerca, les notificacions, el perfil i Ajustos.",
      steps: {
        s1: "Fes servir les fletxes ← i → de l'extrem esquerre, o Alt+← / Alt+→, per moure't per l'historial.",
        s2: "Fes clic en un tipus de contingut al centre de la barra (Anime, Manga, Videojocs…) per anar a aquella part de la biblioteca.",
        s3: "Prem de Ctrl+1 a Ctrl+6 per anar directament a Inici, Play, Perfil, Explora, Notificacions o Ajustos.",
        s4: "Prem ? a qualsevol pantalla per veure les dreceres que hi funcionen.",
      },
      tips: {
        t1: "A Explora i a Play, el centre de la barra es converteix en les pestanyes pròpies d'aquella pàgina.",
        t2: "En un Mac, el Ctrl d'aquestes dreceres és ⌘.",
      },
    },
    account: {
      title: "El teu compte",
      intro: "La primera vegada que obres Metadea només tries un nom d'usuari: la sessió és local i no es puja res. Més endavant la pots vincular a Google per tenir un perfil públic i veure l'activitat dels teus amics.",
      steps: {
        s1: "Per vincular una sessió local, fes servir «Vincular amb Google» a Inici.",
        s2: "Amb un compte vinculat, Inici et pregunta un cop al dia si vols sincronitzar el perfil; només es puja quan prems «Sincronitzar».",
        s3: "«Tancar sessió» és a la part inferior d'Ajustos › Aparença.",
      },
      tips: {
        t1: "Tancar la sessió només l'oblida: la biblioteca es queda en aquest ordinador.",
        t2: "«Ara no» amaga l'avís de sincronització fins a la propera visita a Inici.",
      },
    },
    home: {
      title: "Inici",
      intro: "Inici és el teu resum diari: què tens a mitges, què s'estrena aquest mes i què fan els teus amics.",
      steps: {
        s1: "El primer bloc mostra el que estàs mirant, llegint o jugant, agrupat per tipus. Fes servir + i − sobre una portada per sumar o restar un episodi o capítol sense obrir l'obra.",
        s2: "El calendari mostra les estrenes del mes. «Per a tu» només inclou obres de la teva biblioteca; «General» ho inclou tot. Filtra per tipus i canvia de mes amb les fletxes.",
        s3: "La columna de la dreta comença amb «Un dia com avui»: obres que vas acabar en aquesta mateixa data en anys anteriors.",
        s4: "A sota, el feed d'activitat alterna entre «Amics» i «General».",
        s5: "La franja de l’extrem dret mostra «Avui s’emet» (episodis de la teva biblioteca que surten avui) i «Continua on ho vas deixar»: l’últim que vas reproduir a Play, amb el temps que et queda. Fes-hi clic per continuar just on vas parar.",
      },
      tips: {
        t1: "Els blocs sense res a mostrar queden amagats, així que una biblioteca nova comença gairebé buida.",
        t2: "Uns segons després d'obrir-se, Metadea baixa les dades més recents de la comunitat i comprova si hi ha actualitzacions, i t'ho indica amb un avís.",
        t3: "Tornar a veure alguna cosa no canvia la data en què apareix a «Un dia com avui».",
      },
    },
    search: {
      title: "Cerca i cerca ràpida",
      intro: "Hi ha dues maneres de cercar: la cerca ràpida, que apareix sobre qualsevol pantalla, i la pàgina Explora, amb una pestanya per tipus de contingut. Primer apareixen els resultats del teu catàleg i després s'hi afegeixen els de les fonts en línia a mesura que responen.",
      steps: {
        s1: "Prem Ctrl+K o / (o la icona de la brúixola a la dreta de la barra superior) i escriu com a mínim dues lletres.",
        s2: "La cerca ràpida busca en tots els tipus alhora: obres, personatges, equip i usuaris, fins a sis per grup. Mou-te amb ↑ i ↓, obre amb Retorn o fes servir «Veure-ho tot».",
        s3: "A Explora, tria una pestanya per cercar un sol tipus. Cada tipus té la seva font: AniList per a anime, manga i novel·les lleugeres; IGDB per a videojocs i novel·les visuals; TMDB per a pel·lícules i sèries; Open Library per a llibres; Comic Vine per a còmics.",
        s4: "Obre un resultat per veure'n la pàgina i afegir-lo a la biblioteca.",
      },
      tips: {
        t1: "IGDB, TMDB i Comic Vine necessiten claus pròpies i gratuïtes. Sense elles, Explora mostra un avís amb un botó que et porta al lloc correcte d'Ajustos › Entorn.",
        t2: "Si una font falla o no tens connexió, continues veient el que ja hi ha al teu catàleg local.",
        t3: "Prem Ctrl+F a Explora per anar al quadre de cerca.",
      },
    },
    media_page: {
      title: "La pàgina d'una obra",
      intro: "Cada obra té una pàgina amb la portada, les dades, el teu progrés i diverses pestanyes de contingut relacionat. Gairebé tot es pot fer amb el teclat.",
      steps: {
        s1: "Fes clic a la portada (o prem E) per afegir l'obra a la biblioteca o editar la teva entrada.",
        s2: "Prem + o − per canviar el progrés, de l'1 al 9 per qualificar-la (el 0 és un 10) i F per marcar-la com a preferida.",
        s3: "Les pestanyes de sota mostren obres relacionades, edicions, recomanacions, temporades, episodis i temes d'obertura i tancament.",
        s4: "La secció «Usuaris» mostra les puntuacions dels amics d'AniList que segueixes, quan hi estàs connectat.",
        s5: "El botó d'enllaç (o L) copia un enllaç que obre aquesta pàgina a Metadea.",
      },
      tips: {
        t1: "Els jocs que són una edició d'un altre et porten al joc principal i ho indiquen al bàner.",
        t2: "Les teves captures d'un joc o episodi apareixen a la seva secció «Captures de pantalla».",
      },
    },
    editor: {
      title: "Editar la teva entrada",
      intro: "L'editor recull tota la teva relació amb una obra: estat, progrés, dates, qualificació, notes i més. S'obre fent clic a la portada o prement E.",
      steps: {
        s1: "Tria un estat amb les icones: pendent, en curs, completat, en pausa o abandonat.",
        s2: "Indica el progrés. Els videojocs i les novel·les visuals compten hores (H:MM); la resta compta episodis, capítols o volums. En arribar al total, l'obra queda completada.",
        s3: "Afegeix una qualificació, les dates d'inici i final (o la data de visualització per a les pel·lícules), fins a cinc etiquetes i notes personals.",
        s4: "Marca-la com a preferida, o com a «Platí» per als jocs que has completat al 100 %.",
        s5: "A «Historial mensual», tria el mes que representa aquesta obra; cada mes en té una sola.",
        s6: "Desa amb Ctrl+S. Ctrl+Z i Ctrl+Y desfan i refan.",
      },
      tips: {
        t1: "«Importar dades del teu perfil d'AniList» omple el progrés i les dates a partir d'AniList.",
        t2: "Un cop completada, «Comparteix» crea una imatge vertical amb la portada, la teva qualificació i el teu avatar.",
        t3: "Les teves notes es converteixen en ressenyes a la pestanya «Ressenyes» del teu perfil.",
      },
    },
    rewatch: {
      title: "Tornar a veure, rellegir i rejugar",
      intro: "Quan tornes a una cosa que ja havies acabat, Metadea compta la repetició sense perdre les dates originals.",
      steps: {
        s1: "Obre l'editor d'una obra completada i prem el botó de repetició («Tornar a veure», «Rellegir» o «Rejugar»).",
        s2: "El progrés torna a zero i l'estat passa a en curs; es conserven les dates de la primera vegada.",
        s3: "Quan la tornes a completar, el comptador «Vegades repetit» puja una unitat.",
      },
      tips: {
        t1: "Torna a prémer el botó abans d'acabar per cancel·lar la repetició sense comptar-la.",
        t2: "Les targetes de la biblioteca mostren ×2, ×3… i les estadístiques compten les hores de cada vegada.",
      },
    },
    sagas: {
      title: "Sagues, temporades i relacions",
      intro: "Les obres que van juntes —seqüeles, preqüeles, spin-offs, temporades— estan enllaçades, així pots veure una franquícia sencera i quanta n'has acabat.",
      steps: {
        s1: "Prem «Ordre de la saga» a la pàgina d'una obra per veure tota la franquícia en ordre. «Ets aquí» marca l'obra actual i la pestanya «Arcs Argumentals» divideix les sèries llargues en arcs.",
        s2: "La barra de progrés de la saga t'indica quantes obres de la saga has completat; les que encara no s'han estrenat no compten.",
        s3: "La pestanya «Relacionats» llista cada relació amb el seu tipus (seqüela, adaptació, spin-off…).",
      },
      tips: {
        t1: "Amb «Unificar temporades» activat (Ajustos › Preferències), les temporades d'un anime s'agrupen en una sola targeta de la biblioteca i la pàgina mostra una pestanya «Temporades».",
        t2: "La barra de la saga només apareix quan n'has completat almenys una part.",
      },
    },
    characters: {
      title: "Personatges i equip",
      intro: "Els personatges i els creadors tenen pàgina pròpia, accessible des del repartiment d'una obra o des de la cerca.",
      steps: {
        s1: "La pàgina d'un personatge mostra la biografia, les obres on apareix i els seus actors de veu.",
        s2: "Marca un personatge com a preferit per afegir-lo als personatges preferits del teu perfil.",
        s3: "La pàgina d'un membre de l'equip llista les seves obres i dates.",
      },
      tips: {
        t1: "La cerca ràpida també troba personatges i equip: escriu el nom i mira els seus grups.",
      },
    },
    community: {
      title: "Catàleg de la comunitat i propostes",
      intro: "Metadea comparteix un catàleg de la comunitat: dades afegides i corregides pels usuaris, revisades a GitHub. La teva còpia s'actualitza cada cop que obres l'aplicació i pots proposar canvis des de la pàgina de qualsevol obra.",
      steps: {
        s1: "Connecta GitHub a Ajustos › Connexions.",
        s2: "A la pàgina d'una obra, prem el botó + del bàner (o P) per obrir l'editor de propostes.",
        s3: "Canvia títols, sinopsi, dates, recomptes, enllaços, imatges, gèneres, plataformes, personatges, relacions, episodis, temes, arcs argumentals o l'ordre de la saga. Pots editar diverses obres en la mateixa sessió.",
        s4: "Prem «Envia la proposta»: es converteix en una pull request que es revisa abans d'arribar a tothom.",
      },
      tips: {
        t1: "Ajustos › Novetats › «Sincronitzar ara» baixa el catàleg quan vulguis.",
        t2: "Ajustos › Admin › Editor de catàleg mostra el teu catàleg local; per editar el compartit cal tenir permís d'escriptura al repositori.",
      },
    },
    statuses: {
      title: "La teva biblioteca: estats i progrés",
      intro: "La biblioteca, al teu perfil, agrupa cada tipus per estat perquè vegis d'un cop d'ull què tens pendent, en curs o acabat.",
      steps: {
        s1: "Obre un tipus des de la barra superior o des de la pestanya «Biblioteca» del teu perfil.",
        s2: "Seccions: Pendents, En curs, En emissió (en curs i encara s'està publicant), Completades, En pausa i Abandonades.",
        s3: "Filtra per nom, format, estat o dates, ordena per qualificació, data o durada, i agrupa per saga o paquet.",
        s4: "Prem Ctrl+F per cercar dins de la biblioteca.",
      },
      tips: {
        t1: "Els botons + i − d'Inici i les tecles +/− de la pàgina de l'obra actualitzen el progrés sense obrir l'editor.",
      },
    },
    ratings: {
      title: "Qualificacions",
      intro: "Tria com t'agrada puntuar: 5 estrelles, un 10 amb dos decimals, un 10 sencer o tres cares. Fins i tot pots tenir dues qualificacions alhora.",
      steps: {
        s1: "A Ajustos › Preferències › Sistema de Puntuació, tria l'escala que vulguis.",
        s2: "Activa «Doble qualificació» per tenir una segona puntuació amb nom i escala propis (per exemple, Història i Visuals).",
        s3: "Qualifica des de l'editor, o prem de l'1 al 9 (0 = 10) a la pàgina d'una obra.",
      },
      tips: {
        t1: "Amb la doble qualificació, un selector a la biblioteca tria quina de les dues puntuacions es mostra.",
        t2: "En sincronitzar amb AniList, la teva puntuació es converteix a l'escala del teu compte d'AniList.",
        t3: "«Elimina qualificacions» a Ajustos › Preferències esborra totes les qualificacions després de demanar-te confirmació.",
      },
    },
    favorites_lists: {
      title: "Preferits, Hall of Fame i llistes",
      intro: "Els preferits i les llistes et permeten mostrar el que més t'importa, en l'ordre que triïs.",
      steps: {
        s1: "Marca obres i personatges com a preferits; el botó de la corona també afegeix una obra als preferits generals «Multimèdia».",
        s2: "A la pestanya «Preferits», arrossega per reordenar i posa una imatge personalitzada a qualsevol preferit.",
        s3: "Les teves 10 obres i els teus 10 personatges preferits formen el Hall of Fame del teu perfil.",
        s4: "A «Llistes», crea llistes d'obres, personatges o episodis; fes-les privades o de rànquing i ordena-les a mà, alfabèticament o per data d'estrena.",
      },
      tips: {
        t1: "Les llistes es poden reordenar arrossegant-les.",
      },
    },
    tier_lists: {
      title: "Tier lists",
      intro: "Classifica obres o personatges a l'estil TierMaker: files de la S a la F que pots reanomenar, acolorir, afegir, treure i reordenar.",
      steps: {
        s1: "Obre Tier list a la barra de navegació i crea una llista d'obres o de personatges.",
        s2: "Omple el banc d'elements des de la biblioteca (filtres o emplenaments ràpids com «tot el completat del 2024»), les teves llistes i sagues, els teus personatges o una cerca.",
        s3: "Arrossega les portades a les files, o selecciona'n diverses i prem 1–9. Fes doble clic en una portada per tornar-la al banc.",
      },
      tips: {
        t1: "Cada canvi es desa sol i Ctrl+Z el desfà. «Desar com a imatge» exporta el tauler en PNG i «Mostrar al meu perfil» la mostra a la pestanya Llistes del teu perfil.",
      },
    },
    stats: {
      title: "Estadístiques i historial",
      intro: "La pestanya «Estadístiques» del teu perfil converteix la biblioteca en números: quant n'has acabat, quantes hores, quins gèneres i com qualifiques.",
      steps: {
        s1: "Les targetes de dalt resumeixen obres, temporades, hores totals, puntuació mitjana i obres qualificades.",
        s2: "A sota tens el repartiment per estat, el temps per categoria, els gèneres preferits, la distribució de puntuacions, les obres completades per any i un mapa d'activitat de sis mesos.",
        s3: "La calculadora de pendents estima quant de temps necessitaries per acabar el que tens pendent, amb o sense el que tens en curs.",
        s4: "La pestanya «Perfil» mostra el teu historial mensual (una portada per mes) i l'activitat recent.",
      },
      tips: {
        t1: "Les repeticions compten: una sèrie vista dues vegades suma les seves hores dues vegades.",
      },
    },
    social: {
      title: "Amics i notificacions",
      intro: "Amb un compte vinculat pots seguir altres persones, veure la seva activitat i visitar els seus perfils. Els recordatoris d'estrenes arriben com a notificacions del sistema.",
      steps: {
        s1: "A la pestanya «Amics» del teu perfil, mira a qui segueixes i qui et segueix.",
        s2: "Obre el perfil d'algú per veure la seva biblioteca en mode de només lectura i seguir-lo.",
        s3: "El feed d'activitat d'Inici mostra què fan els teus amics.",
      },
      tips: {
        t1: "Metadea envia notificacions del sistema per a les estrenes d'avui de les obres que tens pendents, per als anime en emissió que segueixes i per als nous episodis o capítols del que estàs mirant o llegint.",
        t2: "La pàgina de Notificacions encara s'està construint.",
      },
    },
    local_folders: {
      title: "Carpetes locals",
      intro: "Play troba els teus fitxers buscant en una carpeta per a cada tipus de contingut. Metadea associa cada fitxer o subcarpeta amb una obra del teu catàleg.",
      steps: {
        s1: "A Ajustos › Entorn › Rutes locals, tria una carpeta per a cada tipus (anime, sèries, pel·lícules, manga, còmics, llibres…).",
        s2: "Per als jocs també pots fer servir «Afegir carpeta» a la capçalera de Play; cada subcarpeta compta com un joc.",
        s3: "Obre Play: els fitxers associats apareixen amb la portada i les dades de l'obra.",
        s4: "Si alguna cosa no es reconeix, fes servir «Localitza manualment» i després «Reanomena per a la detecció automàtica» perquè la propera vegada es trobi sola.",
      },
      tips: {
        t1: "L'associació ignora accents i signes de puntuació i respecta els números de temporada dels noms.",
        t2: "Entre els fitxers compatibles hi ha mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz i cbr.",
        t3: "Prem Ctrl+F a Play per cercar a la teva biblioteca local.",
      },
    },
    pc_launchers: {
      title: "Jocs de PC: Steam, Epic, GOG, Xbox i EA",
      intro: "Play detecta els jocs que tens instal·lats des dels principals llançadors de PC, sense configurar res.",
      steps: {
        s1: "Obre Play › Videojocs: la primera visita escaneja Steam, Epic Games, GOG, l'aplicació d'Xbox i EA.",
        s2: "Les visites següents només tornen a escanejar els llançadors que han canviat; «Escanejar de nou» força un escaneig complet.",
        s3: "Afegeix la teva Steam Web API key a Ajustos › Entorn per obtenir també el temps jugat, l'última partida i els jocs que tens però no estan instal·lats.",
      },
      tips: {
        t1: "Si no apareixen els jocs d'un llançador, «Diagnòstic» mostra què ha trobat Metadea.",
      },
    },
    roms: {
      title: "Emuladors i ROM",
      intro: "Metadea pot acollir la teva col·lecció retro: llegeix les carpetes de ROM, n'endreça els noms, reconeix cada joc i l'obre amb l'emulador adequat.",
      steps: {
        s1: "A Ajustos › Emuladors, tria una empresa i una consola.",
        s2: "Tria l'emulador i el seu executable, els arguments d'inici ({ROM} se substitueix pel fitxer) i la carpeta de ROM.",
        s3: "Obre Play › Videojocs: les teves ROM apareixen amb noms nets i dades d'IGDB.",
      },
      tips: {
        t1: "«Netejar noms de ROM automàticament» reanomena els fitxers amb un format endreçat (i també les partides desades). Un avís et permet desfer-ho durant uns segons.",
        t2: "Les ROM de GameCube, Wii, DS i 3DS es reconeixen per l'ID de la capçalera; les actualitzacions i els DLC de Switch s'agrupen sota el joc base.",
        t3: "Si una ROM s'associa amb el joc equivocat, fes servir el llapis («Canviar joc a IGDB») al seu panell de detalls.",
      },
    },
    metadata: {
      title: "Obtenir metadades",
      intro: "El botó «Metadades» de Play baixa d'una sola vegada portades, bàners i informació dels teus jocs.",
      steps: {
        s1: "Obre Play › Videojocs i prem «Metadades» a la part inferior de la llista de plataformes.",
        s2: "Tria «Bàsic» (portada, bàner, gèneres, sinopsi, data, editorial), «Assoliments de Steam» o totes dues opcions.",
        s3: "Segueix la finestra de progrés; pots cancel·lar en qualsevol moment.",
      },
      tips: {
        t1: "Funciona amb jocs de Steam, GOG i ROM. Els assoliments de Steam necessiten la teva Steam Web API key.",
        t2: "Les dades dels jocs venen d'IGDB, així que les seves claus han d'estar configurades a Ajustos › Entorn.",
      },
    },
    achievements: {
      title: "Assoliments",
      intro: "El panell de detalls d'un joc a Play té una pestanya d'assoliments: assoliments de Steam per als jocs de Steam i RetroAchievements per a les teves ROM.",
      steps: {
        s1: "Per a Steam, afegeix la teva Steam Web API key i executa «Metadades» › «Assoliments de Steam».",
        s2: "Per a les ROM, afegeix el teu usuari i la Web API key de RetroAchievements a Ajustos › Entorn.",
        s3: "Obre una ROM a Play: Metadea la vincula al seu conjunt de RetroAchievements pel hash del fitxer o, si no ho aconsegueix, pel títol.",
        s4: "Si tria el conjunt equivocat, fes servir «Vincula manualment» o «Desvincula».",
      },
      tips: {
        t1: "Els assoliments es desen a la memòria cau, així que els pots veure sense connexió.",
        t2: "Després d'una sessió, un avís t'indica quants assoliments has desbloquejat.",
        t3: "Les consoles sense conjunts de RetroAchievements (3DS, Wii, Wii U, Switch, PC…) no mostren el panell.",
      },
    },
    screenshots: {
      title: "Captures de pantalla",
      intro: "La secció «Captures de pantalla» d'una obra reuneix les seves captures d'Imatges › Metadea › <obra> i, als jocs de Steam, les teves captures de Steam.",
      steps: {
        s1: "Prem F12 al reproductor integrat per desar un fotograma. Es guarda a Imatges › Metadea › <obra>, amb l'episodi i el minut al nom.",
        s2: "Al lector de còmics, fes clic dret en una pàgina i tria «Desa la pàgina (PNG)».",
        s3: "Als emuladors, fes captures com sempre: mentre s'executa un joc iniciat des de Metadea, cada captura es mou a Imatges › Metadea › <joc> i un avís ho confirma.",
      },
      tips: {
        t1: "La carpeta de captures de l'emulador es detecta automàticament per a Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu, PPSSPP, Cemu i RPCS3; per a altres emuladors, indica-la a Ajustos › Emuladors (avançat).",
        t2: "Les captures d'un joc que ja eren a la carpeta de l'emulador s'hi mouen la primera vegada que obres el joc.",
      },
    },
    launching: {
      title: "Obrir jocs i temps jugat",
      intro: "El botó «Jugar» inicia qualsevol joc de la teva biblioteca local, i Metadea compta el temps que passes jugant.",
      steps: {
        s1: "Obre un joc a Play i prem «Jugar».",
        s2: "Els jocs de Steam, Epic i GOG s'obren amb el seu llançador; les ROM s'obren amb l'emulador configurat per a la seva consola.",
        s3: "Metadea vigila el procés del joc i suma cada sessió a les teves hores de la biblioteca.",
      },
      tips: {
        t1: "Les sessions de menys de 15 segons no compten.",
        t2: "Si el botó d'una ROM està desactivat, la seva consola encara no té emulador (Ajustos › Emuladors).",
        t3: "Mentre jugues, Discord mostra el joc (i el teu progrés de RetroAchievements per a les ROM).",
      },
    },
    player: {
      title: "El reproductor de vídeo",
      intro: "Els episodis i les pel·lícules locals es reprodueixen al reproductor integrat de Metadea (libmpv), que desa el progrés tot sol.",
      steps: {
        s1: "No cal instal·lar res: el reproductor (libmpv) ve amb Metadea.",
        s2: "Tria els controls: superposats al vídeo o en una barra fixa a sota.",
        s3: "Prem «Reproduir» en un episodi de Play. La resta de la temporada es posa a la cua; prem Q per veure-la.",
        s4: "Fes servir els menús per canviar la pista d'àudio, els subtítols i la velocitat (de 0,25× a 1×: més lent, mai més ràpid).",
        s5: "Al 80 %, l'episodi es marca com a vist: s'actualitzen l'estat, el progrés i AniList. Un avís et permet desfer-ho.",
        s6: "Si tanques abans del 80 %, el següent «Reproduir» reprèn al segon exacte.",
      },
      tips: {
        t1: "Fes clic al vídeo per posar-lo en pausa i doble clic per a la pantalla completa.",
        t2: "Si no es pot carregar libmpv, Metadea t'ho diu en lloc d'obrir el vídeo.",
        t3: "Acabar l'últim episodi completa l'obra i afegeix la seva seqüela als teus pendents.",
        t4: "Discord mostra què estàs mirant amb un compte enrere del temps que queda.",
      },
    },
    player_shortcuts: {
      title: "Dreceres del reproductor",
      intro: "Al reproductor integrat tot es pot fer amb el teclat. Prem ? mentre està obert per veure aquesta llista.",
      steps: {
        s1: "Espai posa en pausa; les fletxes avancen o retrocedeixen 5 s (30 s amb Maj) i canvien el volum.",
        s2: "N i P (o Ctrl+→ i Ctrl+←) passen a l'episodi següent o anterior.",
        s3: ", i . avancen fotograma a fotograma; [ redueix la velocitat; D activa o desactiva el mode nocturn (diàlegs clars).",
        s4: "Les tecles numèriques salten al 10 %, 20 %… del vídeo.",
      },
      tips: {
        t1: "Esc tanca, en aquest ordre: els menús oberts, la pantalla completa i després el reproductor.",
      },
    },
    skip_segments: {
      title: "Saltar obertures i tancaments",
      intro: "El reproductor integrat detecta obertures, tancaments, resums i avançaments perquè te'ls puguis saltar.",
      steps: {
        s1: "A Ajustos › Preferències › Reproductor de vídeo, tria com: mostrar un botó, saltar automàticament o no detectar.",
        s2: "Amb el botó, prem-lo (o S) quan aparegui.",
        s3: "En mode automàtic, un avís diu què s'ha saltat i ofereix «Desfés».",
      },
      tips: {
        t1: "Els segments surten dels capítols del fitxer (MKV) i, per a l'anime, d'AniSkip; quan hi ha tots dos, manen els capítols.",
      },
    },
    reader_comics: {
      title: "Llegir còmics i manga",
      intro: "Els fitxers CBZ, CBR i PDF s'obren al lector de Metadea, que recorda la pàgina on et vas quedar.",
      steps: {
        s1: "Obre el fitxer des de Play.",
        s2: "Passa les pàgines amb les fletxes, Espai o fent clic a la banda esquerra o dreta de la pàgina. Les pàgines dobles es mostren una al costat de l'altra, amb la portada sola.",
        s3: "Fes clic dret en una pàgina per afegir un marcador, veure els teus marcadors o desar la pàgina com a imatge.",
        s4: "En arribar a l'última pàgina es marca com a llegit i s'actualitza la biblioteca.",
      },
      tips: {
        t1: "La pàgina es desa cada cop que la passes.",
        t2: "«Posar en pausa» tanca el lector però conserva la sessió en una barra perquè la puguis reprendre més tard.",
      },
    },
    reader_epub: {
      title: "Llegir llibres EPUB",
      intro: "Els llibres EPUB tenen el seu propi lector, amb controls de tipografia, índex, marcadors i progrés.",
      steps: {
        s1: "Obre el llibre des de Play.",
        s2: "A «Tipografia», tria la font, la mida, l'interlineat, els marges, el tema de color (Paper, Sèpia, Fosc, Negre) i la justificació.",
        s3: "Tria el mode «Pàgines» o «Desplaçament».",
        s4: "Prem T per a l'índex i fes servir «Afegeix un marcador aquí» per marcar un punt.",
        s5: "El percentatge mostra fins on has arribat; al 98 % el llibre compta com a llegit.",
      },
      tips: {
        t1: "«Usa els estils de l'editor» respecta el disseny propi del llibre.",
        t2: "El progrés se sincronitza amb la biblioteca i amb AniList quan l'acabes.",
      },
    },
    themes_jukebox: {
      title: "Obertures, tancaments i la gramola",
      intro: "Les pàgines d'anime inclouen els temes d'obertura i tancament. Marca amb una estrella els que t'agradin i sonaran a la gramola des de qualsevol pantalla.",
      steps: {
        s1: "Obre un tema des de la pestanya «Temes» d'una obra (o prem T). Canvia entre versions (v1, v2…) i passa a l'anterior o al següent.",
        s2: "Prem l'estrella («Afegir a la gramola») per desar-lo.",
        s3: "Obre la gramola amb el botó rodó de baix a la dreta: el disc que gira mostra la portada i es posa en pausa si hi fas clic.",
        s4: "Fes servir anterior/següent, la barra de progrés, el volum, l'ordre aleatori i la repetició (desactivada, cua o aquest tema).",
      },
      tips: {
        t1: "La gramola es posa en pausa sola quan s'obre el reproductor, quan comença un vídeo local, quan s'obre un tema a la pàgina d'una obra o quan sona un altre àudio.",
        t2: "Les tecles multimèdia del teclat la controlen, i recorda el volum, l'ordre aleatori, la repetició i l'últim tema.",
        t3: "Els vídeos dels temes venen d'animethemes.moe, així que necessiten connexió.",
      },
    },
    api_keys: {
      title: "Claus API: per a què serveix cadascuna",
      intro: "Algunes fonts necessiten una clau gratuïta que crees al teu propi compte. Totes són opcionals: configura només les del que facis servir.",
      steps: {
        s1: "Obre Ajustos › Entorn i fes clic al logotip d'un servei.",
        s2: "Prem el botó (i) per veure com aconseguir aquella clau, enganxa-la i prem Desa.",
        s3: "IGDB: videojocs, novel·les visuals i les dades de les teves ROM. TMDB: pel·lícules i sèries. Comic Vine: còmics. Steam: temps jugat i assoliments.",
        s4: "AniList i MyAnimeList: un Client ID per connectar el teu compte (la cerca d'AniList funciona sense). RetroAchievements: usuari i Web API key.",
      },
      tips: {
        t1: "A Windows, les claus es guarden xifrades a la base de dades de Metadea.",
        t2: "API-Sports serveix per a esdeveniments esportius, un tipus que de moment està desactivat.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Connecta AniList per importar la teva llista d'anime i manga i mantenir-la sincronitzada: cada canvi que desis a Metadea s'envia a AniList.",
      steps: {
        s1: "Crea una aplicació a AniList i enganxa'n el Client ID a Ajustos › Entorn › AniList.",
        s2: "A Ajustos › Connexions prem «Connectar», autoritza Metadea al navegador i enganxa el codi que et dona.",
        s3: "Prem «Importa» i tria els formats (TV, pel·lícules, OVA, manga, novel·les lleugeres…).",
        s4: "«Importa» només afegeix el que encara no tens; «Sincronitzar» també actualitza el que ja tens amb les dades d'AniList.",
      },
      tips: {
        t1: "Desar des de l'editor, el reproductor, el lector o Inici envia el canvi a AniList automàticament.",
        t2: "AniList permet 60 peticions per minut; si arribes al límit, Metadea espera i t'ho diu.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList es connecta amb un inici de sessió al navegador i rep en segon pla els teus canvis d'anime, manga i novel·les lleugeres.",
      steps: {
        s1: "Crea una aplicació API a MyAnimeList amb metadea://auth/mal com a URL de redirecció i enganxa'n el Client ID a Ajustos › Entorn › MyAnimeList (no cal el secret).",
        s2: "A Ajustos › Connexions prem «Connectar»: s'obre el navegador i et torna a Metadea.",
        s3: "Si el navegador no et torna, enganxa l'adreça metadea://auth/mal?code=… al quadre i prem «Completar la connexió».",
        s4: "«Importar» porta la teva llista de MAL i l'associa amb AniList; el que no troba parella es llista a part.",
      },
      tips: {
        t1: "Els canvis s'envien a MAL cada vegada que deses, igual que amb AniList. Les obres sense id de MAL s'ometen.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea mostra el teu progrés de RetroAchievements al costat de les ROM. Només el mostra: els assoliments es desbloquegen jugant en un emulador amb RetroAchievements activat.",
      steps: {
        s1: "A retroachievements.org, obre la teva configuració i copia la teva Web API key.",
        s2: "A Ajustos › Entorn › RetroAchievements, introdueix el teu nom d'usuari i la clau, i desa.",
        s3: "Activa RetroAchievements al teu emulador amb el mateix compte.",
        s4: "Obre una ROM a Play per veure'n el conjunt, el teu progrés i cada assoliment.",
      },
      tips: {
        t1: "Els jocs es reconeixen pel hash de la ROM, com fan els emuladors, així que un dump net és el que millor funciona.",
        t2: "Sense connexió veus les últimes dades de la memòria cau.",
      },
    },
    discord: {
      title: "Discord",
      intro: "Si Discord està obert, el teu perfil mostra què fas a Metadea: jugar, mirar, escoltar un tema, llegir o consultar una obra.",
      steps: {
        s1: "Obre Discord en aquest ordinador; Metadea el troba sol, encara que l'obris més tard.",
        s2: "Posa un joc, un vídeo o un tema, o obre un llibre o la pàgina d'una obra: el teu estat canvia en conseqüència.",
        s3: "Les obres que consultes inclouen un botó «Open in Metadea» perquè els teus amics també les puguin obrir.",
      },
      tips: {
        t1: "No hi ha cap interruptor a Metadea: per amagar-ho, tanca Discord o desactiva la compartició d'activitat a la configuració del mateix Discord.",
        t2: "Els vídeos mostren l'episodi i un compte enrere del temps que queda; els jocs d'emulador afegeixen el teu progrés de RetroAchievements.",
      },
    },
    deep_links: {
      title: "Enllaços i compartir",
      intro: "Els enllaços de Metadea obren una pàgina directament a l'aplicació, fins i tot des d'un navegador o un xat.",
      steps: {
        s1: "A la pàgina d'una obra, prem el botó d'enllaç (o L) per copiar-ne l'enllaç.",
        s2: "Comparteix-lo: quan algú que té Metadea l'obre, l'aplicació s'obre en aquella obra.",
        s3: "Els enllaços que comencen per metadea:// obren directament obres, personatges, perfils o Inici.",
      },
      tips: {
        t1: "Els enllaços compartits passen per una petita pàgina web que lliura l'enllaç a Metadea, així que també funcionen en aplicacions que no obren enllaços metadea://.",
      },
    },
    github: {
      title: "GitHub i altres connexions",
      intro: "GitHub serveix per proposar canvis al catàleg de la comunitat. Només necessita permís per obrir pull requests en repositoris públics.",
      steps: {
        s1: "A Ajustos › Connexions › Comunitat i perfil, prem «Connectar» al costat de GitHub.",
        s2: "Copia el codi que mostra Metadea, obre github.com/login/device i enganxa'l.",
        s3: "De tornada a Metadea, l'editor de propostes està disponible a totes les obres.",
      },
      tips: {
        t1: "Ajustos › Connexions també mostra VNDB per a novel·les visuals, que arribarà aviat.",
      },
    },
    appearance: {
      title: "Aparença i perfil",
      intro: "Fes teus Metadea i el teu perfil: fons, color d'accent, font del nom, avatar, bàner i biografia.",
      steps: {
        s1: "A Ajustos › Aparença, tria un fons dinàmic (n'hi ha 14, de Nebula a Blueprint).",
        s2: "Tria un color d'accent o restaura el predeterminat.",
        s3: "Escriu el nom que vols mostrar i prova les fonts amb les fletxes.",
        s4: "Puja un avatar, una foto quadrada per a les imatges compartides i un bàner, i escriu una biografia.",
      },
      tips: {
        t1: "La foto quadrada només s'utilitza a les imatges que comparteixes; si és buida, es fa servir l'avatar.",
      },
    },
    ui_themes: {
      title: "Temes de la interfície (skins)",
      intro: "Les skins canvien l'estil de tot Metadea. Són carpetes amb un fitxer theme.json i, opcionalment, CSS, que pots fer tu mateix o aconseguir d'altres persones.",
      steps: {
        s1: "A Ajustos › Plugins › Temes d'interfície, prem «Obrir la carpeta de temes».",
        s2: "Copia-hi la carpeta d'un tema (o prem «Crear tema d'exemple») i prem «Recarregar».",
        s3: "Prem «Activar» al tema que vulguis. Es manté actiu després de reiniciar.",
        s4: "Si en fas un de propi, activa «Vigilar canvis» per veure les teves modificacions cada dos segons.",
      },
      tips: {
        t1: "Els temes «Només variables» només canvien colors, radis i velocitats, i són segurs. Els temes «CSS complet» poden canviar qualsevol cosa i podrien espatllar una pantalla.",
        t2: "Si un tema deixa alguna cosa inservible, prem Ctrl+Maj+T a qualsevol lloc per desactivar-lo.",
        t3: "Els temes no poden carregar res d'internet; per compartir-ne un, comprimeix-ne la carpeta en un ZIP.",
      },
    },
    language: {
      title: "Idioma",
      intro: "Metadea està disponible en castellà, anglès, alemany, japonès, italià, francès, català i rus.",
      steps: {
        s1: "Obre Ajustos › Preferències › Idioma i prem el codi del teu idioma.",
        s2: "L'aplicació es torna a carregar en el nou idioma.",
      },
      tips: {
        t1: "Els títols i les sinopsis venen de les seves fonts i mantenen l'idioma d'aquestes fonts.",
      },
    },
    shortcuts: {
      title: "Dreceres de teclat",
      intro: "La majoria d'accions tenen una drecera. La llista canvia amb cada pantalla, així sempre veus les que funcionen allà on ets.",
      steps: {
        s1: "Prem ? a qualsevol pantalla per mostrar o amagar el full de dreceres.",
        s2: "El full les agrupa en Generals, Pàgina, Finestra i Reproductor.",
        s3: "Ajustos › Preferències › Dreceres de teclat mostra la mateixa llista.",
      },
      tips: {
        t1: "Encara no es poden personalitzar les dreceres.",
        t2: "Les dreceres no s'activen mentre escrius en un quadre de text, excepte les pensades per a això (com Ctrl+S als editors).",
      },
    },
    privacy: {
      title: "Ús sense connexió i privadesa",
      intro: "Metadea està pensat per funcionar sense internet. La biblioteca, el progrés i els ajustos són al teu ordinador; la xarxa només s'utilitza per a les coses que s'indiquen a continuació.",
      steps: {
        s1: "En obrir l'aplicació, si tens connexió: la comprovació d'actualitzacions i la baixada del catàleg de la comunitat més recent.",
        s2: "Quan cerques o obres una obra nova: consultes a les seves fonts (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "Quan deses: la sincronització amb AniList i MyAnimeList, només si els has connectat.",
        s4: "Sincronització del perfil i activitat: només amb un compte vinculat a Google, i la del perfil només quan la confirmes.",
      },
      tips: {
        t1: "Cada font té un límit de peticions; si hi arribes, Metadea espera i mostra un avís.",
        t2: "Amb Discord només es comunica en local, al teu propi ordinador.",
      },
    },
    backup: {
      title: "On són les teves dades i còpies de seguretat",
      intro: "Tot es desa en una base de dades a la teva carpeta d'usuari (a Windows, %APPDATA%\\com.metadea.app). Una còpia de seguretat és un únic fitxer .7z amb aquesta base de dades, les imatges personalitzades i les skins; les memòries cau queden fora perquè es tornen a baixar.",
      steps: {
        s1: "Obre Ajustos › Còpia de seguretat i prem «Crea una còpia». Desa el .7z fora de la carpeta de dades de Metadea.",
        s2: "Per restaurar, prem «Restaura des d'un fitxer» i tria un .7z (o un .zip de versions anteriors). Metadea comprova cada fitxer, desa una còpia de les dades actuals al costat de la carpeta i es reinicia per aplicar la còpia.",
        s3: "«Obrir carpeta» a Ajustos › Entorn › Rutes locals obre la carpeta de dades.",
        s4: "Vincula Google Drive a la mateixa pestanya per pujar còpies a una carpeta privada de l'app, al moment o automàticament cada dia o cada setmana; pots restaurar-ne qualsevol des de la llista.",
      },
      tips: {
        t1: "Ningú més té una còpia de la teva biblioteca: fes una còpia de seguretat abans de canvis grans i de tant en tant.",
      },
    },
    updates: {
      title: "Actualitzacions i manteniment",
      intro: "Metadea comprova si hi ha versions noves en obrir-se i pregunta abans d'instal·lar res.",
      steps: {
        s1: "Quan hi ha una versió nova, un diàleg et pregunta si la vols instal·lar; l'aplicació es reinicia per acabar.",
        s2: "A Ajustos › Novetats, prem «Cercar actualitzacions» per comprovar-ho ara.",
        s3: "A la mateixa pestanya, «Sincronitzar ara» baixa el catàleg de la comunitat i «Reparar IDs» corregeix els personatges desats amb IDs antics de TMDB.",
      },
      tips: {
        t1: "Sense internet, la comprovació s'omet en silenci i tota la resta continua funcionant.",
      },
    },
  },
};
