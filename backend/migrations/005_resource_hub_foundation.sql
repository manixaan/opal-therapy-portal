-- ═══════════════════════════════════════════════════════════════════════════
--  005 — Resource Hub foundation (Phase R1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Governed clinical/educational resource repository. Foundation only:
-- folders, resources (with governance states), tags, files (via the existing
-- document-storage abstraction), favourites. Later phases add versions,
-- products, client suggestions, bundles. Files are PRIVATE — download only
-- through the authenticated, role-checked route.

CREATE TABLE IF NOT EXISTS resource_folders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  parent_id       UUID REFERENCES resource_folders(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  description     VARCHAR(500),
  sort_order      INTEGER DEFAULT 0,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  folder_id        UUID REFERENCES resource_folders(id) ON DELETE SET NULL,
  title            VARCHAR(300) NOT NULL,
  description      TEXT,
  resource_type    VARCHAR(50),      -- worksheet | handout | session_plan | product_link | research | pd_video | template | ...
  status           VARCHAR(30) NOT NULL DEFAULT 'draft',
    CONSTRAINT valid_resource_status CHECK (status IN
      ('draft','submitted_for_review','approved','needs_update','archived','rejected')),
  visibility       VARCHAR(20) NOT NULL DEFAULT 'staff',  -- staff | restricted
  external_url     TEXT,
  source_reference VARCHAR(500),
  copyright_status VARCHAR(100),
  evidence_level   VARCHAR(50),
  age_range        VARCHAR(50),
  safety_notes     TEXT,
  usage_instructions TEXT,
  created_by       UUID REFERENCES users(id),
  approved_by      UUID REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  review_due_at    DATE,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources (organisation_id, status);

CREATE TABLE IF NOT EXISTS resource_tags (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(30) NOT NULL,   -- diagnosis | therapy_area | population | type
  name     VARCHAR(100) NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE IF NOT EXISTS resource_tag_links (
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES resource_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);

-- Files ride the existing document-storage abstraction (db | local | blob).
CREATE TABLE IF NOT EXISTS resource_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  file_name       VARCHAR(300),
  file_mime       VARCHAR(100),
  file_size_bytes BIGINT,
  file_data       TEXT,             -- base64 when storage_backend='db'
  storage_backend VARCHAR(10) NOT NULL DEFAULT 'db',
  storage_key     TEXT,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resource_favourites (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, resource_id)
);

-- Seed the tag vocabularies (idempotent).
INSERT INTO resource_tags (category, name) VALUES
  ('diagnosis','Autism'),('diagnosis','ADHD'),('diagnosis','Intellectual Disability'),
  ('diagnosis','Global Developmental Delay'),('diagnosis','Developmental Delay'),('diagnosis','FASD'),
  ('diagnosis','Cerebral Palsy'),('diagnosis','Down Syndrome'),('diagnosis','Acquired Brain Injury'),
  ('diagnosis','Psychosocial Disability'),('diagnosis','Schizophrenia / Schizoaffective'),('diagnosis','Anxiety'),
  ('diagnosis','Sensory Processing'),('diagnosis','Developmental Coordination Disorder'),('diagnosis','Physical Disability'),
  ('diagnosis','Amputation'),('diagnosis','Chronic Pain'),('diagnosis','Neurological Conditions'),
  ('diagnosis','Feeding Difficulties'),('diagnosis','Handwriting Difficulties'),('diagnosis','Executive Functioning Difficulties'),
  ('diagnosis','Emotional Regulation'),('diagnosis','Behaviour of Concern'),
  ('therapy_area','Fine motor'),('therapy_area','Gross motor'),('therapy_area','Handwriting'),
  ('therapy_area','Sensory processing'),('therapy_area','Oral sensory / chewing'),('therapy_area','Feeding'),
  ('therapy_area','Emotional regulation'),('therapy_area','Executive functioning'),('therapy_area','ADLs'),
  ('therapy_area','IADLs'),('therapy_area','Social skills'),('therapy_area','School participation'),
  ('therapy_area','Community access'),('therapy_area','Home safety'),('therapy_area','Mobility'),
  ('therapy_area','Assistive technology'),('therapy_area','Equipment prescription'),('therapy_area','Routine building'),
  ('therapy_area','Communication supports'),('therapy_area','Play skills'),('therapy_area','Parent coaching'),
  ('therapy_area','Capacity building'),('therapy_area','Work readiness'),('therapy_area','Money management'),
  ('therapy_area','Cooking'),('therapy_area','Personal care'),('therapy_area','Sleep'),('therapy_area','Toileting'),
  ('population','Early childhood'),('population','Children'),('population','Adolescents'),('population','Adults'),
  ('population','Older adults'),('population','Remote/rural clients'),('population','School-based therapy'),
  ('population','Home-based therapy'),('population','Community-based therapy'),
  ('type','Worksheet'),('type','Visual support'),('type','Handout'),('type','Session plan'),('type','Activity idea'),
  ('type','Home program'),('type','School strategy'),('type','Product link'),('type','Equipment idea'),
  ('type','Research article'),('type','PD video'),('type','Template'),('type','Assessment support'),
  ('type','Case example'),('type','Report-writing phrase bank'),('type','NDIS evidence guide'),('type','Risk/safety guide')
ON CONFLICT (category, name) DO NOTHING;
