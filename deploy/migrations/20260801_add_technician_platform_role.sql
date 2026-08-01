-- Adds the restricted platform support role. Safe to execute more than once.
ALTER TYPE platform_role ADD VALUE IF NOT EXISTS 'technician';
