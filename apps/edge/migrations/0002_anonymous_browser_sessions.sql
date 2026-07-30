ALTER TABLE users
ADD COLUMN access_kind TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX users_access_kind
ON users(access_kind);
