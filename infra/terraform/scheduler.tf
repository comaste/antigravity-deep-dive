resource "google_service_account" "scheduler_sa" {
  project      = var.project_id
  account_id   = "${var.service_name}-scheduler-sa"
  display_name = "Cloud Scheduler Service Account for ${var.service_name}"
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_sa.email}"
}

resource "google_cloud_scheduler_job" "sync_trigger" {
  project     = var.project_id
  region      = var.region
  name        = "${var.service_name}-sync-trigger"
  description = "Trigger Notion & Box incremental sync every 30 minutes"
  schedule    = "*/30 * * * *"
  time_zone   = "Asia/Tokyo"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.app.uri}/api/sync/trigger"

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler_sa.email
      audience              = google_cloud_run_v2_service.app.uri
    }
  }

  depends_on = [
    google_project_service.enabled_apis["cloudscheduler.googleapis.com"],
    google_cloud_run_v2_service_iam_member.scheduler_invoker,
  ]
}
