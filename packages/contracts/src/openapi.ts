// Fichier généré par `pnpm openapi` — ne pas modifier à la main.

export interface paths {
    "/api/v1/auth/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fournisseurs de connexion en un clic configurés */
        get: operations["AuthController_providers_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Envoyer un code de connexion à 6 chiffres par email */
        post: operations["AuthController_requestCode_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ouvrir une session avec le code reçu (crée le compte au besoin) */
        post: operations["AuthController_verify_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Nouveau jeton d’accès depuis le cookie de session */
        post: operations["AuthController_refresh_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fermer la session de cet appareil */
        post: operations["AuthController_logout_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mon compte : profil, moyens de connexion, clubs et sponsors */
        get: operations["AuthController_me_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Compléter son prénom et son nom */
        patch: operations["AuthController_updateMe_v1"];
        trace?: never;
    };
    "/api/v1/me/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Télécharger mes données (JSON) */
        get: operations["AccountController_export_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Supprimer mon compte (confirmé par la saisie de mon adresse) */
        post: operations["AccountController_delete_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
        /** Tournois en cours ou à venir autour d’un point, par distance, date puis id (paginé) */
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
    "/api/v1/public/tournaments/{slug}/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Matchs d’une journée (heure de Paris), par créneau puis par phase, et journées du tournoi */
        get: operations["PublicController_matches_v1"];
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
        /** Fil News paginé, plus récent en tête ; une carte sponsorisée au plus pour quatre éléments */
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
    "/api/v1/public/tournaments/{slug}/matches/{matchId}/feed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fil du direct d’un match : événements, réactions, mise à jour */
        get: operations["PublicController_matchFeed_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/tournaments/{slug}/matches/{matchId}/reactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Réaction anonyme d’un spectateur, une par appareil et par emoji */
        post: operations["PublicController_react_v1"];
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
    "/api/v1/organizer/tournaments/{slug}/matches/{matchId}/reporter-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Lien de la table de marque d’un match, valable 24 heures */
        post: operations["OrganizerController_reporterLink_v1"];
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
        /** Écran 01 : les tournois de l’organisation (lecture dès bénévole) */
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
    "/api/v1/organizer/tournaments/{slug}/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Écran 07 : publier le planning (terrain et heure des matchs à venir) */
        put: operations["OrganizerController_saveSchedule_v1"];
        post?: never;
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
    "/api/v1/reporter/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Match ouvert par le lien du rapporteur, avec les effectifs */
        get: operations["ReporterController_match_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reporter/{token}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Saisie du rapporteur (but, carton, arrêt, photo, période, annulation) */
        post: operations["ReporterController_record_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/tournaments/{slug}/matches/{matchId}/reporter-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Révoquer tous les liens de la table de marque d’un match */
        delete: operations["ReporterLinksController_revoke_v1"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clubs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Créer un club (on en devient propriétaire) */
        post: operations["ClubsController_create_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Membres du club (paginés, par rôle puis arrivée) et invitations en attente */
        get: operations["MembersController_members_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inviter par email (admin ; propriétaire pour inviter un propriétaire) */
        post: operations["MembersController_invite_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Annuler une invitation en attente */
        delete: operations["MembersController_revoke_v1"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Retirer un membre, ou quitter le club (son propre identifiant) */
        delete: operations["MembersController_remove_v1"];
        options?: never;
        head?: never;
        /** Changer le rôle d’un membre (propriétaire) */
        patch: operations["MembersController_updateRole_v1"];
        trace?: never;
    };
    "/api/v1/invitations/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Invitation lue par son lien (sans connexion) */
        get: operations["InvitationsController_invitation_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/{token}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rejoindre le club avec le compte de l’adresse invitée */
        post: operations["InvitationsController_accept_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/registrations/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Écran 08 : tournoi, prix, places et paiements du lien */
        get: operations["PublicRegistrationsController_invite_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tournaments/{code}/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inscrire son équipe : confirmée (gratuit), en attente de paiement (Stripe Checkout) ou en liste d’attente */
        post: operations["RegistrationsController_register_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mes équipes : mes inscriptions, plus récentes en tête */
        get: operations["RegistrationsController_mine_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registrations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Une de mes inscriptions (retour du paiement) */
        get: operations["RegistrationsController_one_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registrations/{id}/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reprendre un paiement expiré, s’il reste une place */
        post: operations["RegistrationsController_retry_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/tournaments/{slug}/registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inscriptions d’un tournoi du club : tri, filtre de statut, pagination */
        get: operations["OrganizerRegistrationsController_list_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Paiements en ligne du club (Stripe Connect) */
        get: operations["OrganizerRegistrationsController_payments_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizer/payments/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activer les paiements : lien vers la vérification Stripe */
        post: operations["OrganizerRegistrationsController_onboarding_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/push/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Clé publique VAPID pour s’abonner (null sans notifications) */
        get: operations["PushController_config_v1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/push/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Abonner ce navigateur avec ses suivis et préférences ; relié au compte si le jeton est fourni */
        put: operations["PushController_subscribe_v1"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/push/subscriptions/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Désabonner ce navigateur */
        post: operations["PushController_unsubscribe_v1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/follows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tournois et équipes suivis par le compte */
        get: operations["FollowsController_get_v1"];
        /** Remplacer les suivis du compte */
        put: operations["FollowsController_replace_v1"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/follows/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ajouter les suivis de l’appareil à ceux du compte (connexion) */
        post: operations["FollowsController_merge_v1"];
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
    AuthController_providers_v1: {
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
                        providers: ("GOOGLE" | "APPLE" | "FACEBOOK")[];
                    };
                };
            };
        };
    };
    AuthController_requestCode_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                };
            };
        };
        responses: {
            /** @description Code envoyé (même pour une adresse inconnue) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Plus de 5 codes en une heure */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_verify_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    code: string;
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
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            firstName: string | null;
                            lastName: string | null;
                            needsProfile: boolean;
                            providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                            memberships: {
                                organization: {
                                    slug: string;
                                    name: string;
                                };
                                /** @enum {string} */
                                role: "OWNER" | "ADMIN" | "STAFF";
                            }[];
                            sponsors: {
                                id: string;
                                name: string;
                                organization: string;
                            }[];
                            platformAdmin: boolean;
                        };
                    };
                };
            };
        };
    };
    AuthController_refresh_v1: {
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
                        accessToken: string;
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            firstName: string | null;
                            lastName: string | null;
                            needsProfile: boolean;
                            providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                            memberships: {
                                organization: {
                                    slug: string;
                                    name: string;
                                };
                                /** @enum {string} */
                                role: "OWNER" | "ADMIN" | "STAFF";
                            }[];
                            sponsors: {
                                id: string;
                                name: string;
                                organization: string;
                            }[];
                            platformAdmin: boolean;
                        };
                    };
                };
            };
            /** @description Pas de session ou session expirée */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_logout_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_me_v1: {
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
                        id: string;
                        email: string;
                        firstName: string | null;
                        lastName: string | null;
                        needsProfile: boolean;
                        providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                        memberships: {
                            organization: {
                                slug: string;
                                name: string;
                            };
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                        }[];
                        sponsors: {
                            id: string;
                            name: string;
                            organization: string;
                        }[];
                        platformAdmin: boolean;
                    };
                };
            };
        };
    };
    AuthController_updateMe_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    firstName: string;
                    lastName: string;
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
                        id: string;
                        email: string;
                        firstName: string | null;
                        lastName: string | null;
                        needsProfile: boolean;
                        providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                        memberships: {
                            organization: {
                                slug: string;
                                name: string;
                            };
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                        }[];
                        sponsors: {
                            id: string;
                            name: string;
                            organization: string;
                        }[];
                        platformAdmin: boolean;
                    };
                };
            };
        };
    };
    AccountController_export_v1: {
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
                        /** Format: date-time */
                        exportedAt: string;
                        account: {
                            id: string;
                            email: string;
                            firstName: string | null;
                            lastName: string | null;
                            locale: string;
                            /** Format: date-time */
                            createdAt: string;
                        };
                        identities: {
                            /** @enum {string} */
                            provider: "EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT";
                            subject: string;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        sessions: {
                            userAgent: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            lastUsedAt: string;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: date-time */
                            revokedAt: string | null;
                        }[];
                        memberships: {
                            organization: {
                                slug: string;
                                name: string;
                            };
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        sponsorAccess: {
                            sponsor: string;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        invitationsSent: {
                            organization: string;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            acceptedAt: string | null;
                            /** Format: date-time */
                            revokedAt: string | null;
                        }[];
                        registrations: {
                            id: string;
                            tournament: {
                                slug: string;
                                name: string;
                            };
                            teamName: string;
                            club: string;
                            managerName: string;
                            phone: string;
                            players: unknown;
                            /** @enum {string} */
                            status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                            totalCents: number;
                            /** Format: date-time */
                            paidAt: string | null;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        follows: {
                            /** @enum {string} */
                            kind: "TOURNAMENT" | "TEAM";
                            target: string;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        pushSubscriptions: {
                            service: string;
                            tournaments: string[];
                            teams: string[];
                            kickoff: boolean;
                            goals: boolean;
                            results: boolean;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            lastSentAt: string | null;
                        }[];
                    };
                };
            };
        };
    };
    AccountController_delete_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                };
            };
        };
        responses: {
            /** @description Compte supprimé, session fermée */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Adresse de confirmation différente */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Seul propriétaire d’un club, ou compte de test */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
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
                cursor?: string;
                limit?: number;
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
                        items: {
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
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Paramètre, limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    PublicController_matches_v1: {
        parameters: {
            query?: {
                day?: string;
            };
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
                        /** Format: date */
                        day: string;
                        days: string[];
                        /** Format: date */
                        previousDay: string | null;
                        /** Format: date */
                        nextDay: string | null;
                        slots: {
                            /** Format: date-time */
                            startsAt: string;
                            phases: {
                                /** @enum {string} */
                                phase: "groups" | "round-of-32" | "round-of-16" | "quarter" | "semi" | "final";
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
                            }[];
                        }[];
                    };
                };
            };
            /** @description Journée mal formée (AAAA-MM-JJ) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
            query?: {
                cursor?: string;
                limit?: number;
            };
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
                        items: ({
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
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    PublicController_matchFeed_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
                matchId: string;
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
                        events: {
                            id: string;
                            /** @enum {string} */
                            type: "GOAL" | "YELLOW_CARD" | "RED_CARD" | "SAVE" | "PHOTO" | "HALF_TIME" | "FULL_TIME";
                            /** @enum {string} */
                            side?: "home" | "away";
                            minute: number;
                            player?: string;
                            assist?: string;
                            caption?: string;
                            score: {
                                home: number;
                                away: number;
                            };
                        }[];
                        reactions: {
                            CLAP: number;
                            FIRE: number;
                            WOW: number;
                        };
                        /** Format: date-time */
                        updatedAt: string | null;
                    };
                };
            };
            /** @description Match ou tournoi inconnu */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PublicController_react_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
                matchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    kind: "CLAP" | "FIRE" | "WOW";
                    /** Format: uuid */
                    deviceId: string;
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
                        CLAP: number;
                        FIRE: number;
                        WOW: number;
                    };
                };
            };
            /** @description Match ou tournoi inconnu */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    OrganizerController_reporterLink_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                slug: string;
                matchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        token: string;
                        /** Format: uri */
                        url: string;
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Match hors de l’organisation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_tournaments_v1: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
                        items: {
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
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
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
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
                /** @description Clé unique de la demande (8 à 100 caractères : lettres, chiffres, _ ou -). La même clé rejoue la première réponse pendant 24 heures. */
                "Idempotency-Key"?: string;
            };
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
            /** @description Idempotency-Key invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requête de même clé encore en cours */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Idempotency-Key déjà utilisée pour un autre corps */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerController_saveSchedule_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    slots: {
                        match: string;
                        field: string;
                        minutes: number;
                    }[];
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
                        updated: number;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Tournoi ou match hors de l’organisation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Match déjà commencé */
            409: {
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
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
            /** @description Connexion requise */
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
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
                /** @description Clé unique de la demande (8 à 100 caractères : lettres, chiffres, _ ou -). La même clé rejoue la première réponse pendant 24 heures. */
                "Idempotency-Key"?: string;
            };
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
            /** @description Idempotency-Key invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Pack épuisé, sponsor déjà présent ou requête de même clé en cours */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Idempotency-Key déjà utilisée pour un autre corps */
            422: {
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
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
            /** @description Connexion requise */
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
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
                /** @description Clé unique de la demande (8 à 100 caractères : lettres, chiffres, _ ou -). La même clé rejoue la première réponse pendant 24 heures. */
                "Idempotency-Key"?: string;
            };
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
            /** @description Idempotency-Key invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requête de même clé encore en cours */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Idempotency-Key déjà utilisée pour un autre corps */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ReporterController_match_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
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
                        token: string;
                        tournamentSlug: string;
                        tournamentName: string;
                        matchId: string;
                        /** @enum {string} */
                        phase: "groups" | "round-of-32" | "round-of-16" | "quarter" | "semi" | "final";
                        field: string;
                        /** Format: date-time */
                        startsAt: string;
                        home: {
                            name: string;
                            shortName: string;
                            players: {
                                number: number;
                                name: string;
                            }[];
                        };
                        away: {
                            name: string;
                            shortName: string;
                            players: {
                                number: number;
                                name: string;
                            }[];
                        };
                        matchMinutes: number;
                        /** @enum {string} */
                        status: "SCHEDULED" | "LIVE" | "FINISHED";
                    };
                };
            };
            /** @description Lien invalide, expiré ou révoqué */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ReporterController_record_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    clientEventId: string;
                    /** @enum {string} */
                    type: "GOAL" | "YELLOW_CARD" | "RED_CARD" | "SAVE" | "PHOTO" | "HALF_TIME" | "FULL_TIME" | "CANCEL";
                    /** @enum {string} */
                    side?: "home" | "away";
                    minute: number;
                    player?: string;
                    assist?: string;
                    caption?: string;
                    cancels?: string;
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
                        score: {
                            home: number;
                            away: number;
                        };
                        /** @enum {string} */
                        status: "SCHEDULED" | "LIVE" | "FINISHED";
                    };
                };
            };
            /** @description Lien invalide, expiré ou révoqué */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Tournoi plus public, match terminé (seule la fin s’annule), annulation impossible, ou clientEventId déjà utilisé pour une autre saisie */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ReporterLinksController_revoke_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                slug: string;
                matchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Match hors de l’organisation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ClubsController_create_v1: {
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
                    city?: string;
                };
            };
        };
        responses: {
            /** @description Compte à jour, avec le nouveau club */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        firstName: string | null;
                        lastName: string | null;
                        needsProfile: boolean;
                        providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                        memberships: {
                            organization: {
                                slug: string;
                                name: string;
                            };
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                        }[];
                        sponsors: {
                            id: string;
                            name: string;
                            organization: string;
                        }[];
                        platformAdmin: boolean;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Nombre maximal de clubs atteint */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_members_v1: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
                        items: {
                            userId: string;
                            firstName: string | null;
                            lastName: string | null;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            joinedAt: string;
                            you: boolean;
                        }[];
                        nextCursor: string | null;
                        organization: {
                            slug: string;
                            name: string;
                            city: string | null;
                        };
                        /** @enum {string} */
                        yourRole: "OWNER" | "ADMIN" | "STAFF";
                        invitations: {
                            id: string;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            expiresAt: string;
                            invitedBy: string | null;
                        }[];
                    };
                };
            };
            /** @description Limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_invite_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    /** @enum {string} */
                    role: "OWNER" | "ADMIN" | "STAFF";
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
                        items: {
                            userId: string;
                            firstName: string | null;
                            lastName: string | null;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            joinedAt: string;
                            you: boolean;
                        }[];
                        nextCursor: string | null;
                        organization: {
                            slug: string;
                            name: string;
                            city: string | null;
                        };
                        /** @enum {string} */
                        yourRole: "OWNER" | "ADMIN" | "STAFF";
                        invitations: {
                            id: string;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            expiresAt: string;
                            invitedBy: string | null;
                        }[];
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Déjà membre du club */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Plus de 30 invitations par heure */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_revoke_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invitation introuvable */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_remove_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Dernier propriétaire du club */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Membre introuvable ou rôle insuffisant */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MembersController_updateRole_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    role: "OWNER" | "ADMIN" | "STAFF";
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
                        items: {
                            userId: string;
                            firstName: string | null;
                            lastName: string | null;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            joinedAt: string;
                            you: boolean;
                        }[];
                        nextCursor: string | null;
                        organization: {
                            slug: string;
                            name: string;
                            city: string | null;
                        };
                        /** @enum {string} */
                        yourRole: "OWNER" | "ADMIN" | "STAFF";
                        invitations: {
                            id: string;
                            email: string;
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                            expiresAt: string;
                            invitedBy: string | null;
                        }[];
                    };
                };
            };
            /** @description Dernier propriétaire du club */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Membre introuvable */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    InvitationsController_invitation_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
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
                        organization: {
                            slug: string;
                            name: string;
                            city: string | null;
                        };
                        /** @enum {string} */
                        role: "OWNER" | "ADMIN" | "STAFF";
                        email: string;
                        invitedBy: string | null;
                        expiresAt: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
                    };
                };
            };
            /** @description Lien inconnu */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    InvitationsController_accept_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Compte à jour, avec le club rejoint */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        firstName: string | null;
                        lastName: string | null;
                        needsProfile: boolean;
                        providers: ("EMAIL" | "GOOGLE" | "APPLE" | "FACEBOOK" | "ECOCLUBSPORT")[];
                        memberships: {
                            organization: {
                                slug: string;
                                name: string;
                            };
                            /** @enum {string} */
                            role: "OWNER" | "ADMIN" | "STAFF";
                        }[];
                        sponsors: {
                            id: string;
                            name: string;
                            organization: string;
                        }[];
                        platformAdmin: boolean;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invitation expirée, annulée ou utilisée */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Compte d’une autre adresse */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PublicRegistrationsController_invite_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
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
                        code: string;
                        tournament: {
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
                        };
                        quote: {
                            feeCents: number;
                            serviceFeeCents: number;
                            totalCents: number;
                        };
                        open: boolean;
                        full: boolean;
                        paymentsReady: boolean;
                    };
                };
            };
            /** @description Lien inconnu */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RegistrationsController_register_v1: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    teamName: string;
                    /** @default  */
                    club?: string;
                    managerName: string;
                    phone: string;
                    players: {
                        firstName: string;
                        lastName: string;
                        /** @default  */
                        number?: string;
                    }[];
                    /** @enum {boolean} */
                    acceptRules: true;
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
                        orderId: string;
                        code: string;
                        tournamentSlug: string;
                        tournamentName: string;
                        /** Format: date-time */
                        startsAt: string;
                        teamName: string;
                        /** @enum {string} */
                        status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                        quote: {
                            feeCents: number;
                            serviceFeeCents: number;
                            totalCents: number;
                        };
                        waitlistPosition?: number;
                        /** Format: uri */
                        checkoutUrl?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Inscriptions fermées */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Paiements du club non activés */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RegistrationsController_mine_v1: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
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
                        items: {
                            orderId: string;
                            code: string;
                            tournamentSlug: string;
                            tournamentName: string;
                            /** Format: date-time */
                            startsAt: string;
                            teamName: string;
                            /** @enum {string} */
                            status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                            quote: {
                                feeCents: number;
                                serviceFeeCents: number;
                                totalCents: number;
                            };
                            waitlistPosition?: number;
                            /** Format: uri */
                            checkoutUrl?: string;
                            /** Format: date-time */
                            expiresAt?: string;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RegistrationsController_one_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
                        orderId: string;
                        code: string;
                        tournamentSlug: string;
                        tournamentName: string;
                        /** Format: date-time */
                        startsAt: string;
                        teamName: string;
                        /** @enum {string} */
                        status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                        quote: {
                            feeCents: number;
                            serviceFeeCents: number;
                            totalCents: number;
                        };
                        waitlistPosition?: number;
                        /** Format: uri */
                        checkoutUrl?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Inscription introuvable */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RegistrationsController_retry_v1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
                        orderId: string;
                        code: string;
                        tournamentSlug: string;
                        tournamentName: string;
                        /** Format: date-time */
                        startsAt: string;
                        teamName: string;
                        /** @enum {string} */
                        status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                        quote: {
                            feeCents: number;
                            serviceFeeCents: number;
                            totalCents: number;
                        };
                        waitlistPosition?: number;
                        /** Format: uri */
                        checkoutUrl?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Inscriptions fermées */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerRegistrationsController_list_v1: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                sort?: "createdAt" | "-createdAt" | "teamName" | "-teamName";
                status?: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
            };
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
                        items: {
                            id: string;
                            teamName: string;
                            club: string;
                            managerName: string;
                            email: string | null;
                            phone: string;
                            players: number;
                            /** @enum {string} */
                            status: "PENDING_PAYMENT" | "CONFIRMED" | "WAITLISTED" | "EXPIRED" | "CANCELLED";
                            totalCents: number;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Tri, statut, limite ou curseur invalide */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Tournoi hors du club */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerRegistrationsController_payments_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
                        available: boolean;
                        connected: boolean;
                        chargesEnabled: boolean;
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    OrganizerRegistrationsController_onboarding_v1: {
        parameters: {
            query?: never;
            header?: {
                /** @description Club concerné (slug), si le compte en a plusieurs */
                "X-Organization"?: string;
            };
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
                        /** Format: uri */
                        url: string;
                    };
                };
            };
            /** @description Stripe a refusé la demande */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Paiements non configurés */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PushController_config_v1: {
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
                        publicKey: string | null;
                    };
                };
            };
        };
    };
    PushController_subscribe_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: starts_with */
                    endpoint: string;
                    keys: {
                        p256dh: string;
                        auth: string;
                    };
                    follows: {
                        tournaments: string[];
                        teams: string[];
                    };
                    preferences: {
                        kickoff: boolean;
                        goals: boolean;
                        results: boolean;
                    };
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
            /** @description Notifications non configurées */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    PushController_unsubscribe_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uri */
                    endpoint: string;
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
    FollowsController_get_v1: {
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
                        tournaments: string[];
                        teams: string[];
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    FollowsController_replace_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tournaments: string[];
                    teams: string[];
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
                        tournaments: string[];
                        teams: string[];
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    FollowsController_merge_v1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tournaments: string[];
                    teams: string[];
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
                        tournaments: string[];
                        teams: string[];
                    };
                };
            };
            /** @description Connexion requise */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
