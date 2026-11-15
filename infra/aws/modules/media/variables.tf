variable "name" {
  description = "Environnement (preprod ou prod)"
  type        = string
}

variable "media_host" {
  description = "Domaine de diffusion des photos (ex. media.tournoi-connect.com)"
  type        = string
}

variable "app_host" {
  description = "Domaine de la PWA, seule origine autorisée à envoyer (CORS)"
  type        = string
}

variable "zone_id" {
  type = string
}

variable "bucket_name" {
  type = string
}
