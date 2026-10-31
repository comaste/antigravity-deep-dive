locals {
  secret_ids = toset([
    "notion-oauth-client-secret",
    "box-oauth-client-secret",
    "gemini-api-key",
  ])
}

resource "google_secret_manager_secret" "app_secrets" {
  for_each  = local.secret_ids
  project   = var.project_id
  secret_id = each.value

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [
    google_project_service.enabled_apis["secretmanager.googleapis.com"]
  ]
}
