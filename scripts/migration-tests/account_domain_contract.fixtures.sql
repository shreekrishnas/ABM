INSERT INTO "Client" (id, name) VALUES ('manch', 'Manch'), ('beta', 'Beta') ON CONFLICT (id) DO NOTHING;
INSERT INTO "Account" (id, "sellerId", name, domain, "updatedAt") VALUES
  ('a1', 'manch', 'Acme', 'acme.example', now()), ('a2', 'manch', 'No site', NULL, now()),
  ('a3', 'beta', 'Globex', 'globex.example', now()), ('a4', 'beta', 'No site either', NULL, now());
INSERT INTO "ImportBatch" (id, "sellerId", filename, source, rows, accepted, rejected, errors) VALUES ('ib1', 'beta', 'b.csv', 'csv', 1, 1, 0, '[]');
