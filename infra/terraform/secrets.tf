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

# Cloud Run 起動時に secret_key_ref の latest バージョン欠落によるプロビジョニング失敗を防ぐ初期バージョン
resource "google_secret_manager_secret_version" "app_secret_initial_versions" {
  for_each    = local.secret_ids
  secret      = google_secret_manager_secret.app_secrets[each.value].id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data]
  }
}
