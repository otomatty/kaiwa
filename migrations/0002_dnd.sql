-- Pause notifications ("do not disturb") until this time (epoch ms).
ALTER TABLE users ADD COLUMN dnd_until INTEGER;
