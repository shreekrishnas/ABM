-- Rows as they exist before 20261123100000_client_ownership (campaign and sender names unique across
-- all clients, no owner columns). Covers every backfill case, including the ones production doesn't have.
INSERT INTO "Client" (id, name) VALUES ('manch', 'Manch'), ('beta', 'Beta') ON CONFLICT (id) DO NOTHING;
INSERT INTO "Account" (id, "sellerId", name, "updatedAt") VALUES ('a_m', 'manch', 'Manch Co', now()), ('a_b', 'beta', 'Beta Co', now());
INSERT INTO "Contact" (id, "accountId", "fullName", "updatedAt") VALUES ('c_m', 'a_m', 'Mira', now()), ('c_b', 'a_b', 'Bea', now());
-- camp_m: used by one client's journeys; camp_b: by one client's import; camp_shared: by two clients; camp_unused: by none.
INSERT INTO "Campaign" (id, name) VALUES ('camp_m', 'Q4 outreach'), ('camp_b', 'Vendor clean-up'), ('camp_shared', 'Shared'), ('camp_unused', 'Unused');
INSERT INTO "SenderProfile" (id, name) VALUES ('snd_m', 'Priya'), ('snd_b', 'Karan'), ('snd_shared', 'Shared sender'), ('snd_unused', 'Nobody');
INSERT INTO "Journey" (id, "contactId", "campaignId", "senderId", "updatedAt") VALUES
  ('j1', 'c_m', 'camp_m', 'snd_m', now()), ('j2', 'c_m', 'camp_shared', 'snd_shared', now()), ('j3', 'c_b', 'camp_shared', 'snd_shared', now());
INSERT INTO "ImportBatch" (id, "sellerId", filename, source, rows, accepted, rejected, errors, "campaignId", "senderId") VALUES ('ib1', 'beta', 'beta.csv', 'csv', 1, 1, 0, '[]', 'camp_b', 'snd_b');
-- Visits: one matched to a company; two from Apollo's list, not matched; one from the tracking script, not matched.
INSERT INTO "WebVisit" (id, url, path, topic, source, "accountId", "companyName") VALUES
  ('v_matched', 'https://beta.example/pricing', '/pricing', 'pricing', 'apollo', 'a_b', NULL),
  ('v_apollo1', 'https://apollo.io/website-visitors', '/website-visitors', 'general', 'apollo', NULL, 'Visitor One'),
  ('v_apollo2', 'https://apollo.io/website-visitors', '/website-visitors', 'general', 'apollo', NULL, 'Visitor Two'),
  ('v_script', 'https://site.example/', '/', 'general', 'tracking_script', NULL, 'Script Visitor');
-- Apollo fetches: Beta two days ago, Manch yesterday (the latest owns the unmatched Apollo visitors).
INSERT INTO "BackgroundJob" (id, kind, "sellerId", label, "createdAt") VALUES
  ('bj_old', 'apollo_fetch', 'beta', 'Fetch visitors', now() - interval '2 days'),
  ('bj_new', 'apollo_fetch', 'manch', 'Fetch visitors', now() - interval '1 day');
