import type { Translations } from '../types';

// Guide d'utilisation (/guide). Même structure que guide/en.ts, la locale de référence.
export const guideFr: Translations['guide'] = {
  page_title: "Guide d'utilisation",
  page_subtitle: "Le fonctionnement de chaque partie de Metadea, de la première recherche jusqu'à jouer, regarder, lire et sauvegarder. Cherchez un sujet ou choisissez-en un dans le sommaire.",
  search_label: "Rechercher dans le guide",
  search_placeholder: "Rechercher : lecteur, ROM, AniList…",
  search_clear: "Effacer la recherche",
  results_count: "{count} sections sur {total}",
  no_results_title: "Aucun résultat",
  no_results_body: "Aucune section ne mentionne « {query} ». Essayez un mot plus court ou différent.",
  toc_title: "Sommaire",
  steps_title: "Mode d'emploi",
  tips_title: "Astuces",
  shortcuts_title: "Raccourcis",
  open_settings: "Ouvrir Paramètres › {tab}",
  open_settings_service: "Ouvrir Paramètres › {tab} › {service}",
  open_page: "Ouvrir {page}",
  back_to_top: "Retour en haut",
  nav_link: "Guide d'utilisation",
  sheet_link: "Ouvrir le guide d'utilisation",
  groups: {
    start: "Premiers pas",
    discover: "Découvrir",
    library: "Votre bibliothèque",
    play: "Play",
    watch: "Regarder, lire et écouter",
    integrations: "Intégrations",
    customize: "Personnalisation",
    data: "Données et confidentialité",
  },
  keys: {
    next_page: "Page suivante",
    prev_page: "Page précédente",
    next_chapter: "Chapitre suivant",
    prev_chapter: "Chapitre précédent",
    font_size: "Agrandir / réduire le texte",
    toc: "Table des matières",
    fullscreen: "Plein écran",
    close_reader: "Fermer le lecteur",
  },
  sections: {
    overview: {
      title: "Qu'est-ce que Metadea",
      intro: "Metadea est une bibliothèque personnelle pour tout ce que vous jouez, regardez et lisez : jeux, anime, manga, light novels, visual novels, séries, films, livres et comics. Elle vit sur votre ordinateur et fonctionne hors ligne ; Internet ne sert qu'à rechercher des informations et à synchroniser quand vous le demandez.",
      steps: {
        s1: "Trouvez une œuvre avec la recherche (Ctrl+K) et ouvrez sa page.",
        s2: "Cliquez sur la jaquette pour l'ajouter à votre bibliothèque et définir son statut, votre progression, les dates et votre note.",
        s3: "Indiquez à Play vos dossiers, lanceurs et émulateurs pour ouvrir vos jeux, vidéos et livres depuis Metadea.",
        s4: "Suivez votre progression sur l'Accueil et dans votre profil : statistiques, favoris, listes et historique.",
      },
      tips: {
        t1: "Votre bibliothèque est une base de données sur cet ordinateur. Personne d'autre n'en a de copie, alors faites une sauvegarde de temps en temps (Paramètres › Sauvegarde).",
        t2: "Tous les réglages du guide de bienvenue peuvent être modifiés plus tard dans les Paramètres.",
      },
    },
    navigation: {
      title: "Se déplacer",
      intro: "La barre supérieure est toujours là. Les flèches reviennent en arrière et avancent, les icônes de gauche ouvrent Accueil, Play et Parcourir, les noms au centre ouvrent votre bibliothèque filtrée par type, et le groupe de droite réunit la recherche, les notifications, votre profil et les Paramètres.",
      steps: {
        s1: "Utilisez les flèches ← et → tout à gauche, ou Alt+← / Alt+→, pour parcourir votre historique.",
        s2: "Cliquez sur un type de média au centre de la barre (Anime, Manga, Jeux…) pour aller à cette partie de votre bibliothèque.",
        s3: "Appuyez sur Ctrl+1 à Ctrl+6 pour aller directement à Accueil, Play, Profil, Parcourir, Notifications ou Paramètres.",
        s4: "Appuyez sur ? sur n'importe quel écran pour voir les raccourcis qui y fonctionnent.",
      },
      tips: {
        t1: "Sur Parcourir et Play, le centre de la barre devient les onglets propres à la page.",
        t2: "Sur Mac, Ctrl dans ces raccourcis correspond à ⌘.",
      },
    },
    account: {
      title: "Votre compte",
      intro: "Au premier lancement de Metadea, vous choisissez seulement un nom d'utilisateur : la session est locale et rien n'est envoyé. Vous pourrez plus tard la lier à Google pour avoir un profil public et voir l'activité de vos amis.",
      steps: {
        s1: "Pour lier une session locale, utilisez « Lier avec Google » sur l'Accueil.",
        s2: "Avec un compte lié, l'Accueil vous demande une fois par jour s'il faut synchroniser votre profil ; il n'est envoyé que lorsque vous appuyez sur « Synchroniser ».",
        s3: "« Se déconnecter » se trouve en bas de Paramètres › Apparence.",
      },
      tips: {
        t1: "Se déconnecter oublie seulement la session : votre bibliothèque reste sur cet ordinateur.",
        t2: "« Plus tard » masque la proposition de synchronisation jusqu'à votre prochaine visite sur l'Accueil.",
      },
    },
    home: {
      title: "Accueil",
      intro: "L'Accueil est votre résumé du jour : ce que vous avez en cours, ce qui sort ce mois-ci et ce que font vos amis.",
      steps: {
        s1: "Le premier bloc montre ce que vous regardez, lisez ou jouez, regroupé par type. Utilisez + et − sur une jaquette pour ajouter ou retirer un épisode ou un chapitre sans ouvrir l'œuvre.",
        s2: "Le calendrier montre les sorties du mois. « Pour vous » n'inclut que les œuvres de votre bibliothèque ; « Général » inclut tout. Filtrez par type et changez de mois avec les flèches.",
        s3: "La colonne de droite commence par « Ce jour-là » : les œuvres que vous avez terminées à la date d'aujourd'hui les années précédentes.",
        s4: "En dessous, le fil d'activité bascule entre « Amis » et « Général ».",
        s5: "La colonne étroite tout à droite affiche « Diffusé aujourd’hui » (les épisodes de votre bibliothèque qui sortent aujourd’hui) et « Reprendre la lecture » : la dernière chose lue dans Play, avec le temps restant. Cliquez dessus pour reprendre là où vous vous étiez arrêté.",
      },
      tips: {
        t1: "Les blocs sans contenu restent masqués, si bien qu'une nouvelle bibliothèque paraît presque vide au début.",
        t2: "Quelques secondes après le lancement, Metadea télécharge les dernières données de la communauté et recherche des mises à jour, puis vous prévient par une notification.",
        t3: "Revoir une œuvre ne change pas la date à laquelle elle apparaît dans « Ce jour-là ».",
      },
    },
    search: {
      title: "Recherche et recherche rapide",
      intro: "Il y a deux façons de chercher : la recherche rapide, qui s'affiche par-dessus n'importe quel écran, et la page Parcourir, avec un onglet par type de média. Les résultats de votre propre catalogue apparaissent en premier, puis ceux des sources en ligne s'ajoutent au fur et à mesure de leurs réponses.",
      steps: {
        s1: "Appuyez sur Ctrl+K ou / (ou sur l'icône de boussole à droite de la barre supérieure) et tapez au moins deux lettres.",
        s2: "La recherche rapide cherche dans tous les types à la fois : œuvres, personnages, équipes et utilisateurs, jusqu'à six par groupe. Déplacez-vous avec ↑ et ↓, ouvrez avec Entrée, ou utilisez « Voir tout ».",
        s3: "Sur Parcourir, choisissez un onglet pour chercher dans un seul type. Chaque type a sa source : AniList pour les anime, manga et light novels ; IGDB pour les jeux et visual novels ; TMDB pour les films et séries ; Open Library pour les livres ; Comic Vine pour les comics.",
        s4: "Ouvrez un résultat pour voir sa page et l'ajouter à votre bibliothèque.",
      },
      tips: {
        t1: "IGDB, TMDB et Comic Vine nécessitent vos propres clés gratuites. Sans elles, Parcourir affiche un avertissement avec un bouton qui vous mène au bon endroit dans Paramètres › Environnement.",
        t2: "Si une source échoue ou si vous êtes hors ligne, vous voyez tout de même ce qui se trouve déjà dans votre catalogue local.",
        t3: "Appuyez sur Ctrl+F sur Parcourir pour aller au champ de recherche.",
      },
    },
    media_page: {
      title: "La page d'une œuvre",
      intro: "Chaque œuvre a une page avec sa jaquette, ses données, votre progression et plusieurs onglets de contenus liés. Presque tout peut se faire au clavier.",
      steps: {
        s1: "Cliquez sur la jaquette (ou appuyez sur E) pour ajouter l'œuvre à votre bibliothèque ou modifier votre entrée.",
        s2: "Appuyez sur + ou − pour changer votre progression, sur 1–9 pour noter (0 vaut 10) et sur F pour la mettre en favori.",
        s3: "Les onglets du bas montrent les œuvres liées, les éditions, les recommandations, les saisons, les épisodes et les génériques d'ouverture et de fin.",
        s4: "La section « Utilisateurs » affiche les notes des amis AniList que vous suivez, quand vous êtes connecté.",
        s5: "Le bouton de lien (ou L) copie un lien qui ouvre cette page dans Metadea.",
      },
      tips: {
        t1: "Les jeux qui sont une édition d'un autre vous renvoient au jeu principal et le signalent dans la bannière.",
        t2: "Vos propres captures d'un jeu ou d'un épisode apparaissent dans sa section « Captures d’écran ».",
      },
    },
    editor: {
      title: "Modifier votre entrée",
      intro: "L'éditeur réunit tout ce qui concerne votre rapport à une œuvre : statut, progression, dates, note, notes personnelles et plus encore. Il s'ouvre en cliquant sur la jaquette ou en appuyant sur E.",
      steps: {
        s1: "Choisissez un statut avec les icônes : en attente, en cours, terminé, en pause ou abandonné.",
        s2: "Indiquez votre progression. Les jeux et visual novels se comptent en heures (H:MM) ; tout le reste en épisodes, chapitres ou volumes. Atteindre le total marque l'œuvre comme terminée.",
        s3: "Ajoutez une note, les dates de début et de fin (ou la date de visionnage pour les films), jusqu'à cinq tags et des notes personnelles.",
        s4: "Mettez-la en favori, ou en « Platine » pour les jeux terminés à 100 %.",
        s5: "Dans « Historique mensuel », choisissez le mois que représente cette œuvre ; chaque mois contient une seule œuvre.",
        s6: "Enregistrez avec Ctrl+S. Ctrl+Z et Ctrl+Y annulent et rétablissent.",
      },
      tips: {
        t1: "« Importer les données de votre profil AniList » remplit votre progression et vos dates depuis AniList.",
        t2: "Une fois l'œuvre terminée, « Partager » crée une image verticale avec la jaquette, votre note et votre avatar.",
        t3: "Vos notes personnelles deviennent des critiques dans l'onglet « Critiques » de votre profil.",
      },
    },
    rewatch: {
      title: "Revoir, relire et rejouer",
      intro: "Quand vous revenez à une œuvre déjà terminée, Metadea compte la répétition sans perdre vos dates d'origine.",
      steps: {
        s1: "Ouvrez l'éditeur d'une œuvre terminée et appuyez sur le bouton de répétition (« Revoir », « Relire » ou « Rejouer »).",
        s2: "La progression revient à zéro et le statut passe à en cours ; les dates du premier passage sont conservées.",
        s3: "Quand vous la terminez à nouveau, le compteur « Fois répété » augmente d'un.",
      },
      tips: {
        t1: "Appuyez à nouveau sur le bouton avant d'avoir terminé pour annuler la répétition sans la compter.",
        t2: "Les cartes de la bibliothèque affichent ×2, ×3… et les statistiques comptent les heures de chaque passage.",
      },
    },
    sagas: {
      title: "Sagas, saisons et relations",
      intro: "Les œuvres qui vont ensemble — suites, préquelles, spin-offs, saisons — sont liées, pour que vous puissiez voir une franchise entière et combien vous en avez terminé.",
      steps: {
        s1: "Appuyez sur « Ordre de la saga » sur la page d'une œuvre pour voir toute la franchise dans l'ordre. « Vous êtes ici » marque l'œuvre actuelle, et l'onglet « Arcs narratifs » découpe les longues séries en arcs.",
        s2: "La barre de progression de la saga indique combien d'œuvres de la saga vous avez terminées ; les œuvres pas encore sorties ne comptent pas.",
        s3: "L'onglet « Relations » liste chaque relation avec son type (suite, adaptation, spin-off…).",
      },
      tips: {
        t1: "Avec « Unifier les saisons » activé (Paramètres › Préférences), les saisons d'un anime sont regroupées en une seule carte dans la bibliothèque et la page affiche à la place un onglet « Saisons ».",
        t2: "La barre de saga n'apparaît qu'une fois qu'au moins une partie de la saga est terminée.",
      },
    },
    characters: {
      title: "Personnages et équipe",
      intro: "Les personnages et les créateurs ont leurs propres pages, accessibles depuis la distribution d'une œuvre ou depuis la recherche.",
      steps: {
        s1: "La page d'un personnage montre sa biographie, les œuvres où il apparaît et ses comédiens de doublage.",
        s2: "Mettez un personnage en favori pour l'ajouter aux personnages favoris de votre profil.",
        s3: "La page d'un membre de l'équipe liste ses œuvres et ses dates.",
      },
      tips: {
        t1: "La recherche rapide trouve aussi les personnages et l'équipe : tapez le nom et regardez dans leurs groupes.",
      },
    },
    community: {
      title: "Catalogue communautaire et propositions",
      intro: "Metadea partage un catalogue communautaire : des données ajoutées et corrigées par les utilisateurs, relues sur GitHub. Votre copie est mise à jour à chaque lancement, et vous pouvez proposer des modifications depuis la page de n'importe quelle œuvre.",
      steps: {
        s1: "Connectez GitHub dans Paramètres › Connexions.",
        s2: "Sur la page d'une œuvre, appuyez sur le bouton + de la bannière (ou sur P) pour ouvrir l'éditeur de propositions.",
        s3: "Modifiez titres, synopsis, dates, nombres, liens, images, genres, plateformes, personnages, relations, épisodes, génériques, arcs narratifs ou ordre de la saga. Vous pouvez modifier plusieurs œuvres dans la même session.",
        s4: "Appuyez sur « Envoyer la proposition » : elle devient une pull request, relue avant d'être visible par tous.",
      },
      tips: {
        t1: "Paramètres › Nouveautés › « Synchroniser maintenant » télécharge le catalogue à la demande.",
        t2: "Paramètres › Admin › Éditeur de catalogue affiche votre catalogue local ; modifier le catalogue partagé nécessite un accès en écriture au dépôt.",
      },
    },
    statuses: {
      title: "Votre bibliothèque : statuts et progression",
      intro: "Votre bibliothèque, dans votre profil, regroupe chaque type par statut pour voir d'un coup d'œil ce qui est en attente, en cours ou terminé.",
      steps: {
        s1: "Ouvrez un type depuis la barre supérieure ou depuis l'onglet « Bibliothèque » de votre profil.",
        s2: "Sections : En attente, En cours, En publication (en cours et toujours en train de sortir), Terminées, En pause et Abandonnées.",
        s3: "Filtrez par nom, format, statut ou dates, triez par note, date ou durée, et regroupez par saga ou par lot.",
        s4: "Appuyez sur Ctrl+F pour chercher dans la bibliothèque.",
      },
      tips: {
        t1: "Les boutons + et − de l'Accueil et les touches +/− de la page d'une œuvre mettent à jour la progression sans ouvrir l'éditeur.",
      },
    },
    ratings: {
      title: "Notes",
      intro: "Choisissez votre façon de noter : 5 étoiles, une note sur 10 avec deux décimales, une note entière sur 10 ou trois visages. Vous pouvez même garder deux notes à la fois.",
      steps: {
        s1: "Dans Paramètres › Préférences › Système de notation, choisissez l'échelle qui vous convient.",
        s2: "Activez « Double note » pour garder une seconde note avec son propre nom et sa propre échelle (par exemple Histoire et Visuels).",
        s3: "Notez depuis l'éditeur, ou appuyez sur 1–9 (0 = 10) sur la page d'une œuvre.",
      },
      tips: {
        t1: "Avec la double note, un sélecteur dans la bibliothèque choisit laquelle des deux notes est affichée.",
        t2: "Lors de la synchronisation avec AniList, votre note est convertie dans l'échelle de votre compte AniList.",
        t3: "« Supprimer les notes » dans Paramètres › Préférences efface toutes les notes après confirmation.",
      },
    },
    favorites_lists: {
      title: "Favoris, Panthéon et listes",
      intro: "Les favoris et les listes vous permettent de montrer ce qui compte le plus pour vous, dans l'ordre de votre choix.",
      steps: {
        s1: "Mettez des œuvres et des personnages en favoris ; le bouton couronne ajoute aussi une œuvre aux favoris généraux « Multimédia ».",
        s2: "Dans l'onglet « Favoris », faites glisser pour réorganiser et donnez à n'importe quel favori une image personnalisée.",
        s3: "Vos 10 œuvres et vos 10 personnages préférés forment le Panthéon de votre profil.",
        s4: "Dans « Listes », créez des listes d'œuvres, de personnages ou d'épisodes ; rendez-les privées ou en classement et triez-les à la main, par ordre alphabétique ou par date de sortie.",
      },
      tips: {
        t1: "Les listes se réorganisent par glisser-déposer.",
      },
    },
    tier_lists: {
      title: "Tier lists",
      intro: "Classez des œuvres par niveaux de S à F, ou par niveaux dont vous choisissez vous-même le nom et la couleur.",
      steps: {
        s1: "Ouvrez Tier list et créez-en une nouvelle.",
        s2: "Ajoutez des œuvres de votre catalogue ; elles attendent dans la zone « Non classé ».",
        s3: "Faites glisser chaque œuvre vers son niveau. Cliquez sur le nom ou la couleur d'un niveau pour le modifier.",
      },
      tips: {
        t1: "Les tier lists de personnages et la recherche communautaire arrivent bientôt.",
      },
    },
    stats: {
      title: "Statistiques et historique",
      intro: "L'onglet « Statistiques » de votre profil transforme votre bibliothèque en chiffres : combien vous avez terminé, combien d'heures, quels genres et comment vous notez.",
      steps: {
        s1: "Les cartes du haut résument les œuvres, les saisons, le total d'heures, la note moyenne et les œuvres notées.",
        s2: "En dessous, vous trouvez la répartition par statut, le temps par catégorie, les genres préférés, la distribution des notes, les œuvres terminées par an et une carte d'activité sur six mois.",
        s3: "Le calculateur de backlog estime le temps qu'il vous faudrait pour finir ce qui est en attente, avec ou sans ce que vous avez en cours.",
        s4: "L'onglet « Profil » montre votre historique mensuel (une jaquette par mois) et votre activité récente.",
      },
      tips: {
        t1: "Les répétitions comptent : une série vue deux fois ajoute ses heures deux fois.",
      },
    },
    social: {
      title: "Amis et notifications",
      intro: "Avec un compte lié, vous pouvez suivre d'autres personnes, voir leur activité et visiter leurs profils. Les rappels de sortie arrivent sous forme de notifications système.",
      steps: {
        s1: "Dans l'onglet « Amis » de votre profil, voyez qui vous suivez et qui vous suit.",
        s2: "Ouvrez le profil de quelqu'un pour voir sa bibliothèque en lecture seule et le suivre.",
        s3: "Le fil d'activité de l'Accueil montre ce que font vos amis.",
      },
      tips: {
        t1: "Metadea envoie des notifications système pour les sorties du jour d'œuvres que vous prévoyez de voir, pour les anime en diffusion que vous suivez et pour les nouveaux épisodes ou chapitres de ce que vous regardez ou lisez.",
        t2: "La page Notifications est encore en construction.",
      },
    },
    local_folders: {
      title: "Dossiers locaux",
      intro: "Play trouve vos fichiers en cherchant dans un dossier par type de média. Metadea associe chaque fichier ou sous-dossier à une œuvre de votre catalogue.",
      steps: {
        s1: "Dans Paramètres › Environnement › Chemins locaux, choisissez un dossier pour chaque type (anime, séries, films, manga, comics, livres…).",
        s2: "Pour les jeux, vous pouvez aussi utiliser « Ajouter un dossier » dans l'en-tête de Play ; chaque sous-dossier compte comme un jeu.",
        s3: "Ouvrez Play : les fichiers reconnus apparaissent avec la jaquette et les données de l'œuvre.",
        s4: "Si quelque chose n'est pas reconnu, utilisez « Localiser manuellement », puis « Renommer pour la détection automatique » pour qu'il soit trouvé tout seul la prochaine fois.",
      },
      tips: {
        t1: "L'association ignore les accents et la ponctuation et respecte les numéros de saison dans les noms.",
        t2: "Les fichiers pris en charge incluent mkv, mp4, avi, webm, mp3, flac, epub, pdf, cbz et cbr.",
        t3: "Appuyez sur Ctrl+F dans Play pour chercher dans votre bibliothèque locale.",
      },
    },
    pc_launchers: {
      title: "Jeux PC : Steam, Epic, GOG, Xbox et EA",
      intro: "Play détecte les jeux que vous avez installés depuis les principaux lanceurs PC, sans aucune configuration.",
      steps: {
        s1: "Ouvrez Play › Jeux : la première visite analyse Steam, Epic Games, GOG, l'application Xbox et EA.",
        s2: "Les visites suivantes n'analysent à nouveau que les lanceurs qui ont changé ; « Scanner à nouveau » force une analyse complète.",
        s3: "Ajoutez votre clé Steam Web API dans Paramètres › Environnement pour obtenir aussi le temps de jeu, la dernière session et les jeux possédés mais non installés.",
      },
      tips: {
        t1: "Si les jeux d'un lanceur n'apparaissent pas, « Diagnostics » montre ce que Metadea a trouvé.",
      },
    },
    roms: {
      title: "Émulateurs et ROM",
      intro: "Metadea peut accueillir votre collection rétro : il lit vos dossiers de ROM, nettoie leurs noms, reconnaît chaque jeu et l'ouvre avec le bon émulateur.",
      steps: {
        s1: "Dans Paramètres › Émulateurs, choisissez un constructeur et une console.",
        s2: "Choisissez l'émulateur et son exécutable, les arguments de lancement ({ROM} est remplacé par le fichier) et votre dossier de ROM.",
        s3: "Vous pouvez aussi définir les extensions de ROM à rechercher (vide = les extensions habituelles) et le dossier de captures de l'émulateur.",
        s4: "Ouvrez Play › Jeux : vos ROM apparaissent avec des noms propres et les données d'IGDB.",
      },
      tips: {
        t1: "« Nettoyer automatiquement les noms des ROM » renomme les fichiers dans un format propre (et leurs sauvegardes avec eux). Une notification vous permet d'annuler pendant quelques secondes.",
        t2: "Les ROM GameCube, Wii, DS et 3DS sont reconnues grâce à l'identifiant de leur en-tête ; les mises à jour et DLC Switch sont regroupés sous le jeu de base.",
        t3: "Si une ROM est associée au mauvais jeu, utilisez le crayon (« Changer de jeu sur IGDB ») dans son panneau de détails.",
      },
    },
    metadata: {
      title: "Obtenir les métadonnées",
      intro: "Le bouton « Métadonnées » de Play télécharge en une seule fois les jaquettes, bannières et informations de vos jeux.",
      steps: {
        s1: "Ouvrez Play › Jeux et appuyez sur « Métadonnées » en bas de la liste des plateformes.",
        s2: "Choisissez « Basique » (jaquette, bannière, genres, synopsis, date, éditeur), « Succès Steam » ou les deux.",
        s3: "Suivez la progression dans la fenêtre ; vous pouvez annuler à tout moment.",
      },
      tips: {
        t1: "Cela concerne les jeux Steam, GOG et les ROM. Les succès Steam nécessitent votre clé Steam Web API.",
        t2: "Les données des jeux viennent d'IGDB, dont les clés doivent donc être configurées dans Paramètres › Environnement.",
      },
    },
    achievements: {
      title: "Succès",
      intro: "Le panneau de détails d'un jeu dans Play comporte un onglet de succès : les succès Steam pour les jeux Steam et RetroAchievements pour vos ROM.",
      steps: {
        s1: "Pour Steam, ajoutez votre clé Steam Web API et lancez « Métadonnées » › « Succès Steam ».",
        s2: "Pour les ROM, ajoutez votre utilisateur et votre clé Web API RetroAchievements dans Paramètres › Environnement.",
        s3: "Ouvrez une ROM dans Play : Metadea la relie à son set RetroAchievements grâce au hash du fichier, ou par le titre si cela échoue.",
        s4: "S'il choisit le mauvais set, utilisez « Lier manuellement » ou « Délier ».",
      },
      tips: {
        t1: "Les succès sont mis en cache, vous pouvez donc les voir hors ligne.",
        t2: "Après une session, une notification vous indique combien de succès vous avez débloqués.",
        t3: "Les consoles sans sets RetroAchievements (3DS, Wii, Wii U, Switch, PC…) n'affichent pas le panneau.",
      },
    },
    screenshots: {
      title: "Captures d'écran",
      intro: "La section « Captures d’écran » d'une œuvre rassemble des captures de trois sources : celles que vous prenez dans Metadea, vos captures Steam et le dossier de captures de votre émulateur.",
      steps: {
        s1: "Appuyez sur F12 dans le lecteur intégré pour enregistrer une image. Elle va dans Images › Metadea › <œuvre>, nommée d'après l'épisode et le moment.",
        s2: "Dans le lecteur de comics, faites un clic droit sur une page et choisissez « Enregistrer la page (PNG) ».",
        s3: "Pour les émulateurs, définissez le dossier de captures de chaque console dans Paramètres › Émulateurs, ou laissez-le vide pour qu'il soit détecté.",
      },
      tips: {
        t1: "Le dossier de captures est détecté automatiquement pour Dolphin, PCSX2, DuckStation, melonDS, RetroArch, Citron/Yuzu et PPSSPP.",
        t2: "Les captures d'émulateur sont filtrées par jeu ; si aucune ne correspond, les captures récentes sont affichées avec une remarque.",
      },
    },
    launching: {
      title: "Lancer des jeux et temps de jeu",
      intro: "Le bouton « Jouer » lance n'importe quel jeu de votre bibliothèque locale, et Metadea compte le temps que vous passez à jouer.",
      steps: {
        s1: "Ouvrez un jeu dans Play et appuyez sur « Jouer ».",
        s2: "Les jeux Steam, Epic et GOG s'ouvrent via leur lanceur ; les ROM s'ouvrent avec l'émulateur configuré pour leur console.",
        s3: "Metadea surveille le processus du jeu et ajoute chaque session à vos heures dans la bibliothèque.",
      },
      tips: {
        t1: "Les sessions de moins de 15 secondes ne sont pas comptées.",
        t2: "Si le bouton d'une ROM est désactivé, sa console n'a pas encore d'émulateur (Paramètres › Émulateurs).",
        t3: "Pendant que vous jouez, Discord affiche le jeu (et votre progression RetroAchievements pour les ROM).",
      },
    },
    player: {
      title: "Le lecteur vidéo",
      intro: "Les épisodes et films locaux se lisent dans le lecteur intégré de Metadea (libmpv), qui retient votre progression tout seul. Vous pouvez utiliser VLC à la place si vous préférez.",
      steps: {
        s1: "Choisissez le lecteur dans Paramètres › Préférences › Lecteur vidéo : intégré (libmpv) ou VLC (externe).",
        s2: "Choisissez les commandes : par-dessus la vidéo, ou dans une barre fixe sous la vidéo.",
        s3: "Appuyez sur « Lire » sur un épisode dans Play. Le reste de la saison est mis en file d'attente ; appuyez sur Q pour voir la file.",
        s4: "Utilisez les menus pour changer de piste audio, de sous-titres et de vitesse (0,5× à 2×).",
        s5: "À 80 %, l'épisode est marqué comme vu : le statut, la progression et AniList sont mis à jour. Une notification vous permet d'annuler.",
        s6: "Fermez avant 80 % et le prochain « Lire » reprend à la seconde près.",
      },
      tips: {
        t1: "Cliquez sur la vidéo pour mettre en pause et double-cliquez pour passer en plein écran.",
        t2: "Si libmpv ne peut pas être chargé, Metadea utilise automatiquement VLC et vous le signale.",
        t3: "Terminer le dernier épisode termine l'œuvre et ajoute sa suite à vos œuvres en attente.",
        t4: "Discord affiche ce que vous regardez avec un compte à rebours du temps restant.",
      },
    },
    player_shortcuts: {
      title: "Raccourcis du lecteur",
      intro: "Tout ce que fait le lecteur intégré peut se faire au clavier. Appuyez sur ? lorsqu'il est ouvert pour voir cette liste.",
      steps: {
        s1: "Espace met en pause ; les flèches avancent ou reculent de 5 s (30 s avec Maj) et règlent le volume.",
        s2: "N et P (ou Ctrl+→ et Ctrl+←) passent à l'épisode suivant ou précédent.",
        s3: ", et . avancent image par image ; [ et ] changent la vitesse.",
        s4: "Les touches numériques sautent à 10 %, 20 %… de la vidéo.",
      },
      tips: {
        t1: "Échap ferme, dans cet ordre : les menus ouverts, le plein écran, puis le lecteur.",
      },
    },
    skip_segments: {
      title: "Passer les openings et endings",
      intro: "Le lecteur intégré détecte les openings, endings, récapitulatifs et aperçus pour que vous puissiez les passer.",
      steps: {
        s1: "Dans Paramètres › Préférences › Lecteur vidéo, choisissez comment : afficher un bouton, passer automatiquement ou ne pas détecter.",
        s2: "Avec le bouton, appuyez dessus (ou sur S) quand il apparaît.",
        s3: "En mode automatique, une notification indique ce qui a été passé et propose « Annuler ».",
      },
      tips: {
        t1: "Les segments proviennent des chapitres du fichier (MKV) et, pour les anime, d'AniSkip ; les chapitres l'emportent quand les deux existent.",
        t2: "Cela ne fonctionne que dans le lecteur intégré, pas dans VLC.",
      },
    },
    reader_comics: {
      title: "Lire des comics et des manga",
      intro: "Les fichiers CBZ, CBR et PDF s'ouvrent dans le lecteur de Metadea, qui retient la page où vous en êtes.",
      steps: {
        s1: "Ouvrez le fichier depuis Play.",
        s2: "Tournez les pages avec les flèches, Espace ou en cliquant sur le côté gauche ou droit de la page. Les doubles pages s'affichent côte à côte, la couverture seule.",
        s3: "Faites un clic droit sur une page pour ajouter un signet, voir vos signets ou enregistrer la page en image.",
        s4: "Arriver à la dernière page la marque comme lue et met à jour votre bibliothèque.",
      },
      tips: {
        t1: "Votre page est enregistrée à chaque changement de page.",
        t2: "« Mettre en pause » ferme le lecteur mais garde la session dans une barre pour que vous puissiez la reprendre plus tard.",
      },
    },
    reader_epub: {
      title: "Lire des livres EPUB",
      intro: "Les livres EPUB ont leur propre lecteur, avec réglages typographiques, table des matières, signets et progression.",
      steps: {
        s1: "Ouvrez le livre depuis Play.",
        s2: "Dans « Typographie », choisissez la police, la taille, l'interligne, les marges, le thème de couleur (Papier, Sépia, Sombre, Noir) et la justification.",
        s3: "Choisissez le mode « Pages » ou « Défilement ».",
        s4: "Appuyez sur T pour la table des matières et utilisez « Ajouter un signet ici » pour marquer un endroit.",
        s5: "Le pourcentage indique où vous en êtes ; à 98 %, le livre compte comme lu.",
      },
      tips: {
        t1: "« Utiliser les styles de l'éditeur » respecte la mise en page propre au livre.",
        t2: "La progression se synchronise avec votre bibliothèque et AniList quand vous terminez.",
      },
    },
    themes_jukebox: {
      title: "Génériques et juke-box",
      intro: "Les pages d'anime incluent leurs génériques d'ouverture et de fin. Mettez une étoile à ceux que vous aimez et ils joueront dans le juke-box sur n'importe quel écran.",
      steps: {
        s1: "Ouvrez un générique depuis l'onglet « Thèmes » d'une œuvre (ou appuyez sur T). Passez d'une version à l'autre (v1, v2…) et allez au précédent ou au suivant.",
        s2: "Appuyez sur l'étoile (« Ajouter au juke-box ») pour l'enregistrer.",
        s3: "Ouvrez le juke-box avec le bouton rond en bas à droite : le disque qui tourne affiche la jaquette et se met en pause quand on clique dessus.",
        s4: "Utilisez précédent/suivant, la barre de progression, le volume, la lecture aléatoire et la répétition (désactivée, file ou ce générique).",
      },
      tips: {
        t1: "Le juke-box se met en pause tout seul quand le lecteur s'ouvre, quand une vidéo locale démarre, quand un générique s'ouvre sur la page d'une œuvre ou quand un autre son est joué.",
        t2: "Les touches multimédia de votre clavier le contrôlent, et il retient le volume, la lecture aléatoire, la répétition et le dernier générique.",
        t3: "Les vidéos des génériques viennent d'animethemes.moe et nécessitent donc une connexion.",
      },
    },
    api_keys: {
      title: "Clés API : laquelle sert à quoi",
      intro: "Certaines sources nécessitent une clé gratuite que vous créez dans votre propre compte. Elles sont toutes facultatives : configurez seulement celles qui correspondent à ce que vous utilisez.",
      steps: {
        s1: "Ouvrez Paramètres › Environnement et cliquez sur le logo d'un service.",
        s2: "Appuyez sur le bouton (i) pour savoir comment obtenir cette clé, collez-la et appuyez sur « Enregistrer ».",
        s3: "IGDB : jeux et visual novels, ainsi que les données de vos ROM. TMDB : films et séries. Comic Vine : comics. Steam : temps de jeu et succès.",
        s4: "AniList et MyAnimeList : un Client ID pour connecter votre compte (la recherche AniList fonctionne sans). RetroAchievements : utilisateur et clé Web API.",
      },
      tips: {
        t1: "Sous Windows, les clés sont stockées chiffrées dans la base de données de Metadea.",
        t2: "API-Sports sert aux événements sportifs, un type désactivé pour le moment.",
      },
    },
    anilist: {
      title: "AniList",
      intro: "Connectez AniList pour importer votre liste d'anime et de manga et la garder synchronisée : chaque modification enregistrée dans Metadea est envoyée à AniList.",
      steps: {
        s1: "Créez une application sur AniList et collez son Client ID dans Paramètres › Environnement › AniList.",
        s2: "Dans Paramètres › Connexions, appuyez sur « Connecter », autorisez Metadea dans le navigateur et collez le code obtenu.",
        s3: "Appuyez sur « Importer » et choisissez les formats (TV, films, OVA, manga, light novels…).",
        s4: "« Importer » ajoute seulement ce que vous n'avez pas encore ; « Synchroniser » met aussi à jour ce que vous avez déjà avec les données d'AniList.",
      },
      tips: {
        t1: "Enregistrer depuis l'éditeur, le lecteur vidéo, le lecteur de livres ou l'Accueil envoie automatiquement la modification à AniList.",
        t2: "AniList autorise 60 requêtes par minute ; si vous atteignez la limite, Metadea attend et vous prévient.",
      },
    },
    myanimelist: {
      title: "MyAnimeList",
      intro: "MyAnimeList se connecte via une connexion dans le navigateur et reçoit en arrière-plan vos modifications d'anime, de manga et de light novels.",
      steps: {
        s1: "Créez une application API sur MyAnimeList avec metadea://auth/mal comme URL de redirection, et collez son Client ID dans Paramètres › Environnement › MyAnimeList (aucun secret requis).",
        s2: "Dans Paramètres › Connexions, appuyez sur « Connecter » : le navigateur s'ouvre et vous ramène à Metadea.",
        s3: "Si le navigateur ne revient pas, collez l'adresse metadea://auth/mal?code=… dans le champ et appuyez sur « Terminer la connexion ».",
        s4: "« Importer » récupère votre liste MAL et l'associe à AniList ; tout ce qui n'a pas de correspondance est listé à part.",
      },
      tips: {
        t1: "Les modifications sont envoyées à MAL à chaque enregistrement, comme pour AniList. Les œuvres sans identifiant MAL sont ignorées.",
      },
    },
    retroachievements: {
      title: "RetroAchievements",
      intro: "Metadea affiche votre progression RetroAchievements à côté de vos ROM. Il se contente de l'afficher : les succès se débloquent en jouant dans un émulateur où RetroAchievements est activé.",
      steps: {
        s1: "Sur retroachievements.org, ouvrez vos paramètres et copiez votre clé Web API.",
        s2: "Dans Paramètres › Environnement › RetroAchievements, saisissez votre nom d'utilisateur et la clé, puis enregistrez.",
        s3: "Activez RetroAchievements dans votre émulateur avec le même compte.",
        s4: "Ouvrez une ROM dans Play pour voir son set, votre progression et chaque succès.",
      },
      tips: {
        t1: "Les jeux sont reconnus grâce au hash de la ROM, comme le font les émulateurs : un dump propre donne le meilleur résultat.",
        t2: "Sans connexion, vous voyez les dernières données en cache.",
      },
    },
    discord: {
      title: "Discord",
      intro: "Si Discord est ouvert, votre profil montre ce que vous faites dans Metadea : jouer, regarder, écouter un générique, lire ou consulter une œuvre.",
      steps: {
        s1: "Ouvrez Discord sur cet ordinateur ; Metadea le trouve tout seul, même si vous l'ouvrez plus tard.",
        s2: "Lancez un jeu, une vidéo ou un générique, ou ouvrez un livre ou la page d'une œuvre : votre statut s'adapte.",
        s3: "Les œuvres que vous consultez incluent un bouton « Ouvrir dans Metadea » pour que vos amis puissent les ouvrir aussi.",
      },
      tips: {
        t1: "Il n'y a pas d'interrupteur dans Metadea : pour le masquer, fermez Discord ou désactivez le partage d'activité dans les paramètres de Discord.",
        t2: "Pour les vidéos, l'épisode s'affiche avec un compte à rebours du temps restant ; les jeux d'émulateurs ajoutent votre progression RetroAchievements.",
      },
    },
    deep_links: {
      title: "Liens et partage",
      intro: "Les liens Metadea ouvrent une page directement dans l'application, même depuis un navigateur ou une discussion.",
      steps: {
        s1: "Sur la page d'une œuvre, appuyez sur le bouton de lien (ou L) pour copier son lien.",
        s2: "Partagez-le : quand quelqu'un qui a Metadea l'ouvre, l'application s'ouvre sur cette œuvre.",
        s3: "Les liens commençant par metadea:// ouvrent directement des œuvres, des personnages, des profils ou l'Accueil.",
      },
      tips: {
        t1: "Les liens partagés passent par une petite page web qui transmet le lien à Metadea ; ils fonctionnent donc aussi dans les applications qui n'ouvrent pas les liens metadea://.",
      },
    },
    github: {
      title: "GitHub et autres connexions",
      intro: "GitHub sert à proposer des modifications au catalogue communautaire. Il a seulement besoin de l'autorisation d'ouvrir des pull requests sur des dépôts publics.",
      steps: {
        s1: "Dans Paramètres › Connexions › Communauté et profil, appuyez sur « Connecter » à côté de GitHub.",
        s2: "Copiez le code affiché par Metadea, ouvrez github.com/login/device et collez-le.",
        s3: "De retour dans Metadea, l'éditeur de propositions est disponible sur chaque œuvre.",
      },
      tips: {
        t1: "Paramètres › Connexions affiche aussi VNDB pour les visual novels, bientôt disponible.",
      },
    },
    appearance: {
      title: "Apparence et profil",
      intro: "Personnalisez Metadea et votre profil : arrière-plan, couleur d'accent, police du nom, avatar, bannière et biographie.",
      steps: {
        s1: "Dans Paramètres › Apparence, choisissez un arrière-plan dynamique (il y en a 14, de Nebula à Blueprint).",
        s2: "Choisissez une couleur d'accent, ou rétablissez celle par défaut.",
        s3: "Saisissez le nom à afficher et essayez les polices avec les flèches.",
        s4: "Importez un avatar, une photo carrée pour les images partagées et une bannière, et rédigez une biographie.",
      },
      tips: {
        t1: "La photo carrée n'est utilisée que dans les images que vous partagez ; si elle est vide, votre avatar est utilisé.",
      },
    },
    ui_themes: {
      title: "Thèmes d'interface (skins)",
      intro: "Les skins changent l'apparence de tout Metadea. Ce sont des dossiers contenant un fichier theme.json et, éventuellement, du CSS, que vous pouvez créer vous-même ou obtenir d'autres personnes.",
      steps: {
        s1: "Dans Paramètres › Apparence › Thèmes de la communauté (skins), appuyez sur « Ouvrir le dossier des thèmes ».",
        s2: "Copiez-y un dossier de thème (ou appuyez sur « Créer le thème d'exemple ») et appuyez sur « Recharger ».",
        s3: "Appuyez sur « Activer » sur le thème voulu. Il reste actif après un redémarrage.",
        s4: "Si vous créez le vôtre, activez « Surveiller les modifications » pour voir vos changements toutes les deux secondes.",
      },
      tips: {
        t1: "Les thèmes « Variables seulement » ne changent que les couleurs, les arrondis et les vitesses, et sont sûrs. Les thèmes « CSS complet » peuvent tout changer et risquent de casser un écran.",
        t2: "Si un thème rend quelque chose inutilisable, appuyez sur Ctrl+Maj+T n'importe où pour le désactiver.",
        t3: "Les thèmes ne peuvent rien charger depuis Internet ; pour en partager un, compressez son dossier en ZIP.",
      },
    },
    language: {
      title: "Langue",
      intro: "Metadea est disponible en espagnol, anglais, allemand, japonais, italien, français, catalan et russe.",
      steps: {
        s1: "Ouvrez Paramètres › Préférences › Langue et appuyez sur le code de votre langue.",
        s2: "L'application se recharge dans la nouvelle langue.",
      },
      tips: {
        t1: "Les titres et les synopsis viennent de leurs sources et gardent la langue de ces sources.",
      },
    },
    shortcuts: {
      title: "Raccourcis clavier",
      intro: "La plupart des actions ont un raccourci. La liste change avec chaque écran, pour que vous voyiez toujours ceux qui fonctionnent là où vous êtes.",
      steps: {
        s1: "Appuyez sur ? sur n'importe quel écran pour afficher ou masquer la fiche des raccourcis.",
        s2: "La fiche les regroupe en Généraux, Page, Fenêtre et Lecteur.",
        s3: "Paramètres › Préférences › Raccourcis clavier affiche la même liste.",
      },
      tips: {
        t1: "Les raccourcis ne sont pas encore personnalisables.",
        t2: "Les raccourcis ne se déclenchent pas pendant que vous tapez dans un champ de texte, sauf ceux prévus pour cela (comme Ctrl+S dans les éditeurs).",
      },
    },
    privacy: {
      title: "Utilisation hors ligne et confidentialité",
      intro: "Metadea est conçu pour fonctionner sans Internet. Votre bibliothèque, votre progression et vos réglages sont sur votre ordinateur ; le réseau ne sert qu'aux usages listés ci-dessous.",
      steps: {
        s1: "Au lancement, si vous êtes en ligne : une recherche de mises à jour et le téléchargement du dernier catalogue communautaire.",
        s2: "Quand vous cherchez ou ouvrez une nouvelle œuvre : des requêtes à ses sources (AniList, IGDB, TMDB, Open Library, Comic Vine…).",
        s3: "Quand vous enregistrez : la synchronisation avec AniList et MyAnimeList, seulement si vous les avez connectés.",
        s4: "Synchronisation du profil et activité : seulement avec un compte lié à Google, et la synchronisation du profil seulement quand vous la confirmez.",
      },
      tips: {
        t1: "Chaque source a une limite de requêtes ; si vous l'atteignez, Metadea attend et affiche une notification.",
        t2: "Discord n'est contacté qu'en local, sur votre propre ordinateur.",
      },
    },
    backup: {
      title: "Où sont vos données et sauvegardes",
      intro: "Tout est stocké dans une base de données dans votre dossier utilisateur (sous Windows, %APPDATA%\\com.metadea.app). Une sauvegarde copie ce dossier dans un seul fichier ZIP.",
      steps: {
        s1: "Ouvrez Paramètres › Sauvegarde et appuyez sur « Exporter les données ». Enregistrez le ZIP en dehors du dossier de données de Metadea.",
        s2: "Pour restaurer, appuyez sur « Importer les données » et choisissez un ZIP. Metadea enregistre d'abord une copie de vos données actuelles à côté du dossier, puis redémarre pour appliquer la sauvegarde.",
        s3: "« Ouvrir le dossier » dans Paramètres › Environnement › Chemins locaux ouvre le dossier de données.",
      },
      tips: {
        t1: "Personne d'autre n'a de copie de votre bibliothèque : faites une sauvegarde avant les gros changements et de temps en temps.",
      },
    },
    updates: {
      title: "Mises à jour et maintenance",
      intro: "Metadea recherche les nouvelles versions au lancement et demande avant d'installer quoi que ce soit.",
      steps: {
        s1: "Quand une nouvelle version est disponible, une fenêtre demande s'il faut l'installer ; l'application redémarre pour terminer.",
        s2: "Dans Paramètres › Nouveautés, appuyez sur « Rechercher des mises à jour » pour vérifier tout de suite.",
        s3: "Dans le même onglet, « Synchroniser maintenant » télécharge le catalogue communautaire et « Réparer les IDs » corrige les personnages enregistrés avec d'anciens IDs TMDB.",
      },
      tips: {
        t1: "Sans Internet, la vérification est ignorée sans bruit et tout le reste continue de fonctionner.",
      },
    },
  },
};
