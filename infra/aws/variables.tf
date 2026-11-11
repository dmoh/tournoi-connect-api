variable "account_id" {
  description = "Compte AWS autorisé : Terraform refuse de s'exécuter ailleurs."
  type        = string
  default     = "677142166254"
}

variable "region" {
  type    = string
  default = "eu-west-3"
}

variable "domain" {
  description = "Domaine du projet, zone Route 53 créée à l'achat du domaine."
  type        = string
  default     = "tournoi-connect.com"
}

variable "github_owner" {
  description = "Propriétaire GitHub des dépôts : nom et identifiant numérique."
  type        = object({ name = string, id = number })
  default     = { name = "dmoh", id = 30497081 }
}

variable "github_repositories" {
  description = <<-EOT
    Dépôts autorisés à déployer par OIDC (aucune clé longue durée), avec leur
    identifiant numérique : les jetons GitHub portent un sujet à identifiants
    immuables (repo:dmoh@30497081/tournoi-connect-front@1451899734:…), qui ne
    change pas si un dépôt est renommé ou recréé sous le même nom.
  EOT
  type        = map(number)
  default = {
    "tournoi-connect-front" = 1451899734
    "tournoi-connect-api"   = 1451902027
  }
}

variable "instance_type" {
  description = "Type des serveurs : petits types seulement (budget, garde-fous IAM)."
  type        = string
  default     = "t3a.small"
}

variable "alert_email" {
  description = <<-EOT
    Adresse qui reçoit les alertes de disponibilité. Elle n'est pas écrite
    dans le dépôt : TF_VAR_alert_email au moment du plan. Vide, les alarmes
    existent sans destinataire.
  EOT
  type        = string
  default     = ""
}
