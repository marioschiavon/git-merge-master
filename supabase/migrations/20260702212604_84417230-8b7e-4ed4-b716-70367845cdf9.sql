ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS apify_actors JSONB NOT NULL DEFAULT '{
  "instagram":        {"actor_id": "apify/instagram-scraper",            "enabled": true},
  "facebook":         {"actor_id": "apify/facebook-pages-scraper",       "enabled": true},
  "linkedin_person":  {"actor_id": "dev_fusion/linkedin-profile-scraper","enabled": true},
  "linkedin_company": {"actor_id": "apimaestro/linkedin-company",        "enabled": true}
}'::jsonb;