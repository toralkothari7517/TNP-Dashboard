-- schema.sql: TNP Dashboard Database Schema

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    role TEXT NOT NULL,
    application_link TEXT,
    deadline TEXT NOT NULL, -- Stored in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm)
    sheet_row_id TEXT UNIQUE, -- Stable unique identifier (e.g. Row number from Sheet or hash of name+role)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_name, role) ON CONFLICT REPLACE
);

CREATE TABLE IF NOT EXISTS experience_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g. DSA, OOP, HR, Resume, System Design
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL, -- 'SUCCESS' or 'FAILURE'
    rows_synced INTEGER DEFAULT 0,
    error_message TEXT
);
