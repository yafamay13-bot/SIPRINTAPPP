CREATE TABLE IF NOT EXISTS login_rate_limits (
  ip_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempts SMALLINT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_login_rate_limits_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
