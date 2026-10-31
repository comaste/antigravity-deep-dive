resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [
    google_project_service.enabled_apis["firestore.googleapis.com"]
  ]
}

# Vector Search Index with provider filter
resource "google_firestore_index" "chunks_vector_by_provider" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "chunks"

  fields {
    field_path = "provider"
    order      = "ASCENDING"
  }

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 768
      flat {}
    }
  }
}

# Vector Search Index without provider filter (Collection scope)
resource "google_firestore_index" "chunks_vector_all" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "chunks"

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 768
      flat {}
    }
  }
}

# Keyword Search Index (provider + searchTokens array-contains-any)
resource "google_firestore_index" "chunks_keyword_by_provider" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "chunks"

  fields {
    field_path = "provider"
    order      = "ASCENDING"
  }

  fields {
    field_path   = "searchTokens"
    array_config = "CONTAINS"
  }
}
