/**
 * Données de démonstration, identiques à celles de la PWA : six tournois
 * fictifs en Haute-Savoie, dont un en cours avec poules, scores, News et
 * sponsors. Clubs et commerces fictifs.
 */
import type {
  MatchStatus,
  PackTier,
  Phase,
  PostKind,
  SponsorSource,
  SponsorStatus,
  Sport,
  TournamentStatus,
} from '../generated/prisma/enums.js';

export interface DemoVenue {
  key: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  outdoor: boolean;
}

export interface DemoTournament {
  slug: string;
  name: string;
  sport: Sport;
  organization: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  categories: string[];
  teamCount: number;
  maxTeams: number;
  feeCents: number;
  status: TournamentStatus;
}

export const DEMO_ORGANIZATIONS = [
  { slug: 'etoile-de-l-arve', name: "Étoile de l'Arve" },
  { slug: 'stade-du-mont-blanc', name: 'Stade du Mont-Blanc' },
  { slug: 'avenir-des-bornes', name: 'Avenir des Bornes' },
  { slug: 'union-du-mont-blanc', name: 'Union du Mont-Blanc' },
  { slug: 'racing-du-lac', name: 'Racing du Lac' },
  { slug: 'entente-du-chablais', name: 'Entente du Chablais' },
] as const;

export const DEMO_VENUES: DemoVenue[] = [
  {
    key: 'esserts',
    name: 'Stade des Esserts',
    city: 'Cluses',
    lat: 46.0606,
    lng: 6.5797,
    outdoor: true,
  },
  {
    key: 'sallanches',
    name: 'Stade municipal',
    city: 'Sallanches',
    lat: 45.9364,
    lng: 6.6319,
    outdoor: true,
  },
  {
    key: 'bonneville',
    name: 'Complexe sportif des Bouchets',
    city: 'Bonneville',
    lat: 46.078,
    lng: 6.4009,
    outdoor: true,
  },
  {
    key: 'annecy',
    name: 'Gymnase des Glaisins',
    city: 'Annecy',
    lat: 45.8992,
    lng: 6.1294,
    outdoor: false,
  },
  {
    key: 'thonon',
    name: 'Halle Olympique',
    city: 'Thonon-les-Bains',
    lat: 46.3705,
    lng: 6.4794,
    outdoor: false,
  },
  {
    key: 'chamonix',
    name: 'Stade de Chamonix',
    city: 'Chamonix-Mont-Blanc',
    lat: 45.9237,
    lng: 6.8694,
    outdoor: true,
  },
];

export const DEMO_TOURNAMENTS: DemoTournament[] = [
  {
    slug: 'challenge-u13-arve',
    name: "Challenge U13 de l'Arve",
    sport: 'football',
    organization: 'etoile-de-l-arve',
    venue: 'esserts',
    startsAt: '2026-11-09T09:00:00+01:00',
    endsAt: '2026-11-09T17:30:00+01:00',
    categories: ['U13'],
    teamCount: 8,
    maxTeams: 8,
    feeCents: 6000,
    status: 'IN_PROGRESS',
  },
  {
    slug: 'tournoi-11-novembre-u15',
    name: 'Tournoi du 11-Novembre U15',
    sport: 'football',
    organization: 'stade-du-mont-blanc',
    venue: 'sallanches',
    startsAt: '2026-11-11T09:30:00+01:00',
    endsAt: '2026-11-11T18:00:00+01:00',
    categories: ['U15'],
    teamCount: 10,
    maxTeams: 16,
    feeCents: 12000,
    status: 'REGISTRATION_OPEN',
  },
  {
    slug: 'coupe-noel-u11-bonneville',
    name: 'Coupe de Noël U11',
    sport: 'football',
    organization: 'avenir-des-bornes',
    venue: 'bonneville',
    startsAt: '2026-12-12T09:00:00+01:00',
    endsAt: '2026-12-12T16:00:00+01:00',
    categories: ['U11', 'U11 F'],
    teamCount: 6,
    maxTeams: 12,
    feeCents: 8000,
    status: 'REGISTRATION_OPEN',
  },
  {
    slug: 'open-handball-chamonix',
    name: 'Open de handball du Mont-Blanc',
    sport: 'handball',
    organization: 'union-du-mont-blanc',
    venue: 'chamonix',
    startsAt: '2026-11-15T10:00:00+01:00',
    endsAt: '2026-11-15T18:00:00+01:00',
    categories: ['Seniors'],
    teamCount: 12,
    maxTeams: 12,
    feeCents: 15000,
    status: 'REGISTRATION_CLOSED',
  },
  {
    slug: 'basket-3x3-annecy',
    name: "Open 3x3 d'Annecy",
    sport: 'basketball',
    organization: 'racing-du-lac',
    venue: 'annecy',
    startsAt: '2026-11-21T13:00:00+01:00',
    endsAt: '2026-11-21T20:00:00+01:00',
    categories: ['U18', 'Seniors'],
    teamCount: 18,
    maxTeams: 24,
    feeCents: 4000,
    status: 'REGISTRATION_OPEN',
  },
  {
    slug: 'volley-indoor-thonon',
    name: 'Volley indoor du Chablais',
    sport: 'volleyball',
    organization: 'entente-du-chablais',
    venue: 'thonon',
    startsAt: '2026-11-28T09:00:00+01:00',
    endsAt: '2026-11-28T19:00:00+01:00',
    categories: ['Mixte'],
    teamCount: 16,
    maxTeams: 16,
    feeCents: 10000,
    status: 'REGISTRATION_OPEN',
  },
];

/** Tournoi en cours, avec équipes, matchs, News et sponsors. */
export const LIVE_SLUG = 'challenge-u13-arve';

export const DEMO_TEAMS = [
  { code: 'eda', name: "Étoile de l'Arve", shortName: 'EDA', group: 'A' },
  { code: 'rdg', name: 'Racing du Giffre', shortName: 'RDG', group: 'A' },
  { code: 'adb', name: 'Avenir des Bornes', shortName: 'ADB', group: 'A' },
  { code: 'uds', name: 'Union du Salève', shortName: 'UDS', group: 'A' },
  { code: 'oda', name: 'Olympique des Aravis', shortName: 'ODA', group: 'B' },
  { code: 'smb', name: 'Stade du Mont-Blanc', shortName: 'SMB', group: 'B' },
  { code: 'edc', name: 'Entente du Chablais', shortName: 'EDC', group: 'B' },
  { code: 'jdf', name: 'Jeunesse du Faucigny', shortName: 'JDF', group: 'B' },
];

interface DemoMatch {
  code: string;
  phase: Phase;
  group?: string;
  field: string;
  time: string;
  home?: string;
  away?: string;
  homePlaceholder?: string;
  awayPlaceholder?: string;
  scoreHome: number;
  scoreAway: number;
  status: MatchStatus;
  minute?: number;
}

export const DEMO_MATCHES: DemoMatch[] = [
  {
    code: 'a1',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '09:00',
    home: 'eda',
    away: 'rdg',
    scoreHome: 2,
    scoreAway: 1,
    status: 'FINISHED',
  },
  {
    code: 'b1',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '09:00',
    home: 'oda',
    away: 'smb',
    scoreHome: 0,
    scoreAway: 0,
    status: 'FINISHED',
  },
  {
    code: 'a2',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '09:30',
    home: 'adb',
    away: 'uds',
    scoreHome: 1,
    scoreAway: 3,
    status: 'FINISHED',
  },
  {
    code: 'b2',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '09:30',
    home: 'edc',
    away: 'jdf',
    scoreHome: 2,
    scoreAway: 2,
    status: 'FINISHED',
  },
  {
    code: 'a3',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '10:00',
    home: 'eda',
    away: 'adb',
    scoreHome: 4,
    scoreAway: 0,
    status: 'FINISHED',
  },
  {
    code: 'b3',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '10:00',
    home: 'oda',
    away: 'edc',
    scoreHome: 1,
    scoreAway: 2,
    status: 'FINISHED',
  },
  {
    code: 'a4',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '10:30',
    home: 'rdg',
    away: 'uds',
    scoreHome: 1,
    scoreAway: 1,
    status: 'FINISHED',
  },
  {
    code: 'b4',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '10:30',
    home: 'smb',
    away: 'jdf',
    scoreHome: 3,
    scoreAway: 1,
    status: 'FINISHED',
  },
  {
    code: 'a5',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '11:00',
    home: 'eda',
    away: 'uds',
    scoreHome: 1,
    scoreAway: 0,
    status: 'LIVE',
    minute: 14,
  },
  {
    code: 'b5',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '11:00',
    home: 'oda',
    away: 'jdf',
    scoreHome: 0,
    scoreAway: 1,
    status: 'LIVE',
    minute: 12,
  },
  {
    code: 'a6',
    phase: 'groups',
    group: 'A',
    field: 'Terrain 1',
    time: '11:30',
    home: 'rdg',
    away: 'adb',
    scoreHome: 0,
    scoreAway: 0,
    status: 'SCHEDULED',
  },
  {
    code: 'b6',
    phase: 'groups',
    group: 'B',
    field: 'Terrain 2',
    time: '11:30',
    home: 'smb',
    away: 'edc',
    scoreHome: 0,
    scoreAway: 0,
    status: 'SCHEDULED',
  },
  {
    code: 'df1',
    phase: 'semi',
    field: 'Terrain 1',
    time: '14:00',
    homePlaceholder: '1er poule A',
    awayPlaceholder: '2e poule B',
    scoreHome: 0,
    scoreAway: 0,
    status: 'SCHEDULED',
  },
  {
    code: 'df2',
    phase: 'semi',
    field: 'Terrain 2',
    time: '14:00',
    homePlaceholder: '1er poule B',
    awayPlaceholder: '2e poule A',
    scoreHome: 0,
    scoreAway: 0,
    status: 'SCHEDULED',
  },
  {
    code: 'f',
    phase: 'final',
    field: 'Terrain 1',
    time: '16:00',
    homePlaceholder: 'Vainqueur DF1',
    awayPlaceholder: 'Vainqueur DF2',
    scoreHome: 0,
    scoreAway: 0,
    status: 'SCHEDULED',
  },
];

interface DemoPost {
  kind: PostKind;
  publishedAt: string;
  title: string;
  body: string;
  matchCode?: string;
  options?: string[];
}

export const DEMO_POSTS: DemoPost[] = [
  {
    kind: 'POLL',
    publishedAt: '2026-11-09T11:05:00+01:00',
    title: 'Où remettre les prix ?',
    body: 'Votez pour le lieu de la remise des prix, à 17 h.',
    options: ['Sur le terrain 1', 'Sous le chapiteau de la buvette'],
  },
  {
    kind: 'RESULT',
    publishedAt: '2026-11-09T10:52:00+01:00',
    title: 'Stade du Mont-Blanc 3 – 1 Jeunesse du Faucigny',
    body: 'Le Stade du Mont-Blanc prend la tête de la poule B.',
    matchCode: 'b4',
  },
  {
    kind: 'RESULT',
    publishedAt: '2026-11-09T10:22:00+01:00',
    title: "Étoile de l'Arve 4 – 0 Avenir des Bornes",
    body: "Deuxième victoire pour l'Étoile de l'Arve, qui reste invaincue.",
    matchCode: 'a3',
  },
  {
    kind: 'RESULT',
    publishedAt: '2026-11-09T09:52:00+01:00',
    title: 'Entente du Chablais 2 – 2 Jeunesse du Faucigny',
    body: 'Partage des points dans un match ouvert.',
    matchCode: 'b2',
  },
  {
    kind: 'ANNOUNCEMENT',
    publishedAt: '2026-11-09T08:15:00+01:00',
    title: 'Bienvenue au Challenge U13 !',
    body: 'Buvette ouverte toute la journée près du terrain 1. Demi-finales à 14 h, finale à 16 h.',
  },
];

interface DemoSponsor {
  name: string;
  website?: string;
  source: SponsorSource;
  /** Absent : sponsor du club importé, pas encore invité sur ce tournoi. */
  status?: SponsorStatus;
  tier?: PackTier;
  field?: string;
}

/** Sponsors de l'organisation « Étoile de l'Arve » et leur place sur le tournoi en cours. */
export const DEMO_SPONSORS: DemoSponsor[] = [
  {
    name: 'Fromagerie des Aravis',
    website: 'https://example.org/fromagerie',
    source: 'TOURNAMENT',
    status: 'PAID',
    tier: 'GOLD',
  },
  {
    name: 'Optique du Giffre',
    source: 'TOURNAMENT',
    status: 'PAID',
    tier: 'SILVER',
  },
  {
    name: 'Pizzeria La Cordée',
    source: 'TOURNAMENT',
    status: 'PAID',
    tier: 'BRONZE',
  },
  {
    name: 'Boulangerie des Esserts',
    source: 'CLUB',
    status: 'PAID',
    tier: 'BRONZE',
  },
  {
    name: 'Garage du Mont-Blanc',
    source: 'TOURNAMENT',
    status: 'PAID',
    tier: 'FIELD',
    field: 'Terrain 1',
  },
  {
    name: 'Cycles de la Vallée',
    source: 'TOURNAMENT',
    status: 'PAID',
    tier: 'FIELD',
    field: 'Terrain 2',
  },
  {
    name: 'Menuiserie des Bornes',
    source: 'TOURNAMENT',
    status: 'INVITED',
    tier: 'SILVER',
  },
  { name: 'Assurances du Faucigny', source: 'CLUB' },
  { name: 'Électricité Arve Services', source: 'CLUB' },
];

/** Packs du tournoi en cours, aux prix suggérés du cahier des charges. */
export const DEMO_PACKAGES: {
  tier: PackTier;
  priceCents: number;
  inventory: number;
}[] = [
  { tier: 'GOLD', priceCents: 90000, inventory: 1 },
  { tier: 'SILVER', priceCents: 40000, inventory: 2 },
  { tier: 'BRONZE', priceCents: 15000, inventory: 4 },
  { tier: 'FIELD', priceCents: 9000, inventory: 2 },
];

interface DemoMatchEvent {
  match: string;
  type: 'GOAL' | 'YELLOW_CARD' | 'SAVE' | 'PHOTO';
  side?: 'HOME' | 'AWAY';
  minute: number;
  player?: string;
  assist?: string;
  caption?: string;
  /** Heure d'enregistrement, le 9 novembre (heure de Paris). */
  at: string;
}

/** Fil des deux matchs en direct, cohérent avec leur score (1 – 0 et 0 – 1). */
export const DEMO_MATCH_EVENTS: DemoMatchEvent[] = [
  {
    match: 'a5',
    type: 'GOAL',
    side: 'HOME',
    minute: 3,
    player: 'L. Martin',
    assist: 'N. Dubois',
    at: '11:03:10',
  },
  {
    match: 'a5',
    type: 'YELLOW_CARD',
    side: 'AWAY',
    minute: 8,
    player: 'K. Diallo',
    at: '11:08:02',
  },
  {
    match: 'a5',
    type: 'SAVE',
    side: 'AWAY',
    minute: 12,
    player: 'T. Roux',
    at: '11:09:48',
  },
  {
    match: 'b5',
    type: 'GOAL',
    side: 'AWAY',
    minute: 6,
    player: 'M. Perrin',
    at: '11:06:30',
  },
  {
    match: 'b5',
    type: 'PHOTO',
    minute: 10,
    caption: '« Quelle frappe ! »',
    at: '11:09:30',
  },
];

/** Réactions déjà reçues par le match a5 (👏 24, 🔥 9, 😮 3). */
export const DEMO_REACTIONS = {
  match: 'a5',
  counts: { CLAP: 24, FIRE: 9, WOW: 3 },
} as const;
