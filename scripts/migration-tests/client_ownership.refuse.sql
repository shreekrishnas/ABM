-- A state the rollback must refuse: two clients each made a campaign with the same name.
INSERT INTO "Campaign" (id, "sellerId", name) VALUES ('dup_m', 'manch', 'Same name'), ('dup_b', 'beta', 'Same name');
