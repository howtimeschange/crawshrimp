ALTER TABLE prompt_templates ADD COLUMN source_field_id TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_templates ADD COLUMN field_order INTEGER;
ALTER TABLE prompt_templates ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prompt_templates ADD COLUMN reference_fields_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE prompt_templates ADD COLUMN word_count INTEGER;
ALTER TABLE prompt_templates ADD COLUMN field_type TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_templates ADD COLUMN excel_meta_json TEXT NOT NULL DEFAULT '{}';
