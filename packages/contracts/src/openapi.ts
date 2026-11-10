// Fichier généré par `pnpm openapi` — ne pas modifier à la main.

export interface paths {
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sonde de vie */
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sonde de disponibilité */
        get: operations["HealthController_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/tournaments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tournois en cours ou à venir autour d’un point */
        get: operations["PublicController_search_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/tournaments/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Page publique d’un tournoi : équipes, matchs, classements */
        get: operations["PublicController_detail_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/tournaments/{slug}/news": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fil News, une carte sponsorisée au plus pour quatre éléments */
        get: operations["PublicController_news_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/tournaments/{slug}/sponsors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sponsors affichés : bannière Or, bandeau partagé, terrains */
        get: operations["PublicController_sponsors_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/posts/{postId}/votes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Vote anonyme à un sondage du fil News */
        post: operations["PublicController_vote_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/audience": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Impression ou clic d’un sponsor, cumulé par heure */
        post: operations["PublicController_audience_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/tournaments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Écran 01 : les tournois de l’organisation */
        get: operations["OrganizerController_tournaments_v1"];
        put?: never;
        /** Publier le tournoi de l’assistant de création (écrans 02 à 05) */
        post: operations["OrganizerController_createTournament_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/tournaments/{slug}/sponsors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Écran 09 : packs, sponsors du tournoi et prospects du club */
        get: operations["OrganizerController_sponsors_v1"];
        put?: never;
        /** Inviter un sponsor à prendre un pack */
        post: operations["OrganizerController_invite_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/tournament-sponsors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Marquer un sponsor payé (paiement hors Stripe) ou de nouveau invité */
        patch: operations["OrganizerController_update_v1"];
        trace?: never;
    };
    "/api/v1/organizer/tournaments/{slug}/posts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publier une annonce ou un sondage dans le fil News */
        post: operations["OrganizerController_createPost_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    HealthController_ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The Health Check is successful */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example ok
                         * @enum {string}
                         */
                        status?: "ok" | "degraded";
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /** @example {} */
                        error?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description The Health Check is not successful */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /**
                         * @example error
                         * @enum {string}
                         */
                        status?: "error" | "shutting_down";
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       }
                         *     }
                         */
                        info?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        error?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        /**
                         * @example {
                         *       "database": {
                         *         "status": "up",
                         *         "responseTime": 12
                         *       },
                         *       "redis": {
                         *         "status": "down",
                         *         "message": "Could not connect",
                         *         "responseTime": 3005
                         *       }
                         *     }
                         */
                        details?: {
                            [key: string]: {
                                /** @enum {string} */
                                status: "up" | "degraded" | "down";
                                /** @description Time the health indicator took to respond, in ms */
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
        };
    };
    PublicController_search_v1: {
        parameters: {
            query: {
                lat: number;
                lng: number;
                radiusKm?: number;
                sport?: "football" | "handball" | "basketball" | "volleyball" | "rugby";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        slug: string;
                        name: string;
                        /** @enum {string} */
                        sport: "football" | "handball" | "basketball" | "volleyball" | "rugby";
                        organizer: string;
                        /** Format: date-time */
                        startsAt: string;
                        /** Format: date-time */
                        endsAt: string;
                        venue: {
                            name: string;
                            city: string;
                            lat: number;
                            lng: number;
                            outdoor: boolean;
                        };
                        categories: string[];
                        teamCount: number;
                        maxTeams: number;
                        feeCents: number;
                        /** @enum {string} */
                        status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "IN_PROGRESS" | "COMPLETED";
                        distanceKm: number;
                    }[];
                };
            };
        };
    };
    PublicController_detail_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        slug: string;
                        name: string;
                        /** @enum {string} */
                        sport: "football" | "handball" | "basketball" | "volleyball" | "rugby";
                        organizer: string;
                        /** Format: date-time */
                        startsAt: string;
                        /** Format: date-time */
                        endsAt: string;
                        venue: {
                            name: string;
                            city: string;
                            lat: number;
                            lng: number;
                            outdoor: boolean;
                        };
                        categories: string[];
                        teamCount: number;
                        maxTeams: number;
                        feeCents: number;
                        /** @enum {string} */
                        status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "IN_PROGRESS" | "COMPLETED";
                        teams: {
                            id: string;
                            name: string;
                            shortName: string;
                            club: string;
                            group?: string;
                        }[];
                        matches: {
                            id: string;
                            /** @enum {string} */
                            phase: "groups" | "round-of-32" | "round-of-16" | "quarter" | "semi" | "final";
                            group?: string;
                            field: string;
                            /** Format: date-time */
                            startsAt: string;
                            homeTeamId: string | null;
                            awayTeamId: string | null;
                            homePlaceholder?: string;
                            awayPlaceholder?: string;
                            scoreHome: number;
                            scoreAway: number;
                            /** @enum {string} */
                            status: "SCHEDULED" | "LIVE" | "FINISHED";
                            minute?: number;
                        }[];
                        standings: {
                            group: string;
                            rows: {
                                teamId: string;
                                played: number;
                                won: number;
                                drawn: number;
                                lost: number;
                                goalsFor: number;
                                goalsAgainst: number;
                                points: number;
                            }[];
                        }[];
                    };
                };
            };
            /** @description Tournoi inconnu ou non publié */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PublicController_news_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": ({
                        /** @enum {string} */
                        type: "post";
                        id: string;
                        /** @enum {string} */
                        kind: "announcement" | "result" | "poll";
                        /** Format: date-time */
                        publishedAt: string;
                        title: string;
                        body: string;
                        matchId?: string;
                        poll?: {
                            options: {
                                id: string;
                                label: string;
                                votes: number;
                            }[];
                        };
                    } | {
                        /** @enum {string} */
                        type: "sponsored";
                        sponsor: {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                            /** Format: uri */
                            website?: string;
                        };
                    })[];
                };
            };
        };
    };
    PublicController_sponsors_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        exclusive: {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                            /** Format: uri */
                            website?: string;
                        } | null;
                        rotation: {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                            /** Format: uri */
                            website?: string;
                        }[];
                        fields: {
                            field: string;
                            sponsor: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                                /** Format: uri */
                                website?: string;
                            };
                        }[];
                    };
                };
            };
        };
    };
    PublicController_vote_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                postId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    optionId: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        options: {
                            id: string;
                            label: string;
                            votes: number;
                        }[];
                    };
                };
            };
        };
    };
    PublicController_audience_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    sponsorId: string;
                    /** @enum {string} */
                    placement: "BANNER_EXCLUSIVE" | "BANNER_ROTATION" | "FIELD_LOGO" | "FEED_CARD";
                    /** @enum {string} */
                    kind: "impression" | "click";
                };
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_tournaments_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        slug: string;
                        name: string;
                        /** @enum {string} */
                        status: "DRAFT" | "PUBLISHED" | "IN_PROGRESS";
                        /** Format: date-time */
                        startsAt: string;
                        city: string;
                        teamCount: number;
                        maxTeams: number;
                        /** @enum {string} */
                        sport: "football" | "handball" | "basketball" | "volleyball" | "rugby";
                        venueName: string;
                        categories: string[];
                        fields: number;
                    }[];
                };
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_createTournament_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    sport: "football" | "handball" | "basketball" | "volleyball" | "rugby";
                    /** Format: date */
                    date: string;
                    startTime: string;
                    endTime: string;
                    venueName: string;
                    city: string;
                    lat: number;
                    lng: number;
                    fields: number;
                    outdoor: boolean;
                    categories: string[];
                    maxTeams: number;
                    feeEuros: number;
                    /** Format: date */
                    registrationDeadline: string;
                    /** @enum {string} */
                    format: "single-group" | "groups-knockout" | "knockout" | "swiss";
                    matchMinutes: number;
                    breakMinutes: number;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        slug: string;
                        name: string;
                        /** @enum {string} */
                        status: "DRAFT" | "PUBLISHED" | "IN_PROGRESS";
                        /** Format: date-time */
                        startsAt: string;
                        city: string;
                        teamCount: number;
                        maxTeams: number;
                        /** @enum {string} */
                        sport: "football" | "handball" | "basketball" | "volleyball" | "rugby";
                        venueName: string;
                        categories: string[];
                        fields: number;
                    };
                };
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_sponsors_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        packages: {
                            /** @enum {string} */
                            tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                            priceCents: number;
                            inventory: number;
                            taken: number;
                        }[];
                        sponsors: {
                            id: string;
                            sponsorId: string;
                            name: string;
                            /** Format: email */
                            email?: string;
                            /** @enum {string} */
                            status: "PROSPECT" | "INVITED" | "PAID";
                            /** @enum {string} */
                            tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                            field?: string;
                            impressions: number;
                            clicks: number;
                        }[];
                        prospects: {
                            id: string;
                            name: string;
                            /** Format: email */
                            email?: string;
                        }[];
                    };
                };
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Tournoi hors de l’organisation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_invite_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    sponsorId?: string;
                    name?: string;
                    /** Format: email */
                    email?: string;
                    /** @enum {string} */
                    tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                    field?: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        sponsorId: string;
                        name: string;
                        /** Format: email */
                        email?: string;
                        /** @enum {string} */
                        status: "PROSPECT" | "INVITED" | "PAID";
                        /** @enum {string} */
                        tier: "GOLD" | "SILVER" | "BRONZE" | "FIELD";
                        field?: string;
                        impressions: number;
                        clicks: number;
                    };
                };
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Pack épuisé ou sponsor déjà présent */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_update_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status: "INVITED" | "PAID";
                };
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_createPost_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    kind: "announcement" | "poll";
                    title: string;
                    /** @default  */
                    body?: string;
                    options?: string[];
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** Format: date-time */
                        publishedAt: string;
                    };
                };
            };
            /** @description Jeton absent ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
