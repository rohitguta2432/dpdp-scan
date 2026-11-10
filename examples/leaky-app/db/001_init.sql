-- Deliberately leaky schema used to demo dpdp-scan. All values are synthetic.
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone VARCHAR(15),
  aadhaar_number VARCHAR(12),
  pan_number_encrypted BYTEA,
  date_of_birth DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE kyc_documents (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  passport VARCHAR(8),
  bank_account VARCHAR(18),
  ifsc VARCHAR(11)
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  price_paise INT
);
