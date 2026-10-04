-- TCC Clinic: MySQL schema for users / accounts (MySQL 8+ or MariaDB 10.5+).
-- Derived from docs/schema.sql (users, students, sessions). Applied automatically at startup
-- (CREATE TABLE IF NOT EXISTS, so it is safe to run again), or run it by hand:
--   mysql -u root -p tcc_clinic < docs/schema.mysql.sql
--
-- Changes from docs/schema.sql (which is written to be portable and does not run as-is on MySQL):
--   * photo is MEDIUMTEXT, not TEXT: profile photos are base64 images up to ~200 KB.
--   * foreign keys are table-level (MySQL ignores inline "REFERENCES").
--   * password_reset_tokens is new: reset tokens used to live in db.json.
-- Keep every statement ending in a semicolon at the end of a line, and no semicolons inside comments.

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(20)  NOT NULL PRIMARY KEY,
  role          VARCHAR(10)  NOT NULL,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(120) NULL UNIQUE,
  student_id    VARCHAR(12)  NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  status        VARCHAR(10)  NOT NULL DEFAULT 'active',
  photo         MEDIUMTEXT   NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_users_role   CHECK (role IN ('student','staff','admin')),
  CONSTRAINT ck_users_status CHECK (status IN ('active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  user_id           VARCHAR(20)  NOT NULL PRIMARY KEY,
  course            VARCHAR(20)  NULL,
  year_level        VARCHAR(12)  NULL,
  contact           VARCHAR(20)  NULL,
  birthdate         DATE         NULL,
  gender            VARCHAR(10)  NULL,
  blood_type        VARCHAR(3)   NULL,
  address           VARCHAR(200) NULL,
  emergency_contact VARCHAR(150) NULL,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  jti       VARCHAR(30) NOT NULL PRIMARY KEY,
  user_id   VARCHAR(20) NOT NULL,
  exp       BIGINT      NOT NULL,
  last_seen BIGINT      NOT NULL,
  remember  BOOLEAN     NOT NULL DEFAULT FALSE,
  INDEX ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash CHAR(64)    NOT NULL PRIMARY KEY,
  user_id    VARCHAR(20) NOT NULL,
  expires    BIGINT      NOT NULL,
  INDEX ix_reset_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
